# Azure Private Network Processing Pipeline

This script uploads every generated file from `data/` to Azure Blob Storage through a private endpoint, sends text to Azure AI Content Safety through a private endpoint, and stores results in Cosmos DB through a private endpoint.

## Content Safety Processing Flow

1. **File Upload**: Each file from `data/` folder is uploaded to Azure Blob Storage
2. **Content Analysis**: Document seed text is sent to Azure AI Content Safety service
   - Service analyzes text for harmful categories: hate, self-harm, sexual, violence
   - Returns severity levels (0-7) for each category
3. **Decision Making**: Results compared against severity threshold (configurable)
   - If max severity >= threshold → decision: `blocked`
   - Otherwise → decision: `safe`
4. **Result Storage**: Analysis results stored in Cosmos DB with:
   - Document metadata (fileName, format, blobUrl)
   - Content Safety analysis (decision, maxSeverity, raw analysis data)
   - Processing timestamp

## Azure AI Content Safety Service

**Service Details**:
- Name: `ai-content-safety-myaacoub`
- Endpoint: `https://ai-content-safety-myaacoub.cognitiveservices.azure.com/`
- Region: West US 2
- API Version: 2024-09-01
- Authentication: API Key (Subscription Key) in header `Ocp-Apim-Subscription-Key`

**Request Format**:
```json
POST /contentsafety/text:analyze?api-version=2024-09-01
{
  "text": "<content to analyze>"
}
```

**Response Includes**:
- categoriesAnalysis: Array of category results with severity levels
- maxSeverity: Maximum severity across all categories
- decision: `blocked` or `safe` based on threshold

## Setup
1. Copy template config files:
   - `config/azure-resources.template.json` -> `config/azure-resources.json`
   - `config/pipeline-settings.template.json` -> `config/pipeline-settings.json`
2. Fill in real resource values from resource group `ai-myaacoub`:
   - Blob Storage endpoint and container name
   - Content Safety endpoint: `https://ai-content-safety-myaacoub.cognitiveservices.azure.com/`
   - Cosmos DB endpoint and database/container names
3. Set authentication environment variables:
   ```bash
   export AZURE_TENANT_ID="<your-tenant-id>"
   export AZURE_CLIENT_ID="<your-client-id>"
   export CONTENT_SAFETY_KEY="<your-content-safety-key>"
   ```
4. Adjust pipeline settings as needed:
   - `contentSafetySeverityThreshold`: Severity level for blocking (default: 4)
   - `maxParallelism`: Number of concurrent document uploads/analyses
5. Run:
   ```bash
   npm run pipeline:process
   ```

## Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `AZURE_TENANT_ID` | Microsoft Entra tenant ID | Yes |
| `AZURE_CLIENT_ID` | Application (client) ID for service principal | Yes |
| `AZURE_CLIENT_SECRET` | Client secret (if not using managed identity) | Conditional |
| `CONTENT_SAFETY_KEY` | API key for Content Safety service | Yes |

## Monitoring and Debugging

- Logs show each document's processing status and decision
- Check Cosmos DB container `contentSafetyResults` to view analysis output
- Verify Blob Storage contains uploaded files in `content-safety-documents` container
