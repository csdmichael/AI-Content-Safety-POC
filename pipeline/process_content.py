#!/usr/bin/env python3
"""Azure AI Content Safety Pipeline — uploads documents to Blob Storage,
analyses them via Content Safety, and stores results in Cosmos DB."""

import asyncio
import base64
import json
import mimetypes
import os
import ssl
from pathlib import Path

from azure.identity.aio import DefaultAzureCredential
from azure.storage.blob.aio import BlobServiceClient
from azure.cosmos.aio import CosmosClient
import httpx

REPO_ROOT = Path(__file__).resolve().parent.parent


def read_json(relative_path: str) -> dict:
    return json.loads((REPO_ROOT / relative_path).read_text(encoding="utf-8"))


async def main() -> None:
    azure_config = read_json("config/azure-resources.json")
    pipeline_config = read_json("config/pipeline-settings.json")
    manifest = read_json(pipeline_config["manifestPath"])

    severity_threshold: int = pipeline_config.get("contentSafetySeverityThreshold", 4)
    max_parallelism: int = pipeline_config.get("maxParallelism", 4)
    semaphore = asyncio.Semaphore(max_parallelism)

    credential = DefaultAzureCredential()

    # Blob Storage — allow self-signed certs for private endpoints (dev/test)
    ssl_ctx = ssl.create_default_context()
    ssl_ctx.check_hostname = False
    ssl_ctx.verify_mode = ssl.CERT_NONE

    blob_service = BlobServiceClient(
        azure_config["blobStorage"]["privateEndpointUrl"],
        credential=credential,
        connection_verify=False,
    )
    container_client = blob_service.get_container_client(
        azure_config["blobStorage"]["containerName"]
    )
    if not await container_client.exists():
        await container_client.create_container()

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
        max_sev = max((c.get("severity", 0) for c in body.get("categoriesAnalysis", [])), default=0)
        return {
            "raw": body,
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
            local_path = REPO_ROOT / doc["relativePath"]
            file_bytes = local_path.read_bytes()

            # Upload to Blob Storage
            blob_client = container_client.get_blob_client(doc["fileName"])
            content_type = mimetypes.guess_type(doc["fileName"])[0] or "application/octet-stream"
            await blob_client.upload_blob(
                file_bytes,
                overwrite=True,
                content_settings={"content_type": content_type},
            )

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
