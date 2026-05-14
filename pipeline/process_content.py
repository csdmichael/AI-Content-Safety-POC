#!/usr/bin/env python3
"""Azure AI Content Safety Pipeline — downloads documents from Blob Storage,
analyses them via Content Safety, and stores results in Cosmos DB."""

import asyncio
import base64
import json
import os
import re
from pathlib import Path

from azure.identity.aio import DefaultAzureCredential
from azure.storage.blob.aio import BlobServiceClient
from azure.cosmos.aio import CosmosClient
import httpx

REPO_ROOT = Path(__file__).resolve().parent.parent
CUSTOM_CATEGORY_SEVERITY = 6
CUSTOM_CATEGORY_PATTERNS = {
    "Profanity": [
        re.compile(r"\b(?:damn|hell|shit|f\*+k|fuck|bastard|idiot|moron)\b", re.IGNORECASE),
    ],
    "PII": [
        re.compile(r"\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b", re.IGNORECASE),
        re.compile(r"\b\d{3}-\d{2}-\d{4}\b"),
        re.compile(r"\b(?:\+1[-.\s]?)?\(?\d{3}\)?[-.\s]\d{3}[-.\s]\d{4}\b"),
        re.compile(r"\b(?:\d[ -]*?){13,16}\b"),
    ],
}


def read_json(relative_path: str) -> dict:
    return json.loads((REPO_ROOT / relative_path).read_text(encoding="utf-8"))


def analyze_custom_categories(text: str) -> list[dict]:
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


async def main() -> None:
    azure_config = read_json("config/azure-resources.json")
    pipeline_config = read_json("config/pipeline-settings.json")
    manifest = read_json(pipeline_config["manifestPath"])

    severity_threshold: int = pipeline_config.get("contentSafetySeverityThreshold", 4)
    max_parallelism: int = pipeline_config.get("maxParallelism", 4)
    semaphore = asyncio.Semaphore(max_parallelism)

    credential = DefaultAzureCredential()

    # Blob Storage
    blob_service = BlobServiceClient(
        azure_config["blobStorage"]["privateEndpointUrl"],
        credential=credential,
        connection_verify=False,
    )
    container_client = blob_service.get_container_client(
        azure_config["blobStorage"]["containerName"]
    )

    # Cosmos DB
    cosmos = CosmosClient(
        azure_config["cosmosDb"]["privateEndpointUrl"],
        credential=credential,
    )
    database = cosmos.get_database_client(azure_config["cosmosDb"]["databaseName"])
    container = database.get_container_client(azure_config["cosmosDb"]["containerName"])

    # Content Safety helpers
    cs_endpoint = azure_config["contentSafety"]["privateEndpointUrl"]
    cs_api_version = azure_config["contentSafety"]["apiVersion"]

    async def get_token() -> str:
        token = await credential.get_token("https://cognitiveservices.azure.com/.default")
        return token.token

    async def analyze_text(text: str) -> dict:
        token = await get_token()
        url = f"{cs_endpoint}/contentsafety/text:analyze?api-version={cs_api_version}"
        async with httpx.AsyncClient(verify=False) as client:
            resp = await client.post(
                url,
                headers={"Content-Type": "application/json", "Authorization": f"Bearer {token}"},
                json={"text": text},
                timeout=30,
            )
            resp.raise_for_status()
        body = resp.json()
        cs_max_sev = max((c.get("severity", 0) for c in body.get("categoriesAnalysis", [])), default=0)
        custom_categories = analyze_custom_categories(text)
        custom_max_sev = max((c.get("severity", 0) for c in custom_categories), default=0)
        max_sev = max(cs_max_sev, custom_max_sev)
        return {
            "raw": body,
            "customCategoryAnalysis": custom_categories,
            "maxSeverity": max_sev,
            "decision": "blocked" if max_sev >= severity_threshold else "safe",
        }

    async def analyze_image(image_bytes: bytes) -> dict:
        token = await get_token()
        url = f"{cs_endpoint}/contentsafety/image:analyze?api-version={cs_api_version}"
        b64 = base64.b64encode(image_bytes).decode()
        async with httpx.AsyncClient(verify=False) as client:
            resp = await client.post(
                url,
                headers={"Content-Type": "application/json", "Authorization": f"Bearer {token}"},
                json={"image": {"content": b64}},
                timeout=60,
            )
            resp.raise_for_status()
        body = resp.json()
        max_sev = max((c.get("severity", 0) for c in body.get("categoriesAnalysis", [])), default=0)
        return {
            "raw": body,
            "maxSeverity": max_sev,
            "decision": "blocked" if max_sev >= severity_threshold else "safe",
        }

    IMAGE_FORMATS = {"png", "jpg", "jpeg", "gif", "bmp", "webp"}

    async def process_document(doc: dict) -> None:
        async with semaphore:
            # Download from Blob Storage
            blob_client = container_client.get_blob_client(doc["fileName"])
            download = await blob_client.download_blob()
            file_bytes = await download.readall()

            # Analyze text
            text_analysis = None
            if doc.get("seedText"):
                text_analysis = await analyze_text(doc["seedText"])

            # Analyze image
            image_analysis = None
            if doc.get("format", "").lower() in IMAGE_FORMATS:
                image_analysis = await analyze_image(file_bytes)

            # Upsert result to Cosmos DB
            from datetime import datetime, timezone

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
            await container.upsert_item(result)

            text_dec = text_analysis["decision"] if text_analysis else "n/a"
            img_dec = image_analysis["decision"] if image_analysis else "n/a"
            print(f"Processed {doc['fileName']} -> text: {text_dec}, image: {img_dec}")

    # Process all documents with bounded concurrency
    tasks = [process_document(doc) for doc in manifest["documents"]]
    await asyncio.gather(*tasks)

    print("Processing complete.")

    # Cleanup
    await blob_service.close()
    await cosmos.close()
    await credential.close()


if __name__ == "__main__":
    asyncio.run(main())
