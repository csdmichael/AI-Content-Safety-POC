import { DefaultAzureCredential } from '@azure/identity';
import { BlobServiceClient } from '@azure/storage-blob';
import { CosmosClient } from '@azure/cosmos';
import mime from 'mime-types';
import fs from 'node:fs/promises';
import path from 'node:path';

const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');

const readJson = async (relativePath) =>
  JSON.parse(await fs.readFile(path.resolve(repoRoot, relativePath), 'utf8'));

const azureConfig = await readJson('config/azure-resources.json');
const pipelineConfig = await readJson('config/pipeline-settings.json');
const manifest = await readJson(pipelineConfig.manifestPath);

const credential = new DefaultAzureCredential();
const blobServiceClient = new BlobServiceClient(azureConfig.blobStorage.privateEndpointUrl, credential);
const containerClient = blobServiceClient.getContainerClient(azureConfig.blobStorage.containerName);
await containerClient.createIfNotExists();

const cosmosClient = new CosmosClient({
  endpoint: azureConfig.cosmosDb.privateEndpointUrl,
  aadCredentials: credential
});
const db = cosmosClient.database(azureConfig.cosmosDb.databaseName);
const container = db.container(azureConfig.cosmosDb.containerName);

const contentSafetyApiKey = process.env.CONTENT_SAFETY_KEY;
if (!contentSafetyApiKey) {
  throw new Error('Missing CONTENT_SAFETY_KEY environment variable.');
}

const runInBatches = async (items, batchSize, worker) => {
  for (let i = 0; i < items.length; i += batchSize) {
    const chunk = items.slice(i, i + batchSize);
    await Promise.all(chunk.map((item) => worker(item)));
  }
};

const analyzeText = async (text) => {
  const endpoint = `${azureConfig.contentSafety.privateEndpointUrl}/contentsafety/text:analyze?api-version=${azureConfig.contentSafety.apiVersion}`;
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Ocp-Apim-Subscription-Key': contentSafetyApiKey
    },
    body: JSON.stringify({ text })
  });

  if (!response.ok) {
    throw new Error(`Content Safety request failed (${response.status}): ${await response.text()}`);
  }

  const body = await response.json();
  const maxSeverity = Math.max(...(body.categoriesAnalysis || []).map((item) => item.severity || 0), 0);
  return {
    raw: body,
    maxSeverity,
    decision: maxSeverity >= pipelineConfig.contentSafetySeverityThreshold ? 'blocked' : 'safe'
  };
};

await runInBatches(manifest.documents, pipelineConfig.maxParallelism, async (document) => {
  const localPath = path.resolve(repoRoot, document.relativePath);
  const fileBuffer = await fs.readFile(localPath);
  const blobClient = containerClient.getBlockBlobClient(document.fileName);

  await blobClient.uploadData(fileBuffer, {
    blobHTTPHeaders: {
      blobContentType: mime.lookup(document.fileName) || 'application/octet-stream'
    }
  });

  const analysis = await analyzeText(document.seedText);
  await container.items.upsert({
    id: document.id,
    fileName: document.fileName,
    format: document.format,
    blobUrl: blobClient.url,
    expectedContentSafetyOutcome: document.expectedContentSafetyOutcome,
    analysisDecision: analysis.decision,
    maxSeverity: analysis.maxSeverity,
    analysis: analysis.raw,
    processedAtUtc: new Date().toISOString()
  });

  console.log(`Processed ${document.fileName} -> ${analysis.decision}`);
});

console.log('Processing complete.');
