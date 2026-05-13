# Quick Reference - Managed Identity Setup

## 🚀 One-Minute Quick Start

```bash
# 1. Create service principal
SP=$(az ad sp create-for-rbac --name "ai-content-safety-pipeline" --role Contributor --scopes "/subscriptions/86b37969-9445-49cf-b03f-d8866235171c/resourceGroups/ai-myaacoub")
CLIENT_ID=$(echo $SP | jq -r '.clientId')

# 2. Setup RBAC (choose your OS)
./setup.sh "$CLIENT_ID"          # Linux/macOS
# OR
setup.bat %CLIENT_ID%             # Windows

# 3. Run pipeline
npm run pipeline:process
```

## 📋 RBAC Commands (Copy-Paste Ready)

Replace `<client-id>` with your actual client ID.

```bash
# Storage Blob Data Contributor
az role assignment create --role "Storage Blob Data Contributor" --assignee "<client-id>" --scope "/subscriptions/86b37969-9445-49cf-b03f-d8866235171c/resourceGroups/ai-myaacoub/providers/Microsoft.Storage/storageAccounts/aistoragemyaacoub"

# Cognitive Services User
az role assignment create --role "Cognitive Services User" --assignee "<client-id>" --scope "/subscriptions/86b37969-9445-49cf-b03f-d8866235171c/resourceGroups/ai-myaacoub/providers/Microsoft.CognitiveServices/accounts/ai-content-safety-myaacoub"

# Cosmos DB Built-in Data Contributor
OBJECT_ID=$(az ad sp show --id "<client-id>" --query "id" -o tsv)
az cosmosdb sql role assignment create --account-name cosmos-ai-poc --resource-group ai-myaacoub --role-definition-id 00000000-0000-0000-0000-000000000002 --principal-id "$OBJECT_ID" --scope "/"
```

## 🔑 Environment Variables

### For CI/CD (Service Principal)
```bash
export AZURE_TENANT_ID="<tenant-id>"
export AZURE_CLIENT_ID="<client-id>"
export AZURE_CLIENT_SECRET="<secret>"
```

### For Local Development
```bash
az login
az account set --subscription 86b37969-9445-49cf-b03f-d8866235171c
```

## 📊 Private Endpoints

All services use private endpoints:
- **Blob Storage**: `https://aistoragemyaacoub.privatelink.blob.core.windows.net`
- **Content Safety**: `https://ai-content-safety-myaacoub.privatelink.cognitiveservices.azure.com`
- **Cosmos DB**: `https://cosmos-ai-poc.privatelink.documents.azure.com:443/`

## ✅ Verification Commands

```bash
# 1. Verify service principal
az ad sp show --id "<client-id>"

# 2. Verify RBAC roles
az role assignment list --assignee "<client-id>" --all --output table

# 3. Test pipeline
npm run pipeline:process

# 4. Check results
az cosmosdb sql query --account-name cosmos-ai-poc --database-name contentSafetyDb --container-name contentSafetyResults --query "SELECT TOP 5 * FROM c ORDER BY c.processedAtUtc DESC"
```

## 📚 Documentation Links

- **Complete Setup Guide**: [SETUP-MANAGED-IDENTITY.md](SETUP-MANAGED-IDENTITY.md)
- **Migration Details**: [MIGRATION-SUMMARY.md](MIGRATION-SUMMARY.md)
- **Implementation Status**: [IMPLEMENTATION-COMPLETE.md](IMPLEMENTATION-COMPLETE.md)
- **Config Details**: [config/README.md](config/README.md)
- **Pipeline Details**: [pipeline/README-managed-identity.md](pipeline/README-managed-identity.md)

## ❌ What NOT to Do

- ❌ Don't use `CONTENT_SAFETY_KEY` environment variable (deprecated)
- ❌ Don't hardcode secrets in configuration files
- ❌ Don't use public endpoints (only private endpoints)
- ❌ Don't share service principal secrets in version control

## ✅ What You SHOULD Do

- ✅ Use service principal with managed identity
- ✅ Store secrets in CI/CD platform (GitHub Secrets, Azure Key Vault)
- ✅ Use RBAC for access control
- ✅ Run through private network/VPN
- ✅ Verify RBAC roles before running

## 🔍 Troubleshooting

| Error | Solution |
|-------|----------|
| "Unauthorized" | Run: `az role assignment list --assignee "<client-id>" --all` |
| "Network unreachable" | Ensure VPN access to vnet-salespoc-westus2 |
| "Token failed" | Set AZURE_TENANT_ID, AZURE_CLIENT_ID, AZURE_CLIENT_SECRET or run `az login` |
| "Service principal not found" | Verify client-id: `az ad sp show --id "<client-id>"` |

## 📞 Quick Help

```bash
# Get tenant ID
az account show --query tenantId -o tsv

# Get client ID from service principal
az ad sp show --id "<sp-name-or-id>" --query "appId" -o tsv

# Get object ID for Cosmos DB role assignment
az ad sp show --id "<client-id>" --query "id" -o tsv

# List all your service principals
az ad sp list --all --output table
```

## 🎯 Next Steps After Setup

1. ✅ Create service principal
2. ✅ Run setup script to assign RBAC roles
3. ✅ Set environment variables or use `az login`
4. ✅ Run `npm run pipeline:process`
5. ✅ Check Cosmos DB for results
6. ✅ Review [SETUP-MANAGED-IDENTITY.md](SETUP-MANAGED-IDENTITY.md) for details

---

**Total time to setup**: ~5 minutes with setup script
