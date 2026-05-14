"""Azure AI Content Safety API — FastAPI server serving moderation results
from Cosmos DB and document download URLs from Blob Storage."""

import os
from datetime import datetime, timezone, timedelta
from urllib.parse import quote

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

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
COSMOS_ENDPOINT = os.environ.get("COSMOS_ENDPOINT", "")
COSMOS_DATABASE = os.environ.get("COSMOS_DATABASE", "contentSafetyDb")
COSMOS_CONTAINER = os.environ.get("COSMOS_CONTAINER", "contentSafetyResults")
STORAGE_ACCOUNT_NAME = os.environ.get("STORAGE_ACCOUNT_NAME", "")
STORAGE_ENDPOINT = os.environ.get("STORAGE_ENDPOINT", "")
STORAGE_CONTAINER = os.environ.get("STORAGE_CONTAINER", "content-safety-documents")
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
    allow_methods=["GET", "OPTIONS"],
    allow_headers=["*"],
)


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
