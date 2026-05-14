import { BlobServiceClient } from '@azure/storage-blob';
import { DefaultAzureCredential } from '@azure/identity';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import mime from 'mime-types';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(__dirname, 'data');
const config = JSON.parse(await fs.readFile(path.join(__dirname, 'config', 'azure-resources.json'), 'utf-8'));

const accountUrl = config.blobStorage.privateEndpointUrl;
const containerName = config.blobStorage.containerName;

const blobServiceClient = new BlobServiceClient(accountUrl, new DefaultAzureCredential());
const containerClient = blobServiceClient.getContainerClient(containerName);

const manifest = JSON.parse(await fs.readFile(path.join(dataDir, 'manifest.json'), 'utf-8'));

console.log(`Uploading ${manifest.documents.length} files to Azure Blob Storage...`);
let success = 0, fail = 0;

for (const doc of manifest.documents) {
  try {
    const filePath = path.join(__dirname, doc.relativePath);
    const buffer = await fs.readFile(filePath);
    const blobClient = containerClient.getBlockBlobClient(doc.fileName);
    const contentType = mime.lookup(doc.fileName) || 'application/octet-stream';
    await blobClient.upload(buffer, buffer.length, { blobHTTPHeaders: { blobContentType: contentType } });
    console.log(`✓ Uploaded ${doc.fileName} (${(buffer.length / 1024).toFixed(1)} KB)`);
    success++;
  } catch (err) {
    console.error(`✗ Failed ${doc.fileName}: ${err.message}`);
    fail++;
  }
}

console.log(`\nUpload complete: ${success} successful, ${fail} failed`);
