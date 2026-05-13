# Setup Guide - Managed Identity & RBAC Configuration

This guide explains how to set up the AI Content Safety POC with managed identity authentication and RBAC role assignments. No API keys are used.

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                    Private Virtual Network                   │
│  vnet-salespoc-westus2 (Subnet: default)                     │
│                                                              │
│  ┌──────────────────────────────────────────────────────┐  │
│  │ Content Safety Pipeline Process                      │  │
│  │ ────────────────────────────────────────────────────  │  │
│  │ • Azure SDK: DefaultAzureCredential                  │  │
│  │ • Bearer Token: Managed Identity                     │  │
│  │ • RBAC: Service Principal                            │  │
│  │                                                      │  │
│  │ Accesses via Private Endpoints:                      │  │
│  │ 1. Blob Storage Endpoint                            │  │
│  │ 2. Content Safety Endpoint                          │  │
│  │ 3. Cosmos DB Endpoint                               │  │
│  └──────────────────────────────────────────────────────┘  │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

## Key Changes from API Key to Managed Identity

| Aspect | Before (API Key) | After (Managed Identity) |
|--------|------------------|--------------------------|
| **Authentication** | API Key in header `Ocp-Apim-Subscription-Key` | Bearer token from managed identity |
| **Token Management** | Manual key rotation | Automatic token refresh |
| **Security** | Keys in environment/config | No secrets in configuration |
| **Audit Trail** | API key usage not tracked | Full RBAC audit trail |
| **Access Control** | All or nothing with API key | Fine-grained RBAC roles |

## Prerequisites

- Azure CLI installed and authenticated: `az login`
- Appropriate permissions to create service principals and assign roles
- Access to subscription: `86b37969-9445-49cf-b03f-d8866235171c`
- Resource group: `ai-myaacoub`

## Step 1: Create Service Principal

Create a service principal for the pipeline (required for CI/CD and automation):

```bash
# Create service principal with Contributor role on resource group
SP=$(az ad sp create-for-rbac \
  --name "ai-content-safety-pipeline" \
  --role "Contributor" \
  --scopes "/subscriptions/86b37969-9445-49cf-b03f-d8866235171c/resourceGroups/ai-myaacoub")

# Extract values for use in setup
CLIENT_ID=$(echo $SP | jq -r '.clientId')
CLIENT_SECRET=$(echo $SP | jq -r '.clientSecret')
TENANT_ID=$(echo $SP | jq -r '.tenant')

echo "CLIENT_ID: $CLIENT_ID"
echo "CLIENT_SECRET: $CLIENT_SECRET"
echo "TENANT_ID: $TENANT_ID"
```

Save these values - you'll need them for environment variables later.

## Step 2: Assign RBAC Roles

### Option A: Using Setup Script (Recommended)

```bash
# Linux/macOS
chmod +x setup.sh
./setup.sh "$CLIENT_ID"

# Windows
setup.bat %CLIENT_ID%
```

### Option B: Manual RBAC Assignments

Run these commands individually:

#### 1. Storage Blob Data Contributor
```bash
az role assignment create \
  --role "Storage Blob Data Contributor" \
  --assignee "$CLIENT_ID" \
  --scope "/subscriptions/86b37969-9445-49cf-b03f-d8866235171c/resourceGroups/ai-myaacoub/providers/Microsoft.Storage/storageAccounts/aistoragemyaacoub"
```

#### 2. Cognitive Services User
```bash
az role assignment create \
  --role "Cognitive Services User" \
  --assignee "$CLIENT_ID" \
  --scope "/subscriptions/86b37969-9445-49cf-b03f-d8866235171c/resourceGroups/ai-myaacoub/providers/Microsoft.CognitiveServices/accounts/ai-content-safety-myaacoub"
```

#### 3. Cosmos DB Built-in Data Contributor
```bash
# Get the object ID of the service principal
OBJECT_ID=$(az ad sp show --id "$CLIENT_ID" --query "id" -o tsv)

# Assign the role
az cosmosdb sql role assignment create \
  --account-name cosmos-ai-poc \
  --resource-group ai-myaacoub \
  --role-definition-id 00000000-0000-0000-0000-000000000002 \
  --principal-id "$OBJECT_ID" \
  --scope "/"
```

### Verify Role Assignments

```bash
# List all role assignments for the service principal
az role assignment list --assignee "$CLIENT_ID" --all --output table
```

