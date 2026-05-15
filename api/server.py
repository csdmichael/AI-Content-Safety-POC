"""Azure AI Content Safety API — FastAPI server serving moderation results
from Cosmos DB and document download URLs from Blob Storage.
Includes an embedded pipeline that processes documents entirely within
the VNet (Blob → Content Safety → Cosmos DB)."""

import asyncio
import base64
import concurrent.futures
import json
import os
import re
from datetime import datetime, timezone, timedelta
from urllib.parse import quote

import httpx
from azure.cosmos import CosmosClient
from azure.identity import DefaultAzureCredential
from azure.storage.blob import (
    BlobServiceClient,
    BlobSasPermissions,
    generate_blob_sas,
    UserDelegationKey,
)
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from safety_routes import safety_router

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
COSMOS_ENDPOINT = os.environ.get("COSMOS_ENDPOINT", "")
COSMOS_DATABASE = os.environ.get("COSMOS_DATABASE", "contentSafetyDb")
COSMOS_CONTAINER = os.environ.get("COSMOS_CONTAINER", "contentSafetyResults")
STORAGE_ACCOUNT_NAME = os.environ.get("STORAGE_ACCOUNT_NAME", "")
STORAGE_ENDPOINT = os.environ.get("STORAGE_ENDPOINT", "")
STORAGE_CONTAINER = os.environ.get("STORAGE_CONTAINER", "content-safety-documents")
CONTENT_SAFETY_ENDPOINT = os.environ.get("CONTENT_SAFETY_ENDPOINT", "")
CONTENT_SAFETY_API_VERSION = os.environ.get("CONTENT_SAFETY_API_VERSION", "2024-09-01")
SEVERITY_THRESHOLD = int(os.environ.get("SEVERITY_THRESHOLD", "4"))
ALLOWED_ORIGINS = [
    o.strip()
    for o in os.environ.get(
        "ALLOWED_ORIGINS",
        "https://ai-content-safety-ui.azurewebsites.net,http://localhost:4200",
    ).split(",")
]

# ---------------------------------------------------------------------------
# Azure clients
# ---------------------------------------------------------------------------
credential = DefaultAzureCredential()

cosmos = CosmosClient(url=COSMOS_ENDPOINT, credential=credential)
cosmos_container = (
    cosmos.get_database_client(COSMOS_DATABASE).get_container_client(COSMOS_CONTAINER)
)

blob_service = BlobServiceClient(account_url=STORAGE_ENDPOINT, credential=credential)
blob_container = blob_service.get_container_client(STORAGE_CONTAINER)

# Cache user delegation key (rotated hourly)
_cached_key: dict = {"key": None, "expires_on": 0}


def _get_delegation_key() -> UserDelegationKey:
    now = datetime.now(timezone.utc)
    if (
        _cached_key["key"]
        and (_cached_key["expires_on"] - now).total_seconds() > 5 * 60
    ):
        return _cached_key["key"]
    starts_on = now - timedelta(minutes=5)
    expires_on = now + timedelta(hours=1)
    key = blob_service.get_user_delegation_key(starts_on, expires_on)
    _cached_key["key"] = key
    _cached_key["expires_on"] = expires_on
    return key


def _build_blob_sas_url(blob_name: str) -> str:
    key = _get_delegation_key()
    expires_on = datetime.now(timezone.utc) + timedelta(minutes=15)
    sas = generate_blob_sas(
        account_name=STORAGE_ACCOUNT_NAME,
        container_name=STORAGE_CONTAINER,
        blob_name=blob_name,
        user_delegation_key=key,
        permission=BlobSasPermissions(read=True),
        expiry=expires_on,
        protocol="https",
    )
    return f"{STORAGE_ENDPOINT}/{STORAGE_CONTAINER}/{quote(blob_name)}?{sas}"


# ---------------------------------------------------------------------------
# OpenAPI / Swagger metadata
# ---------------------------------------------------------------------------
app = FastAPI(
    title="AI Content Safety API",
    version="1.0.0",
    description=(
        "REST API for the Azure AI Content Safety POC. "
        "Serves moderation results from Cosmos DB and document "
        "download URLs from Blob Storage."
    ),
    docs_url="/api/swagger",
    openapi_url="/api/swagger.json",
    servers=[
        {
            "url": "https://ai-content-safety-api.azurewebsites.net",
            "description": "Azure App Service",
        },
        {"url": "http://localhost:8000", "description": "Local development"},
    ],
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS if "*" not in ALLOWED_ORIGINS else ["*"],
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"],
)

