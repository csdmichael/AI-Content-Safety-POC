#!/bin/bash
# AI Content Safety POC - Setup Script with Managed Identity and RBAC
# This script configures RBAC roles for the Content Safety pipeline

set -e

# Configuration
SUBSCRIPTION_ID="86b37969-9445-49cf-b03f-d8866235171c"
RESOURCE_GROUP="ai-myaacoub"
STORAGE_ACCOUNT="aistoragemyaacoub"
CONTENT_SAFETY_ACCOUNT="ai-content-safety-myaacoub"
COSMOS_ACCOUNT="cosmos-ai-poc"

echo "=========================================="
echo "AI Content Safety POC - Setup Script"
echo "=========================================="
echo ""

# Check if client ID is provided
if [ -z "$1" ]; then
    echo "Usage: ./setup.sh <client-id>"
    echo ""
    echo "Example:"
    echo "  ./setup.sh 12345678-1234-1234-1234-123456789012"
    echo ""
    echo "To create a service principal:"
    echo "  az ad sp create-for-rbac --name 'ai-content-safety-pipeline' --role Contributor"
    echo ""
    exit 1
fi

CLIENT_ID="$1"

echo "Setting up RBAC roles for client ID: $CLIENT_ID"
echo "Subscription: $SUBSCRIPTION_ID"
echo "Resource Group: $RESOURCE_GROUP"
echo ""

# Verify the client ID exists
echo "[1/4] Verifying service principal..."
if ! az ad sp show --id "$CLIENT_ID" &>/dev/null; then
    echo "ERROR: Service principal not found: $CLIENT_ID"
    exit 1
fi
echo "✓ Service principal found"
echo ""

# Role 1: Storage Blob Data Contributor
echo "[2/4] Assigning Storage Blob Data Contributor role..."
az role assignment create \
  --role "Storage Blob Data Contributor" \
  --assignee "$CLIENT_ID" \
  --scope "/subscriptions/$SUBSCRIPTION_ID/resourceGroups/$RESOURCE_GROUP/providers/Microsoft.Storage/storageAccounts/$STORAGE_ACCOUNT" \
  --output none 2>/dev/null || echo "  (Role already assigned)"
echo "✓ Storage Blob Data Contributor assigned"
echo ""

# Role 2: Cognitive Services User
echo "[3/4] Assigning Cognitive Services User role..."
az role assignment create \
  --role "Cognitive Services User" \
  --assignee "$CLIENT_ID" \
  --scope "/subscriptions/$SUBSCRIPTION_ID/resourceGroups/$RESOURCE_GROUP/providers/Microsoft.CognitiveServices/accounts/$CONTENT_SAFETY_ACCOUNT" \
  --output none 2>/dev/null || echo "  (Role already assigned)"
echo "✓ Cognitive Services User assigned"
echo ""

# Role 3: Cosmos DB Built-in Data Contributor
echo "[4/4] Assigning Cosmos DB Built-in Data Contributor role..."
OBJECT_ID=$(az ad sp show --id "$CLIENT_ID" --query "id" -o tsv)
az cosmosdb sql role assignment create \
  --account-name "$COSMOS_ACCOUNT" \
  --resource-group "$RESOURCE_GROUP" \
  --role-definition-id 00000000-0000-0000-0000-000000000002 \
  --principal-id "$OBJECT_ID" \
  --scope "/" \
  --output none 2>/dev/null || echo "  (Role already assigned)"
echo "✓ Cosmos DB Built-in Data Contributor assigned"
echo ""

echo "=========================================="
echo "✓ Setup Complete!"
echo "=========================================="
echo ""
echo "Next steps:"
echo "1. Set environment variables:"
echo "   export AZURE_TENANT_ID='<your-tenant-id>'"
echo "   export AZURE_CLIENT_ID='$CLIENT_ID'"
echo "   export AZURE_CLIENT_SECRET='<your-client-secret>'"
echo ""
echo "2. Run the pipeline:"
echo "   npm run pipeline:process"
echo ""
echo "3. For local development (using az login):"
echo "   az login"
echo "   az account set --subscription $SUBSCRIPTION_ID"
echo "   npm run pipeline:process"
echo ""
