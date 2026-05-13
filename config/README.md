# Config Folder

Copy each `*.template.json` file to a non-template JSON file and set real values from resource group `ai-myaacoub`.

- `azure-resources.template.json` contains Azure resource IDs and private endpoint URLs.
  - **Content Safety Private Endpoint**: `https://ai-content-safety-myaacoub.privatelink.cognitiveservices.azure.com`
  - Uses managed identity for authentication (no API keys)
- `pipeline-settings.template.json` controls batch processing behavior.

## Content Safety Service Configuration

The Azure AI Content Safety service is configured with managed identity authentication:
- **Service Name**: ai-content-safety-myaacoub
- **Private Endpoint**: https://ai-content-safety-myaacoub.privatelink.cognitiveservices.azure.com
- **API Version**: 2024-09-01
- **Authentication**: Managed Identity (Bearer token via DefaultAzureCredential)
- **Severity Threshold**: Configurable in pipeline-settings.json (default: 4)

The service analyzes:
- Text content from documents
- Returns categorized violations (hate, self-harm, sexual, violence)
- Decision thresholds based on maximum severity across categories

## Required Azure Environment Variables

Set these as environment variables (for local development/testing):

- `AZURE_TENANT_ID` - Microsoft Entra tenant ID
- `AZURE_CLIENT_ID` - Application (client) ID for managed identity or service principal
- `AZURE_CLIENT_SECRET` - Client secret (only if not using workload identity federation)

**Note**: No API keys needed! The pipeline uses managed identity via `DefaultAzureCredential`.

## RBAC Role Assignments

The service principal or managed identity needs the following roles:

### 1. Storage Account: Storage Blob Data Contributor
```bash
az role assignment create \
  --role "Storage Blob Data Contributor" \
  --assignee "<client-id>" \
  --scope "/subscriptions/86b37969-9445-49cf-b03f-d8866235171c/resourceGroups/ai-myaacoub/providers/Microsoft.Storage/storageAccounts/aistoragemyaacoub"
```

### 2. Content Safety: Cognitive Services User
```bash
az role assignment create \
  --role "Cognitive Services User" \
  --assignee "<client-id>" \
  --scope "/subscriptions/86b37969-9445-49cf-b03f-d8866235171c/resourceGroups/ai-myaacoub/providers/Microsoft.CognitiveServices/accounts/ai-content-safety-myaacoub"
```

### 3. Cosmos DB: Cosmos DB Built-in Data Contributor
```bash
az cosmosdb sql role assignment create \
  --account-name cosmos-ai-poc \
  --resource-group ai-myaacoub \
  --role-definition-id 00000000-0000-0000-0000-000000000002 \
  --principal-id "<object-id>" \
  --scope "/"
```

## Private Network Setup

All services are accessed through private endpoints in the virtual network:
- **VNet**: vnet-salespoc-westus2
- **Subnet**: default
- **Private Endpoints**: Blob Storage, Content Safety, Cosmos DB

The pipeline runs within the private network context and uses private endpoint URLs to connect to all Azure services.

## Local Development

For local development, use Azure CLI login with your user account:
```bash
az login
az account set --subscription 86b37969-9445-49cf-b03f-d8866235171c
npm run pipeline:process
```

For service principal-based authentication, use:
```bash
export AZURE_TENANT_ID="<your-tenant-id>"
export AZURE_CLIENT_ID="<your-client-id>"
export AZURE_CLIENT_SECRET="<your-secret>"
npm run pipeline:process
```