app.include_router(safety_router)


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------
@app.get("/api/health", tags=["Health"], summary="Health check")
def health():
    return {
        "status": "ok",
        "cosmosEndpoint": COSMOS_ENDPOINT,
        "storageEndpoint": STORAGE_ENDPOINT,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }


@app.get("/api/documents", tags=["Documents"], summary="List all processed documents")
def list_documents():
    query = "SELECT c.id, c.fileName, c.format, c.expectedContentSafetyOutcome, c.processedAtUtc FROM c"
    items = list(cosmos_container.query_items(query=query, enable_cross_partition_query=True))
    return {"count": len(items), "documents": items}


@app.get(
    "/api/documents/{file_name}/download-url",
    tags=["Documents"],
    summary="Get time-limited SAS download URL for a blob",
)
def get_download_url(file_name: str):
    url = _build_blob_sas_url(file_name)
    return {"url": url, "expiresInSeconds": 900}


@app.get(
    "/api/results",
    tags=["Results"],
    summary="List all content-safety results, optionally filtered",
)
def list_results(decision: str | None = Query(default=None)):
    if decision:
        query = {
            "query": "SELECT * FROM c WHERE c.textAnalysisDecision = @d OR c.imageAnalysisDecision = @d",
            "parameters": [{"name": "@d", "value": decision}],
        }
    else:
        query = "SELECT * FROM c"
    items = list(cosmos_container.query_items(query=query, enable_cross_partition_query=True))
    return {"count": len(items), "results": items}


@app.get(
    "/api/results/summary",
    tags=["Results"],
    summary="Aggregated KPI summary of all results",
)
def results_summary():
    items = list(
        cosmos_container.query_items(query="SELECT * FROM c", enable_cross_partition_query=True)
    )
    summary: dict = {"total": len(items), "safe": 0, "blocked": 0, "review": 0, "byFormat": {}}
    for r in items:
        decision = r.get("textAnalysisDecision") or r.get("imageAnalysisDecision") or "safe"
        if decision == "blocked":
            summary["blocked"] += 1
        elif decision == "review":
            summary["review"] += 1
        else:
            summary["safe"] += 1
        fmt = r.get("format", "unknown")
        summary["byFormat"][fmt] = summary["byFormat"].get(fmt, 0) + 1
    return summary


@app.get(
    "/api/results/{doc_id}",
    tags=["Results"],
    summary="Get a single result by document ID",
)
def get_result(doc_id: str):
    query = {
        "query": "SELECT * FROM c WHERE c.id = @id",
        "parameters": [{"name": "@id", "value": doc_id}],
    }
    items = list(cosmos_container.query_items(query=query, enable_cross_partition_query=True))
    if not items:
        raise HTTPException(status_code=404, detail="not_found")
    return items[0]


# ---------------------------------------------------------------------------
# Pipeline — processes documents entirely within the VNet
# ---------------------------------------------------------------------------
_pipeline_state: dict = {"status": "idle", "processed": 0, "total": 0, "errors": []}
_pipeline_executor = concurrent.futures.ThreadPoolExecutor(max_workers=1)

IMAGE_FORMATS = {"png", "jpg", "jpeg", "gif", "bmp", "webp"}
CUSTOM_CATEGORY_SEVERITY = 6
CUSTOM_CATEGORY_PATTERNS = {
    "Profanity": [
        re.compile(r"\b(?:damn|hell(?:scape)?|shit|f\*+k|fuck|bastard|idiots?|moron)\b", re.IGNORECASE),
    ],
    "PII": [
        re.compile(r"\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b", re.IGNORECASE),
        re.compile(r"\b\d{3}-\d{2}-\d{4}\b"),
        re.compile(r"\b(?:\+1[-.\s]?)?\(?\d{3}\)?[-.\s]\d{3}[-.\s]\d{4}\b"),
        re.compile(r"\b(?:\d[ -]*?){13,16}\b"),
    ],
}


def _analyze_custom_categories(text: str) -> list[dict]:
    normalized = text or ""
    return [
        {
            "category": category,
            "severity": CUSTOM_CATEGORY_SEVERITY
            if any(pattern.search(normalized) for pattern in patterns)
            else 0,
        }
        for category, patterns in CUSTOM_CATEGORY_PATTERNS.items()
    ]


def _get_cs_token() -> str:
    return credential.get_token("https://cognitiveservices.azure.com/.default").token


