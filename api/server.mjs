import express from 'express';
import cors from 'cors';
import { DefaultAzureCredential } from '@azure/identity';
import { CosmosClient } from '@azure/cosmos';
import { BlobServiceClient, BlobSASPermissions, generateBlobSASQueryParameters, UserDelegationKey } from '@azure/storage-blob';

const port = process.env.PORT || 8080;

// ---- Configuration (sourced from app settings / env) ---------------------
const config = {
  cosmosEndpoint: process.env.COSMOS_ENDPOINT,
  cosmosDatabase: process.env.COSMOS_DATABASE || 'contentSafetyDb',
  cosmosContainer: process.env.COSMOS_CONTAINER || 'contentSafetyResults',
  storageAccountName: process.env.STORAGE_ACCOUNT_NAME,
  storageEndpoint: process.env.STORAGE_ENDPOINT,
  storageContainer: process.env.STORAGE_CONTAINER || 'content-safety-documents',
  allowedOrigins: (process.env.ALLOWED_ORIGINS || '*').split(',').map((s) => s.trim())
};

const credential = new DefaultAzureCredential();

const cosmos = new CosmosClient({ endpoint: config.cosmosEndpoint, aadCredentials: credential });
const cosmosContainer = cosmos.database(config.cosmosDatabase).container(config.cosmosContainer);

const blobService = new BlobServiceClient(config.storageEndpoint, credential);
const blobContainer = blobService.getContainerClient(config.storageContainer);

// Cache user delegation key (rotated hourly)
let cachedKey = { key: null, expiresOn: 0 };
const getDelegationKey = async () => {
  const now = Date.now();
  if (cachedKey.key && cachedKey.expiresOn - now > 5 * 60 * 1000) {
    return cachedKey.key;
  }
  const startsOn = new Date(now - 5 * 60 * 1000);
  const expiresOn = new Date(now + 60 * 60 * 1000);
  const key = await blobService.getUserDelegationKey(startsOn, expiresOn);
  cachedKey = { key, expiresOn: expiresOn.getTime() };
  return key;
};

const buildBlobSasUrl = async (blobName) => {
  const key = await getDelegationKey();
  const expiresOn = new Date(Date.now() + 15 * 60 * 1000);
  const sas = generateBlobSASQueryParameters(
    {
      containerName: config.storageContainer,
      blobName,
      permissions: BlobSASPermissions.parse('r'),
      expiresOn,
      protocol: 'https'
    },
    key,
    config.storageAccountName
  ).toString();
  return `${config.storageEndpoint}/${config.storageContainer}/${encodeURIComponent(blobName)}?${sas}`;
};

// ---- Express app ---------------------------------------------------------
const app = express();
app.disable('x-powered-by');
app.use(
  cors({
    origin: config.allowedOrigins.includes('*') ? true : config.allowedOrigins,
    methods: ['GET', 'OPTIONS']
  })
);

app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    cosmosEndpoint: config.cosmosEndpoint,
    storageEndpoint: config.storageEndpoint,
    timestamp: new Date().toISOString()
  });
});

app.get('/api/documents', async (_req, res, next) => {
  try {
    const { resources } = await cosmosContainer.items
      .query('SELECT c.id, c.fileName, c.format, c.expectedContentSafetyOutcome, c.processedAtUtc FROM c')
      .fetchAll();
    res.json({ count: resources.length, documents: resources });
  } catch (err) {
    next(err);
  }
});

app.get('/api/results', async (req, res, next) => {
  try {
    const decision = req.query.decision;
    const sql = decision
      ? {
          query:
            'SELECT * FROM c WHERE c.textAnalysisDecision = @d OR c.imageAnalysisDecision = @d',
          parameters: [{ name: '@d', value: String(decision) }]
        }
      : 'SELECT * FROM c';
    const { resources } = await cosmosContainer.items.query(sql).fetchAll();
    res.json({ count: resources.length, results: resources });
  } catch (err) {
    next(err);
  }
});

app.get('/api/results/summary', async (_req, res, next) => {
  try {
    const { resources } = await cosmosContainer.items.query('SELECT * FROM c').fetchAll();
    const summary = { total: resources.length, safe: 0, blocked: 0, review: 0, byFormat: {} };
    for (const r of resources) {
      const decision = r.textAnalysisDecision || r.imageAnalysisDecision || 'safe';
      if (decision === 'blocked') summary.blocked += 1;
      else if (decision === 'review') summary.review += 1;
      else summary.safe += 1;
      summary.byFormat[r.format] = (summary.byFormat[r.format] || 0) + 1;
    }
    res.json(summary);
  } catch (err) {
    next(err);
  }
});

app.get('/api/results/:id', async (req, res, next) => {
  try {
    const { resources } = await cosmosContainer.items
      .query({
        query: 'SELECT * FROM c WHERE c.id = @id',
        parameters: [{ name: '@id', value: req.params.id }]
      })
      .fetchAll();
    if (!resources.length) {
      return res.status(404).json({ error: 'not_found' });
    }
    res.json(resources[0]);
  } catch (err) {
    next(err);
  }
});

app.get('/api/documents/:fileName/download-url', async (req, res, next) => {
  try {
    const url = await buildBlobSasUrl(req.params.fileName);
    res.json({ url, expiresInSeconds: 900 });
  } catch (err) {
    next(err);
  }
});

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: 'internal_error', message: err.message });
});

app.listen(port, () => {
  console.log(`ai-content-safety-api listening on port ${port}`);
});
