param(
  [Parameter(Mandatory = $true)]
  [string]$CustomerCode,
  [Parameter(Mandatory = $true)]
  [string]$CustomerName,
  [Parameter(Mandatory = $true)]
  [string]$DatabaseUrl,
  [Parameter(Mandatory = $true)]
  [string]$VercelToken,
  [Parameter(Mandatory = $true)]
  [string]$VercelOrgId,
  [string]$Domain = "",
  [string]$GitRef = "main",
  [switch]$SkipDbInit
)

$ErrorActionPreference = "Stop"

$projectName = "fcs1-$($CustomerCode.ToLowerInvariant())"
$headers = @{
  Authorization = "Bearer $VercelToken"
  "Content-Type" = "application/json"
}

Write-Host "Ensuring Vercel project $projectName exists"
$projectBody = @{
  name = $projectName
  framework = "nextjs"
} | ConvertTo-Json

try {
  Invoke-RestMethod `
    -Method Post `
    -Uri "https://api.vercel.com/v10/projects?teamId=$VercelOrgId" `
    -Headers $headers `
    -Body $projectBody | Out-Null
  Write-Host "Project created."
}
catch {
  Write-Host "Project likely exists already, continuing."
}

$envValues = @(
  @{ key = "CUSTOMER_CODE"; value = $CustomerCode },
  @{ key = "CUSTOMER_NAME"; value = $CustomerName },
  @{ key = "DATABASE_URL"; value = $DatabaseUrl }
)

foreach ($entry in $envValues) {
  $envBody = @{
    key = $entry.key
    value = $entry.value
    target = @("production", "preview", "development")
    type = "encrypted"
  } | ConvertTo-Json -Depth 4

  Write-Host "Upserting env var $($entry.key)"
  try {
    Invoke-RestMethod `
      -Method Post `
      -Uri "https://api.vercel.com/v10/projects/$projectName/env?teamId=$VercelOrgId&upsert=true" `
      -Headers $headers `
      -Body $envBody | Out-Null
  }
  catch {
    Write-Host "Warning: failed to set $($entry.key). $_"
  }
}

if ($Domain -ne "") {
  Write-Host "Attaching custom domain $Domain"
  $domainBody = @{ name = $Domain } | ConvertTo-Json
  try {
    Invoke-RestMethod `
      -Method Post `
      -Uri "https://api.vercel.com/v10/projects/$projectName/domains?teamId=$VercelOrgId" `
      -Headers $headers `
      -Body $domainBody | Out-Null
  }
  catch {
    Write-Host "Warning: domain attach failed. $_"
  }
}

Write-Host "Triggering deploy from git ref $GitRef"
$deployBody = @{
  name = $projectName
  gitSource = @{
    ref = $GitRef
    type = "github"
  }
  target = "production"
} | ConvertTo-Json -Depth 4

try {
  Invoke-RestMethod `
    -Method Post `
    -Uri "https://api.vercel.com/v13/deployments?teamId=$VercelOrgId" `
    -Headers $headers `
    -Body $deployBody | Out-Null
}
catch {
  Write-Host "Warning: deployment trigger failed. Use Vercel dashboard to deploy manually. $_"
}

if (-not $SkipDbInit) {
  Write-Host "Running DB initialization"
  & (Join-Path $PSScriptRoot "init-customer-db.ps1") `
    -DatabaseUrl $DatabaseUrl `
    -CustomerCode $CustomerCode `
    -CustomerName $CustomerName
}

Write-Host "Onboarding flow complete for $CustomerCode."