Expected output should show:
- `Storage Blob Data Contributor` on storage account
- `Cognitive Services User` on Content Safety account
- `Cosmos DB Built-in Data Contributor` on Cosmos DB account

## Step 3: Update Configuration Files

### Copy Template Files
```bash
cp config/azure-resources.template.json config/azure-resources.json
cp config/pipeline-settings.template.json config/pipeline-settings.json
```

### Verify Configuration

The `azure-resources.json` should have:
```json
{
  "contentSafety": {
    "resourceId": "/subscriptions/86b37969-9445-49cf-b03f-d8866235171c/resourceGroups/ai-myaacoub/providers/Microsoft.CognitiveServices/accounts/ai-content-safety-myaacoub",
    "privateEndpointUrl": "https://ai-content-safety-myaacoub.privatelink.cognitiveservices.azure.com",
    "apiVersion": "2024-09-01",
    "authentication": "managed-identity"
  }
}
```

**Important**: No API key references - authentication is handled via managed identity.

## Step 4: Set Environment Variables

### For Service Principal Authentication (CI/CD)

```bash
# Option 1: Export as environment variables
export AZURE_TENANT_ID="$TENANT_ID"
export AZURE_CLIENT_ID="$CLIENT_ID"
export AZURE_CLIENT_SECRET="$CLIENT_SECRET"
```

### For Local Development (Simpler)

```bash
# Use your current Azure login
az login
az account set --subscription 86b37969-9445-49cf-b03f-d8866235171c
# No environment variables needed - `az login` is sufficient
```

## Step 5: Run Pipeline

```bash
# Install dependencies
npm install

# Build and test UI (optional)
npm run ui:build
npm run ui:test

# Run content safety pipeline
npm run pipeline:process
```

## How Managed Identity Works

The pipeline uses `DefaultAzureCredential` which automatically tries authentication methods in this order:

1. **Environment Variables** (if `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET` are set)
2. **Managed Identity** (if running in Azure)
3. **Shared Token Cache** (if logged in via `az login`)
4. **Azure CLI Credentials**

## Troubleshooting

### Error: "Unauthorized (401) or Forbidden (403)"
- **Cause**: RBAC roles not assigned correctly
- **Fix**: Run verification command:
  ```bash
  az role assignment list --assignee "$CLIENT_ID" --all --output table
  ```

### Error: "The user, group or service principal does not have permission"
- **Cause**: Service principal exists but role assignment failed
- **Fix**: Retry RBAC assignment commands or check permissions

### Error: "Network unreachable"
- **Cause**: Running outside private network
- **Fix**: Ensure you have VPN/private network access to the vnet

### Error: "Token acquisition failed"
- **Cause**: `DefaultAzureCredential` unable to find credentials
- **Fix**: Either:
  - Set environment variables: `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET`
  - Or run: `az login`

## Verification Steps

After setup, verify everything works:

```bash
# 1. Check service principal exists
az ad sp show --id "$CLIENT_ID"

# 2. Verify RBAC roles
az role assignment list --assignee "$CLIENT_ID" --all

# 3. Test pipeline (dry run)
npm run pipeline:process

# 4. Check results in Cosmos DB
az cosmosdb sql query \
  --account-name cosmos-ai-poc \
  --database-name contentSafetyDb \
  --container-name contentSafetyResults \
  --query "SELECT TOP 5 * FROM c ORDER BY c.processedAtUtc DESC"
```

## Cleanup (If Needed)

To remove service principal and role assignments:

```bash
# Delete service principal (removes all role assignments)
az ad sp delete --id "$CLIENT_ID"
```

## Security Best Practices

1. **Never commit secrets** to version control
2. **Use GitHub Secrets** for CI/CD pipelines
3. **Rotate client secrets** periodically (manually via Azure Portal)
4. **Use managed identity** when running in Azure (no service principal needed)
5. **Enable audit logging** for all role assignments
6. **Review access regularly** with:
   ```bash
   az role assignment list --all --output table
   ```

## References

- [Azure Managed Identity](https://learn.microsoft.com/azure/active-directory/managed-identities-azure-resources/)
- [DefaultAzureCredential](https://learn.microsoft.com/azure/developer/intro-to-azure-credentials)
- [Azure RBAC Best Practices](https://learn.microsoft.com/azure/role-based-access-control/best-practices)
- [Private Endpoints](https://learn.microsoft.com/azure/private-link/private-endpoint-overview)
