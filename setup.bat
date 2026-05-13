@echo off
REM AI Content Safety POC - Setup Script with Managed Identity and RBAC (Windows)
REM This script configures RBAC roles for the Content Safety pipeline

setlocal enabledelayedexpansion

REM Configuration
set SUBSCRIPTION_ID=86b37969-9445-49cf-b03f-d8866235171c
set RESOURCE_GROUP=ai-myaacoub
set STORAGE_ACCOUNT=aistoragemyaacoub
set CONTENT_SAFETY_ACCOUNT=ai-content-safety-myaacoub
set COSMOS_ACCOUNT=cosmos-ai-poc

echo.
echo ==========================================
echo AI Content Safety POC - Setup Script
echo ==========================================
echo.

REM Check if client ID is provided
if "%~1"=="" (
    echo Usage: setup.bat ^<client-id^>
    echo.
    echo Example:
    echo   setup.bat 12345678-1234-1234-1234-123456789012
    echo.
    echo To create a service principal:
    echo   az ad sp create-for-rbac --name "ai-content-safety-pipeline" --role Contributor
    echo.
    exit /b 1
)

set CLIENT_ID=%~1

echo Setting up RBAC roles for client ID: %CLIENT_ID%
echo Subscription: %SUBSCRIPTION_ID%
echo Resource Group: %RESOURCE_GROUP%
echo.

REM Verify the client ID exists
echo [1/4] Verifying service principal...
az ad sp show --id "%CLIENT_ID%" >nul 2>&1
if errorlevel 1 (
    echo ERROR: Service principal not found: %CLIENT_ID%
    exit /b 1
)
echo OK - Service principal found
echo.

REM Role 1: Storage Blob Data Contributor
echo [2/4] Assigning Storage Blob Data Contributor role...
az role assignment create ^
  --role "Storage Blob Data Contributor" ^
  --assignee "%CLIENT_ID%" ^
  --scope "/subscriptions/%SUBSCRIPTION_ID%/resourceGroups/%RESOURCE_GROUP%/providers/Microsoft.Storage/storageAccounts/%STORAGE_ACCOUNT%" ^
  --output none 2>nul || (
    echo   (Role already assigned or skipped)
)
echo OK - Storage Blob Data Contributor assigned
echo.

REM Role 2: Cognitive Services User
echo [3/4] Assigning Cognitive Services User role...
az role assignment create ^
  --role "Cognitive Services User" ^
  --assignee "%CLIENT_ID%" ^
  --scope "/subscriptions/%SUBSCRIPTION_ID%/resourceGroups/%RESOURCE_GROUP%/providers/Microsoft.CognitiveServices/accounts/%CONTENT_SAFETY_ACCOUNT%" ^
  --output none 2>nul || (
    echo   (Role already assigned or skipped)
)
echo OK - Cognitive Services User assigned
echo.

REM Role 3: Cosmos DB Built-in Data Contributor
echo [4/4] Assigning Cosmos DB Built-in Data Contributor role...
for /f "tokens=*" %%i in ('az ad sp show --id "%CLIENT_ID%" --query "id" -o tsv') do set OBJECT_ID=%%i

az cosmosdb sql role assignment create ^
  --account-name "%COSMOS_ACCOUNT%" ^
  --resource-group "%RESOURCE_GROUP%" ^
  --role-definition-id 00000000-0000-0000-0000-000000000002 ^
  --principal-id "%OBJECT_ID%" ^
  --scope "/" ^
  --output none 2>nul || (
    echo   (Role already assigned or skipped)
)
echo OK - Cosmos DB Built-in Data Contributor assigned
echo.

echo ==========================================
echo OK - Setup Complete!
echo ==========================================
echo.
echo Next steps:
echo 1. Set environment variables:
echo    set AZURE_TENANT_ID=^<your-tenant-id^>
echo    set AZURE_CLIENT_ID=%CLIENT_ID%
echo    set AZURE_CLIENT_SECRET=^<your-client-secret^>
echo.
echo 2. Run the pipeline:
echo    npm run pipeline:process
echo.
echo 3. For local development (using az login):
echo    az login
echo    az account set --subscription %SUBSCRIPTION_ID%
echo    npm run pipeline:process
echo.

endlocal
