# Builds, pushes, and creates/updates the App Runner API service.
# Requires Docker Desktop and AWS CLI. Loads repo-root .env (do not print it).
# After changing deploy/apprunner-instance-policy.json, update the IAM role in AWS before redeploying.
#
# Usage (from repo root, venv optional):
#   powershell -ExecutionPolicy Bypass -File deploy/create-apprunner-service.ps1

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    Write-Error "Docker is not installed or not on PATH. Install Docker Desktop, restart the terminal, then re-run this script."
}

$Region = "us-east-1"
$Account = "402561607513"
$Repo = "pancreaspal-v2"
$ImageUri = "$Account.dkr.ecr.$Region.amazonaws.com/${Repo}:main"
$ServiceName = "pancreaspal-v2"
$Bucket = "pancreaspal-patient-files-$Account"
$InstanceRole = "arn:aws:iam::${Account}:role/pancreaspal-apprunner-instance"
$AccessRole = "arn:aws:iam::${Account}:role/pancreaspal-apprunner-ecr-access"

$EnvFile = Join-Path $Root ".env"
if (-not (Test-Path $EnvFile)) {
    Write-Error "Missing .env in repo root."
}

$EnvMap = @{}
Get-Content $EnvFile | ForEach-Object {
    $line = $_.Trim()
    if (-not $line -or $line.StartsWith("#")) { return }
    $idx = $line.IndexOf("=")
    if ($idx -lt 1) { return }
    $EnvMap[$line.Substring(0, $idx).Trim()] = $line.Substring($idx + 1).Trim()
}

function Strip-EnvQuotes([string]$value) {
    $v = $value.Trim()
    if (($v.StartsWith('"') -and $v.EndsWith('"')) -or ($v.StartsWith("'") -and $v.EndsWith("'"))) {
        $v = $v.Substring(1, $v.Length - 2)
    }
    return $v.Trim()
}

function Need([string]$key) {
    if (-not $EnvMap.ContainsKey($key) -or -not $EnvMap[$key]) {
        Write-Error "Set $key in .env"
    }
    return Strip-EnvQuotes $EnvMap[$key]
}

$Kb = Need "BEDROCK_KNOWLEDGE_BASE_ID"
$Model = Need "BEDROCK_MODEL_ID"
$Table = Need "DYNAMODB_CONVERSATION_TABLE"
$MetricsTable = Need "DYNAMODB_HEALTH_METRICS_TABLE"
$corsRaw = $EnvMap["CORS_ORIGINS"]
if ($corsRaw) { $Cors = Strip-EnvQuotes $corsRaw } else { $Cors = "" }
if (-not $Cors) { $Cors = "http://localhost:3000" }

Write-Host "Bedrock KB id length: $($Kb.Length) (must not include quote characters)"
if ($Kb -match '["'']') {
    Write-Error "BEDROCK_KNOWLEDGE_BASE_ID in .env must not include quote characters. Use: BEDROCK_KNOWLEDGE_BASE_ID=$Kb"
}

Write-Host "Logging in to ECR..."
aws ecr get-login-password --region $Region | docker login --username AWS --password-stdin "$Account.dkr.ecr.$Region.amazonaws.com"

Write-Host "Building image..."
docker build -t "${Repo}:main" .
docker tag "${Repo}:main" $ImageUri
docker push $ImageUri

$RuntimeEnv = @{
    AWS_REGION                    = $Region
    BEDROCK_KNOWLEDGE_BASE_ID     = $Kb
    BEDROCK_MODEL_ID              = $Model
    DYNAMODB_CONVERSATION_TABLE   = $Table
    DYNAMODB_HEALTH_METRICS_TABLE = $MetricsTable
    PATIENT_FILES_S3_BUCKET       = $Bucket
    CORS_ORIGINS                  = $Cors
}

$SourceObj = @{
    AuthenticationConfiguration = @{ AccessRoleArn = $AccessRole }
    AutoDeploymentsEnabled      = $true
    ImageRepository             = @{
        ImageIdentifier     = $ImageUri
        ImageRepositoryType = "ECR"
        ImageConfiguration  = @{
            Port                         = "8080"
            RuntimeEnvironmentVariables  = $RuntimeEnv
        }
    }
}

$InstanceObj = @{
    Cpu             = "1 vCPU"
    Memory          = "2 GB"
    InstanceRoleArn = $InstanceRole
}

$HealthObj = @{
    Protocol            = "HTTP"
    Path                = "/"
    Interval            = 10
    Timeout             = 5
    HealthyThreshold    = 1
    UnhealthyThreshold  = 5
}

function Write-JsonFile($obj, $path) {
    $json = $obj | ConvertTo-Json -Depth 10
    [System.IO.File]::WriteAllText($path, $json)
}

$sourceFile = Join-Path $env:TEMP "pancreaspal-apprunner-source.json"
$instanceFile = Join-Path $env:TEMP "pancreaspal-apprunner-instance.json"
$healthFile = Join-Path $env:TEMP "pancreaspal-apprunner-health.json"
Write-JsonFile $SourceObj $sourceFile
Write-JsonFile $InstanceObj $instanceFile
Write-JsonFile $HealthObj $healthFile

function Wait-AppRunnerReady([string]$serviceArn, [int]$timeoutMinutes = 20) {
    $deadline = (Get-Date).AddMinutes($timeoutMinutes)
    while ((Get-Date) -lt $deadline) {
        $status = aws apprunner describe-service --region $Region --service-arn $serviceArn --query "Service.Status" --output text
        if ($status -eq "RUNNING") { return }
        Write-Host "App Runner status: $status (waiting...)"
        Start-Sleep -Seconds 15
    }
    Write-Error "Timed out waiting for App Runner to reach RUNNING."
}

$existing = aws apprunner list-services --region $Region --query "ServiceSummaryList[?ServiceName=='$ServiceName'].ServiceArn" --output text
if ($existing) {
    Wait-AppRunnerReady $existing
    Write-Host "Updating App Runner service..."
    aws apprunner update-service --region $Region --service-arn $existing --source-configuration "file://$sourceFile" --instance-configuration "file://$instanceFile"
    if ($LASTEXITCODE -ne 0) {
        Write-Error "aws apprunner update-service failed with exit code $LASTEXITCODE"
    }
    Write-Host "Updated $existing"
} else {
    Write-Host "Creating App Runner service (this can take several minutes)..."
    $out = aws apprunner create-service --region $Region --service-name $ServiceName --source-configuration "file://$sourceFile" --instance-configuration "file://$instanceFile" --health-check-configuration "file://$healthFile" | ConvertFrom-Json
    Write-Host "Service URL: https://$($out.Service.ServiceUrl)"
}
