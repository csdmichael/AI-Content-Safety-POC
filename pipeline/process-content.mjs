import { DefaultAzureCredential } from '@azure/identity';
import { BlobServiceClient } from '@azure/storage-blob';
import { CosmosClient } from '@azure/cosmos';
import mime from 'mime-types';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import https from 'https';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const readJson = async (relativePath) =>
  JSON.parse(await fs.readFile(path.resolve(repoRoot, relativePath), 'utf8'));

const azureConfig = await readJson('config/azure-resources.json');
const pipelineConfig = await readJson('config/pipeline-settings.json');
const manifest = await readJson(pipelineConfig.manifestPath);

const credential = new DefaultAzureCredential();
const customCategoryMatchers = {
  Profanity: [/\b(?:damn|hell(?:scape)?|shit|f\*+k|fuck|bastard|idiots?|moron)\b/i],
  PII: [
    /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i,
    /\b\d{3}-\d{2}-\d{4}\b/,
    /\b(?:\+1[-.\s]?)?\(?\d{3}\)?[-.\s]\d{3}[-.\s]\d{4}\b/,
    /\b(?:\d[ -]*?){13,16}\b/
  ]
};
// Bypass TLS validation for Blob Storage private endpoint (for dev/test only)
const insecureAgent = new https.Agent({ rejectUnauthorized: false });
const blobServiceClient = new BlobServiceClient(azureConfig.blobStorage.privateEndpointUrl, credential, { keepAliveOptions: { agent: insecureAgent } });
const containerClient = blobServiceClient.getContainerClient(azureConfig.blobStorage.containerName);
await containerClient.createIfNotExists();

const cosmosClient = new CosmosClient({
  endpoint: azureConfig.cosmosDb.privateEndpointUrl,
  aadCredentials: credential
});
const db = cosmosClient.database(azureConfig.cosmosDb.databaseName);
const container = db.container(azureConfig.cosmosDb.containerName);

// Get access token for Content Safety using managed identity
const getContentSafetyToken = async () => {
  const token = await credential.getToken('https://cognitiveservices.azure.com/.default');
  return token.token;
};

const runInBatches = async (items, batchSize, worker) => {
  for (let i = 0; i < items.length; i += batchSize) {
    const chunk = items.slice(i, i + batchSize);
    await Promise.all(chunk.map((item) => worker(item)));
  }
};

const analyzeCustomCategories = (text = '') =>
  Object.entries(customCategoryMatchers).map(([category, patterns]) => ({
    category,
    severity: patterns.some((p) => p.test(text)) ? 6 : 0
  }));


const analyzeText = async (text) => {
  const token = await getContentSafetyToken();
  const endpoint = `${azureConfig.contentSafety.privateEndpointUrl}/contentsafety/text:analyze?api-version=${azureConfig.contentSafety.apiVersion}`;
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify({ text })
  });
  if (!response.ok) {
    throw new Error(`Content Safety text request failed (${response.status}): ${await response.text()}`);
  }
  const body = await response.json();
  const csMaxSeverity = Math.max(...(body.categoriesAnalysis || []).map((item) => item.severity || 0), 0);
  const customCategoryAnalysis = analyzeCustomCategories(text);
  const customMaxSeverity = Math.max(...customCategoryAnalysis.map((item) => item.severity || 0), 0);
  const maxSeverity = Math.max(csMaxSeverity, customMaxSeverity);
  return {
    raw: body,
    customCategoryAnalysis,
    maxSeverity,
    decision: maxSeverity >= pipelineConfig.contentSafetySeverityThreshold ? 'blocked' : 'safe'
  };
};

const analyzeImage = async (imageBuffer, fileName) => {
  const token = await getContentSafetyToken();
  const endpoint = `${azureConfig.contentSafety.privateEndpointUrl}/contentsafety/image:analyze?api-version=${azureConfig.contentSafety.apiVersion}`;
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify({ image: { content: Buffer.from(imageBuffer).toString('base64') } })
  });
  if (!response.ok) {
    throw new Error(`Content Safety image request failed (${response.status}): ${await response.text()}`);
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

  // Analyze text
  let textAnalysis = null;
  if (document.seedText) {
    textAnalysis = await analyzeText(document.seedText);
  }

  // Analyze image if format is image
  let imageAnalysis = null;
  if (["png", "jpg", "jpeg", "gif", "bmp", "webp"].includes((document.format || '').toLowerCase())) {
    imageAnalysis = await analyzeImage(fileBuffer, document.fileName);
  }

  await container.items.upsert({
    id: document.id,
    fileName: document.fileName,
    format: document.format,
    blobUrl: blobClient.url,
    expectedContentSafetyOutcome: document.expectedContentSafetyOutcome,
    textAnalysisDecision: textAnalysis?.decision,
    textMaxSeverity: textAnalysis?.maxSeverity,
    textAnalysis: textAnalysis?.raw,
    customCategoryAnalysis: textAnalysis?.customCategoryAnalysis,
    imageAnalysisDecision: imageAnalysis?.decision,
    imageMaxSeverity: imageAnalysis?.maxSeverity,
    imageAnalysis: imageAnalysis?.raw,
    processedAtUtc: new Date().toISOString()
  });

  console.log(`Processed ${document.fileName} -> text: ${textAnalysis?.decision || 'n/a'}, image: ${imageAnalysis?.decision || 'n/a'}`);
});

console.log('Processing complete.');
