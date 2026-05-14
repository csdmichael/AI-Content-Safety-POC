import express from 'express';
import cors from 'cors';
import swaggerUi from 'swagger-ui-express';
import { DefaultAzureCredential } from '@azure/identity';
import { CosmosClient } from '@azure/cosmos';
import { BlobServiceClient, BlobSASPermissions, generateBlobSASQueryParameters } from '@azure/storage-blob';

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

// ---- Swagger / OpenAPI ---------------------------------------------------
const swaggerDocument = {
  openapi: '3.0.3',
  info: {
    title: 'AI Content Safety API',
    version: '1.0.0',
    description: 'REST API for the Azure AI Content Safety POC. Serves moderation results from Cosmos DB and document download URLs from Blob Storage.'
  },
  servers: [
    { url: 'https://ai-content-safety-api.azurewebsites.net', description: 'Azure App Service' },
    { url: 'http://localhost:8080', description: 'Local development' }
  ],
  paths: {
    '/api/health': {
      get: {
        summary: 'Health check',
        operationId: 'getHealth',
        tags: ['Health'],
        responses: {
          200: {
            description: 'Service health',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/HealthResponse' } } }
          }
        }
      }
    },
    '/api/documents': {
      get: {
        summary: 'List all processed documents',
        operationId: 'listDocuments',
        tags: ['Documents'],
        responses: {
          200: {
            description: 'Array of document summaries',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/DocumentsResponse' } } }
          }
        }
      }
    },
    '/api/documents/{fileName}/download-url': {
      get: {
        summary: 'Get time-limited SAS download URL for a blob',
        operationId: 'getDownloadUrl',
        tags: ['Documents'],
        parameters: [
          { name: 'fileName', in: 'path', required: true, schema: { type: 'string' }, description: 'Blob file name, e.g. doc_001.png' }
        ],
        responses: {
          200: {
            description: 'SAS download URL (valid 15 min)',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/DownloadUrlResponse' } } }
          }
        }
      }
    },
    '/api/results': {
      get: {
        summary: 'List all content-safety results, optionally filtered',
        operationId: 'listResults',
        tags: ['Results'],
        parameters: [
          { name: 'decision', in: 'query', required: false, schema: { type: 'string', enum: ['safe', 'blocked'] }, description: 'Filter by analysis decision' }
        ],
        responses: {
          200: {
            description: 'Array of result records',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/ResultsResponse' } } }
          }
        }
      }
    },
    '/api/results/summary': {
      get: {
        summary: 'Aggregated KPI summary of all results',
        operationId: 'getResultsSummary',
        tags: ['Results'],
        responses: {
          200: {
            description: 'KPI counters and format breakdown',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/SummaryResponse' } } }
          }
        }
      }
    },
    '/api/results/{id}': {
      get: {
        summary: 'Get a single result by document ID',
        operationId: 'getResult',
        tags: ['Results'],
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string' }, description: 'Document ID, e.g. doc-001' }
        ],
        responses: {
          200: { description: 'Full result record', content: { 'application/json': { schema: { $ref: '#/components/schemas/ResultRecord' } } } },
          404: { description: 'Document not found' }
        }
      }
    }
  },
  components: {
    schemas: {
      HealthResponse: {
        type: 'object',
        properties: {
          status: { type: 'string', example: 'ok' },
          cosmosEndpoint: { type: 'string' },
          storageEndpoint: { type: 'string' },
          timestamp: { type: 'string', format: 'date-time' }
        }
      },
      DocumentSummary: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          fileName: { type: 'string' },
          format: { type: 'string', enum: ['png', 'jpg', 'pdf', 'docx', 'ppt'] },
          expectedContentSafetyOutcome: { type: 'string', enum: ['pass', 'fail'] },
          processedAtUtc: { type: 'string', format: 'date-time' }
        }
      },
      DocumentsResponse: {
        type: 'object',
        properties: {
          count: { type: 'integer' },
          documents: { type: 'array', items: { $ref: '#/components/schemas/DocumentSummary' } }
        }
      },
      DownloadUrlResponse: {
        type: 'object',
        properties: {
          url: { type: 'string', format: 'uri' },
          expiresInSeconds: { type: 'integer', example: 900 }
        }
      },
      CategoryAnalysis: {
        type: 'object',
        properties: {
          category: { type: 'string', enum: ['Hate', 'SelfHarm', 'Sexual', 'Violence'] },
          severity: { type: 'integer', enum: [0, 2, 4, 6] }
        }
      },
      ResultRecord: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          fileName: { type: 'string' },
          format: { type: 'string' },
          blobUrl: { type: 'string' },
          expectedContentSafetyOutcome: { type: 'string' },
          textAnalysisDecision: { type: 'string', enum: ['safe', 'blocked'] },
          textMaxSeverity: { type: 'integer' },
          textAnalysis: { type: 'object', properties: { categoriesAnalysis: { type: 'array', items: { $ref: '#/components/schemas/CategoryAnalysis' } } } },
          imageAnalysisDecision: { type: 'string', enum: ['safe', 'blocked'] },
          imageMaxSeverity: { type: 'integer' },
          imageAnalysis: { type: 'object', properties: { categoriesAnalysis: { type: 'array', items: { $ref: '#/components/schemas/CategoryAnalysis' } } } },
          processedAtUtc: { type: 'string', format: 'date-time' }
        }
      },
      ResultsResponse: {
        type: 'object',
        properties: {
          count: { type: 'integer' },
          results: { type: 'array', items: { $ref: '#/components/schemas/ResultRecord' } }
        }
      },
      SummaryResponse: {
        type: 'object',
        properties: {
          total: { type: 'integer' },
          safe: { type: 'integer' },
          blocked: { type: 'integer' },
          review: { type: 'integer' },
          byFormat: { type: 'object', additionalProperties: { type: 'integer' } }
        }
      }
    }
  }
};
app.use('/api/swagger', swaggerUi.serve, swaggerUi.setup(swaggerDocument, { customSiteTitle: 'AI Content Safety API' }));
app.get('/api/swagger.json', (_req, res) => res.json(swaggerDocument));

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
