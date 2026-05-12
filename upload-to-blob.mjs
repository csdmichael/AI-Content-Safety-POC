import { BlobServiceClient } from '@azure/storage-blob';
import { DefaultAzureCredential } from '@azure/identity';
import fs from 'node:fs/promises';
import path from 'node:path';
import mime from 'mime-types';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const manifest = JSON.parse(await fs.readFile(path.join(__dirname, 'data/manifest.json'), 'utf8'));

const credential = new DefaultAzureCredential();
const blobServiceClient = new BlobServiceClient(
  'https://aistoragemyaacoub.blob.core.windows.net',
  credential
);

const containerClient = blobServiceClient.getContainerClient('content-safety-documents');

console.log(`Uploading ${manifest.documents.length} files to Azure Blob Storage...`);

let successCount = 0;
let errorCount = 0;

for (const doc of manifest.documents) {
  try {
    const localPath = path.join(__dirname, doc.relativePath);
    const fileContent = await fs.readFile(localPath);
    
    const blockBlobClient = containerClient.getBlockBlobClient(doc.fileName);
    await blockBlobClient.upload(fileContent, fileContent.length, {
      blobHTTPHeaders: {
        blobContentType: mime.lookup(doc.fileName) || 'application/octet-stream'
      }
    });
    
    console.log(`✓ Uploaded ${doc.fileName}`);
    successCount++;
  } catch (error) {
    console.error(`✗ Failed to upload ${doc.fileName}: ${error.message}`);
    errorCount++;
  }
}

console.log(`\nUpload complete: ${successCount} successful, ${errorCount} failed`);
