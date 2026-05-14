#!/usr/bin/env python3
"""Process demo data through Azure AI Content Safety and store results in Cosmos DB.

Reads manifest, analyzes each document's seedText via Content Safety text:analyze,
analyzes image files via Content Safety image:analyze, and upserts results to Cosmos DB.

Files are assumed to already be uploaded to Blob Storage.
"""

import base64
import json
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import httpx
from azure.identity import DefaultAzureCredential
from azure.cosmos import CosmosClient

REPO_ROOT = Path(__file__).resolve().parent.parent
IMAGE_FORMATS = {"png", "jpg", "jpeg", "gif", "bmp", "webp"}


def main() -> None:
    config = json.loads((REPO_ROOT / "config" / "azure-resources.json").read_text())
    manifest = json.loads((REPO_ROOT / "data" / "manifest.json").read_text())

    credential = DefaultAzureCredential()
    token = credential.get_token("https://cognitiveservices.azure.com/.default").token

    cs_endpoint = config["contentSafety"]["privateEndpointUrl"]
    cs_api_version = config["contentSafety"]["apiVersion"]
    blob_account = config["blobStorage"]["privateEndpointUrl"]
    container_name = config["blobStorage"]["containerName"]
    severity_threshold = 4

    # Cosmos DB
    cosmos = CosmosClient(
        config["cosmosDb"]["privateEndpointUrl"],
        credential=credential,
    )
    db = cosmos.get_database_client(config["cosmosDb"]["databaseName"])
    container = db.get_container_client(config["cosmosDb"]["containerName"])

    docs = manifest["documents"]
    total = len(docs)
    success = fail = 0
    print(f"Processing {total} documents through Content Safety...")

    client = httpx.Client(verify=False, timeout=60)

    for i, doc in enumerate(docs, 1):
        try:
            # Refresh token periodically (every 50 docs)
            if i % 50 == 1:
                token = credential.get_token("https://cognitiveservices.azure.com/.default").token

            headers = {
                "Content-Type": "application/json",
                "Authorization": f"Bearer {token}",
            }

            # Text analysis
            text_analysis = None
            if doc.get("seedText"):
                url = f"{cs_endpoint}/contentsafety/text:analyze?api-version={cs_api_version}"
                resp = client.post(url, headers=headers, json={"text": doc["seedText"]})
                resp.raise_for_status()
                body = resp.json()
                max_sev = max(
                    (c.get("severity", 0) for c in body.get("categoriesAnalysis", [])),
                    default=0,
                )
                text_analysis = {
                    "raw": body,
                    "maxSeverity": max_sev,
                    "decision": "blocked" if max_sev >= severity_threshold else "safe",
                }

            # Image analysis
            image_analysis = None
            fmt = doc.get("format", "").lower()
            if fmt in IMAGE_FORMATS:
                local_path = REPO_ROOT / doc["relativePath"]
                if local_path.exists():
                    b64 = base64.b64encode(local_path.read_bytes()).decode()
                    url = f"{cs_endpoint}/contentsafety/image:analyze?api-version={cs_api_version}"
                    resp = client.post(url, headers=headers, json={"image": {"content": b64}})
                    resp.raise_for_status()
                    body = resp.json()
                    max_sev = max(
                        (c.get("severity", 0) for c in body.get("categoriesAnalysis", [])),
                        default=0,
                    )
                    image_analysis = {
                        "raw": body,
                        "maxSeverity": max_sev,
                        "decision": "blocked" if max_sev >= severity_threshold else "safe",
                    }

            # Build blob URL (files uploaded with subfolder structure: format/filename)
            blob_name = f"{doc['format']}/{doc['fileName']}"
            blob_url = f"{blob_account}/{container_name}/{blob_name}"

            # Build result
            result = {
                "id": doc["id"],
                "fileName": doc["fileName"],
                "format": doc["format"],
                "blobUrl": blob_url,
                "expectedContentSafetyOutcome": doc["expectedContentSafetyOutcome"],
                "category": doc.get("category", "unknown"),
                "seedText": doc.get("seedText", ""),
                "textAnalysisDecision": text_analysis["decision"] if text_analysis else None,
                "textMaxSeverity": text_analysis["maxSeverity"] if text_analysis else None,
                "textAnalysis": text_analysis["raw"] if text_analysis else None,
                "imageAnalysisDecision": image_analysis["decision"] if image_analysis else None,
                "imageMaxSeverity": image_analysis["maxSeverity"] if image_analysis else None,
                "imageAnalysis": image_analysis["raw"] if image_analysis else None,
                "processedAtUtc": datetime.now(timezone.utc).isoformat(),
            }

            # Upsert to Cosmos DB
            container.upsert_item(result)

            text_dec = text_analysis["decision"] if text_analysis else "n/a"
            img_dec = image_analysis["decision"] if image_analysis else "n/a"
            print(f"  [{i:3d}/{total}] {doc['fileName']:16s} text={text_dec:7s} image={img_dec:7s} ({doc.get('category', '')})")
            success += 1

            # Small delay to avoid throttling
            if i % 10 == 0:
                time.sleep(0.5)

        except Exception as e:
            err_msg = str(e)[:120]
            print(f"  [{i:3d}/{total}] FAIL {doc['fileName']}: {err_msg}")
            fail += 1

    client.close()
    print(f"\nProcessing complete: {success} successful, {fail} failed")

    # Summary
    safe_count = sum(1 for d in docs if d.get("expectedContentSafetyOutcome") == "pass")
    fail_count = total - safe_count
    print(f"Expected: {safe_count} safe, {fail_count} flagged")


if __name__ == "__main__":
    main()
