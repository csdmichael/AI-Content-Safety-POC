# Azure Private Network Processing Pipeline - Managed Identity Setup

This script uploads every generated file from `data/` to Azure Blob Storage through a private endpoint, sends text to Azure AI Content Safety through a private endpoint, and stores results in Cosmos DB through a private endpoint.

## Authentication: Managed Identity (No API Keys)

The pipeline uses **managed identity** for authentication to all Azure services:
- **Blob Storage**: Authenticated via `DefaultAzureCredential`
- **Content Safety**: Bearer token obtained from managed identity
- **Cosmos DB**: Authenticated via managed identity

This eliminates the need for storing and managing API keys.

## Content Safety Processing Flow

1. **File Upload**: Each file from `data/` folder is uploaded to Azure Blob Storage via private endpoint
2. **Token Acquisition**: Get Bearer token from managed identity for Content Safety API
3. **Content Analysis**: Document seed text is sent to Content Safety private endpoint
   - Service analyzes text for harmful categories: hate, self-harm, sexual, violence
   - Returns severity levels (0-7) for each category
4. **Decision Making**: Results compared against severity threshold (configurable)
   - If max severity >= threshold → decision: `blocked`
   - Otherwise → decision: `safe`
5. **Result Storage**: Analysis results stored in Cosmos DB with:
   - Document metadata (fileName, format, blobUrl)
   - Content Safety analysis (decision, maxSeverity, raw analysis data)
   - Processing timestamp

## Azure AI Content Safety Service

**Service Details**:
- Name: `ai-content-safety-myaacoub`
- Private Endpoint: `https://ai-content-safety-myaacoub.privatelink.cognitiveservices.azure.com`
- Region: West US 2
- API Version: 2024-09-01
- Authentication: Managed Identity (Bearer token in Authorization header)

**Request Format**:
```json
POST /contentsafety/text:analyze?api-version=2024-09-01
Authorization: Bearer <managed-identity-token>
Content-Type: application/json

{
  "text": "<content to analyze>"
}
```

**Response Includes**:
- categoriesAnalysis: Array of category results with severity levels
- maxSeverity: Maximum severity across all categories
- decision: `blocked` or `safe` based on threshold

## Setup Instructions

### Step 1: Prepare Configuration Files

Copy template config files:
```bash
cp config/azure-resources.template.json config/azure-resources.json
cp config/pipeline-settings.template.json config/pipeline-settings.json
```

Update `config/azure-resources.json` with your actual Azure resource values:
- Blob Storage private endpoint URL
- Content Safety private endpoint URL
- Cosmos DB private endpoint URL

### Step 2: Create Service Principal (for CI/CD or automation)

If running in GitHub Actions or other CI/CD, create a service principal:

```bash
# Create service principal
SP_NAME="ai-content-safety-pipeline"
SP=$(az ad sp create-for-rbac \
  --name "$SP_NAME" \
  --role "Contributor" \
  --scopes "/subscriptions/86b37969-9445-49cf-b03f-d8866235171c/resourceGroups/ai-myaacoub")

# Extract values for GitHub secrets
echo "AZURE_CLIENT_ID: $(echo $SP | jq -r '.clientId')"
echo "AZURE_CLIENT_SECRET: $(echo $SP | jq -r '.clientSecret')"
echo "AZURE_TENANT_ID: $(echo $SP | jq -r '.tenant')"
```

### Step 3: Create RBAC Role Assignments

Assign the necessary roles to your managed identity or service principal:

#### 3a. Storage Blob Data Contributor (for Blob Storage access)
```bash
CLIENT_ID="<your-client-id>"

az role assignment create \
  --role "Storage Blob Data Contributor" \
  --assignee "$CLIENT_ID" \
  --scope "/subscriptions/86b37969-9445-49cf-b03f-d8866235171c/resourceGroups/ai-myaacoub/providers/Microsoft.Storage/storageAccounts/aistoragemyaacoub"
```

#### 3b. Cognitive Services User (for Content Safety access)
```bash
az role assignment create \
  --role "Cognitive Services User" \
  --assignee "$CLIENT_ID" \
  --scope "/subscriptions/86b37969-9445-49cf-b03f-d8866235171c/resourceGroups/ai-myaacoub/providers/Microsoft.CognitiveServices/accounts/ai-content-safety-myaacoub"
```

#### 3c. Cosmos DB Built-in Data Contributor (for Cosmos DB access)
```bash
# Get the object ID of the service principal
OBJECT_ID=$(az ad sp show --id "$CLIENT_ID" --query "id" -o tsv)

# Assign Cosmos DB role
az cosmosdb sql role assignment create \
  --account-name cosmos-ai-poc \
  --resource-group ai-myaacoub \
  --role-definition-id 00000000-0000-0000-0000-000000000002 \
  --principal-id "$OBJECT_ID" \
  --scope "/"
```

### Step 4: Set Environment Variables

For local development or CI/CD:

```bash
# For local development (uses your logged-in Azure account)
az login
az account set --subscription 86b37969-9445-49cf-b03f-d8866235171c

# For service principal authentication
export AZURE_TENANT_ID="<your-tenant-id>"
export AZURE_CLIENT_ID="<your-client-id>"
export AZURE_CLIENT_SECRET="<your-secret>"
```

**Note**: `DefaultAzureCredential` will automatically try:
1. Environment variables (`AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET`)
2. Managed identity (if running in Azure)
3. Shared token cache (if locally authenticated via `az login`)
4. Azure CLI credentials

### Step 5: Run Pipeline

```bash
npm install
npm run pipeline:process
```

## Environment Variables

| Variable | Description | Source | Required |
|----------|-------------|--------|----------|
| `AZURE_TENANT_ID` | Microsoft Entra tenant ID | Service Principal | Yes (for CI/CD) |
| `AZURE_CLIENT_ID` | Application (client) ID | Service Principal | Yes (for CI/CD) |
| `AZURE_CLIENT_SECRET` | Client secret | Service Principal | Yes (for CI/CD) |
| `CONTENT_SAFETY_KEY` | **DEPRECATED** - Not needed with managed identity | N/A | No |

## Private Endpoints & Network Security

All Azure services are accessed through private endpoints:
- **Blob Storage**: `https://aistoragemyaacoub.privatelink.blob.core.windows.net`
- **Content Safety**: `https://ai-content-safety-myaacoub.privatelink.cognitiveservices.azure.com`
- **Cosmos DB**: `https://cosmos-ai-poc.privatelink.documents.azure.com:443/`

These are only accessible from within the virtual network:
- **VNet**: vnet-salespoc-westus2
- **Subnet**: default

## Monitoring and Debugging

- Logs show each document's processing status and decision
- Check Cosmos DB container `contentSafetyResults` to view analysis output
- Verify Blob Storage contains uploaded files in `content-safety-documents` container
- For token issues, verify RBAC role assignments with:
  ```bash
  az role assignment list --assignee "<client-id>" --all --output table
  ```

## Troubleshooting

**Error: Unauthorized or forbidden**
- Verify RBAC role assignments are created correctly
- Check that the service principal/managed identity has the correct roles

**Error: Network unreachable**
- Ensure you're running within the private network or have VPN access
- Verify private endpoints are created and configured

**Error: Token acquisition failed**
- Verify `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, and `AZURE_CLIENT_SECRET` are set
- Ensure the service principal has login permissions
- Run `az login` for interactive authentication