def _analyze_text(text: str) -> dict:
    token = _get_cs_token()
    url = f"{CONTENT_SAFETY_ENDPOINT}/contentsafety/text:analyze?api-version={CONTENT_SAFETY_API_VERSION}"
    resp = httpx.post(
        url,
        headers={"Content-Type": "application/json", "Authorization": f"Bearer {token}"},
        json={"text": text},
        timeout=30,
    )
    resp.raise_for_status()
    body = resp.json()
    cs_max_sev = max((c.get("severity", 0) for c in body.get("categoriesAnalysis", [])), default=0)
    custom_categories = _analyze_custom_categories(text)
    custom_max_sev = max((c.get("severity", 0) for c in custom_categories), default=0)
    max_sev = max(cs_max_sev, custom_max_sev)
    return {
        "raw": body,
        "customCategoryAnalysis": custom_categories,
        "maxSeverity": max_sev,
        "decision": "blocked" if max_sev >= SEVERITY_THRESHOLD else "safe",
    }


def _analyze_image(image_bytes: bytes) -> dict:
    token = _get_cs_token()
    url = f"{CONTENT_SAFETY_ENDPOINT}/contentsafety/image:analyze?api-version={CONTENT_SAFETY_API_VERSION}"
    b64 = base64.b64encode(image_bytes).decode()
    resp = httpx.post(
        url,
        headers={"Content-Type": "application/json", "Authorization": f"Bearer {token}"},
        json={"image": {"content": b64}},
        timeout=60,
    )
    resp.raise_for_status()
    body = resp.json()
    max_sev = max((c.get("severity", 0) for c in body.get("categoriesAnalysis", [])), default=0)
    return {"raw": body, "maxSeverity": max_sev, "decision": "blocked" if max_sev >= SEVERITY_THRESHOLD else "safe"}


def _run_pipeline() -> None:
    global _pipeline_state
    _pipeline_state = {"status": "running", "processed": 0, "total": 0, "errors": []}
    try:
        manifest_blob = blob_container.get_blob_client("manifest.json")
        manifest = json.loads(manifest_blob.download_blob().readall().decode())
        docs = manifest["documents"]
        _pipeline_state["total"] = len(docs)

        for doc in docs:
            try:
                blob_client = blob_container.get_blob_client(doc["fileName"])
                file_bytes = blob_client.download_blob().readall()

                text_analysis = None
                if doc.get("seedText"):
                    text_analysis = _analyze_text(doc["seedText"])

                image_analysis = None
                if doc.get("format", "").lower() in IMAGE_FORMATS:
                    image_analysis = _analyze_image(file_bytes)

                result = {
                    "id": doc["id"],
                    "fileName": doc["fileName"],
                    "format": doc["format"],
                    "blobUrl": blob_client.url,
                    "expectedContentSafetyOutcome": doc["expectedContentSafetyOutcome"],
                    "textAnalysisDecision": text_analysis["decision"] if text_analysis else None,
                    "textMaxSeverity": text_analysis["maxSeverity"] if text_analysis else None,
                    "textAnalysis": text_analysis["raw"] if text_analysis else None,
                    "customCategoryAnalysis": text_analysis["customCategoryAnalysis"] if text_analysis else None,
                    "imageAnalysisDecision": image_analysis["decision"] if image_analysis else None,
                    "imageMaxSeverity": image_analysis["maxSeverity"] if image_analysis else None,
                    "imageAnalysis": image_analysis["raw"] if image_analysis else None,
                    "processedAtUtc": datetime.now(timezone.utc).isoformat(),
                }
                cosmos_container.upsert_item(result)
            except Exception as exc:
                _pipeline_state["errors"].append({"doc": doc.get("id", "unknown"), "error": str(exc)})

            _pipeline_state["processed"] += 1

        _pipeline_state["status"] = "completed"
    except Exception as exc:
        _pipeline_state["status"] = "failed"
        _pipeline_state["errors"].append({"doc": "manifest", "error": str(exc)})


@app.post(
    "/api/pipeline/run",
    tags=["Pipeline"],
    summary="Trigger content-safety processing for all documents",
)
async def run_pipeline():
    if _pipeline_state.get("status") == "running":
        return {"status": "already_running", **_pipeline_state}
    loop = asyncio.get_event_loop()
    loop.run_in_executor(_pipeline_executor, _run_pipeline)
    return {"status": "started", "message": "Pipeline processing started in background"}


@app.get(
    "/api/pipeline/status",
    tags=["Pipeline"],
    summary="Get pipeline processing status",
)
def pipeline_status():
    return _pipeline_state
