# Config Folder

Copy each `*.template.json` file to a non-template JSON file and set real values from resource group `ai-myaacoub`.

- `azure-resources.template.json` contains Azure resource IDs and private endpoint URLs.
- `pipeline-settings.template.json` controls batch processing behavior.

## Required runtime secrets
Set these as environment variables (do not hardcode):

- `AZURE_TENANT_ID`
- `AZURE_CLIENT_ID`
- `AZURE_CLIENT_SECRET` (if not using workload identity)
- `CONTENT_SAFETY_KEY` (required for Content Safety API call)
