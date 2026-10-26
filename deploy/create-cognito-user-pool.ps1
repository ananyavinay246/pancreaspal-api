# Creates a Cognito User Pool + public SPA app client (PKCE, no secret) for Pancreas Pal login.
# Run once per account/region. Prints IDs to add to .env and Amplify.
#
# Usage (from repo root):
#   powershell -ExecutionPolicy Bypass -File deploy/create-cognito-user-pool.ps1

$ErrorActionPreference = "Stop"
$Region = "us-east-1"
$PoolName = "pancreaspal-users"
$ClientName = "pancreaspal-spa"

Write-Host "Creating User Pool '$PoolName' in $Region..."
$poolJson = aws cognito-idp create-user-pool `
    --region $Region `
    --pool-name $PoolName `
    --auto-verified-attributes email `
    --username-attributes email `
    --policies "PasswordPolicy={MinimumLength=8,RequireUppercase=true,RequireLowercase=true,RequireNumbers=true,RequireSymbols=false}" `
    --account-recovery-setting "RecoveryMechanisms=[{Name=verified_email,Priority=1}]" `
    --schema "Name=email,Required=true,Mutable=true" `
    | ConvertFrom-Json

$PoolId = $poolJson.UserPool.Id
Write-Host "User Pool ID: $PoolId"

Write-Host "Creating app client '$ClientName' (PKCE, no secret)..."
$clientJson = aws cognito-idp create-user-pool-client `
    --region $Region `
    --user-pool-id $PoolId `
    --client-name $ClientName `
    --no-generate-secret `
    --explicit-auth-flows ALLOW_USER_SRP_AUTH ALLOW_REFRESH_TOKEN_AUTH `
    --supported-identity-providers COGNITO `
    --prevent-user-existence-errors ENABLED `
    --enable-token-revocation `
    | ConvertFrom-Json

$ClientId = $clientJson.UserPoolClient.ClientId
Write-Host "App client ID: $ClientId"

Write-Host ""
Write-Host "Add to repo-root .env and App Runner (deploy/create-apprunner-service.ps1 reads .env):"
Write-Host "  AUTH_ENABLED=true"
Write-Host "  COGNITO_USER_POOL_ID=$PoolId"
Write-Host "  COGNITO_APP_CLIENT_ID=$ClientId"
Write-Host "  COGNITO_REGION=$Region"
Write-Host "  DEMO_PATIENT_ID=<same as VITE_DEMO_PATIENT_ID>"
Write-Host ""
Write-Host "Add to Amplify build environment:"
Write-Host "  VITE_COGNITO_USER_POOL_ID=$PoolId"
Write-Host "  VITE_COGNITO_CLIENT_ID=$ClientId"
Write-Host "  VITE_COGNITO_REGION=$Region"
Write-Host ""
Write-Host "Cognito Hosted UI / callback (optional): use Amplify URL as allowed origin in App client settings if you enable Hosted UI later."
