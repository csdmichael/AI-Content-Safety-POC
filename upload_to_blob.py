#!/usr/bin/env python3
"""Upload all manifest documents to Azure Blob Storage via private endpoint."""

import json
import mimetypes
from pathlib import Path

from azure.identity import DefaultAzureCredential
from azure.storage.blob import BlobServiceClient, ContentSettings

REPO_ROOT = Path(__file__).resolve().parent
DATA_DIR = REPO_ROOT / "data"


def main() -> None:
    config = json.loads((REPO_ROOT / "config" / "azure-resources.json").read_text())
    manifest = json.loads((DATA_DIR / "manifest.json").read_text())

    account_url = config["blobStorage"]["privateEndpointUrl"]
    container_name = config["blobStorage"]["containerName"]

    blob_service = BlobServiceClient(
        account_url=account_url,
        credential=DefaultAzureCredential(),
        connection_verify=False,
    )
    container_client = blob_service.get_container_client(container_name)

    docs = manifest["documents"]
    print(f"Uploading {len(docs)} files to Azure Blob Storage...")
    success = fail = 0

    for doc in docs:
        try:
            file_path = REPO_ROOT / doc["relativePath"]
            data = file_path.read_bytes()
            content_type = mimetypes.guess_type(doc["fileName"])[0] or "application/octet-stream"
            blob_client = container_client.get_blob_client(doc["fileName"])
            blob_client.upload_blob(
                data,
                overwrite=True,
                content_settings=ContentSettings(content_type=content_type),
            )
            print(f"  [OK] Uploaded {doc['fileName']} ({len(data) / 1024:.1f} KB)")
            success += 1
        except Exception as e:
            print(f"  [FAIL] {doc['fileName']}: {e}")
            fail += 1

    print(f"\nUpload complete: {success} successful, {fail} failed")


if __name__ == "__main__":
    main()
