# Azure Private Network Processing Pipeline

This script uploads every generated file from `data/` to Azure Blob Storage through a private endpoint, sends text to Azure AI Content Safety through a private endpoint, and stores results in Cosmos DB through a private endpoint.

## Setup
1. Copy template config files:
   - `config/azure-resources.template.json` -> `config/azure-resources.json`
   - `config/pipeline-settings.template.json` -> `config/pipeline-settings.json`
2. Fill in real resource values from resource group `ai-myaacoub`.
3. Set authentication environment variables.
4. Run:
   ```bash
   npm run pipeline:process
   ```
