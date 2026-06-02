param(
  [Parameter(Mandatory = $true)]
  [string]$CustomerCode,
  [Parameter(Mandatory = $true)]
  [string]$CustomerName,
  [Parameter(Mandatory = $true)]
  [string]$DatabaseUrl,
  [string]$DatabaseUrlUnpooled = "",
  [Parameter(Mandatory = $true)]
  [string]$GitHubRepoId,
  [Parameter(Mandatory = $true)]
  [string]$GitHubRepoOwner,
  [Parameter(Mandatory = $true)]
  [string]$GitHubRepoName,
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

function Sanitize-DbUrl {
  param([string]$Url)
  return ($Url -replace '([?&])channel_binding=require', '')
}

$DatabaseUrl = Sanitize-DbUrl $DatabaseUrl
if ($DatabaseUrlUnpooled) {
  $DatabaseUrlUnpooled = Sanitize-DbUrl $DatabaseUrlUnpooled
}

Write-Host "Ensuring Vercel project $projectName exists"
$gitRepository = @{
  type = "github"
  org = $GitHubRepoOwner
  repo = $GitHubRepoName
  repoId = [long]$GitHubRepoId
  productionBranch = $GitRef
}
$projectBody = @{
  name = $projectName
  framework = "nextjs"
  gitRepository = $gitRepository
} | ConvertTo-Json

$fallbackProjectBody = @{
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
  Write-Host "Git-linked project create failed; retrying without Git connection. $_"
  try {
    Invoke-RestMethod `
      -Method Post `
      -Uri "https://api.vercel.com/v10/projects?teamId=$VercelOrgId" `
      -Headers $headers `
      -Body $fallbackProjectBody | Out-Null
    Write-Host "Project created without Git link."
  }
  catch {
    Write-Host "Project likely exists already, continuing."
  }
}

$envValues = @(
  @{ key = "CUSTOMER_CODE"; value = $CustomerCode },
  @{ key = "CUSTOMER_NAME"; value = $CustomerName },
  @{ key = "DATABASE_URL"; value = $DatabaseUrl },
  @{ key = "AI_DATABASE_URL"; value = $DatabaseUrl }
)
if ($DatabaseUrlUnpooled) {
  $envValues += @{ key = "DATABASE_URL_UNPOOLED"; value = $DatabaseUrlUnpooled }
  $envValues += @{ key = "AI_DATABASE_URL_UNPOOLED"; value = $DatabaseUrlUnpooled }
}

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
  project = $projectName
  gitSource = @{
    type = "github"
    org = $GitHubRepoOwner
    repo = $GitHubRepoName
    repoId = [long]$GitHubRepoId
    ref = $GitRef
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
    -DatabaseUrlUnpooled $DatabaseUrlUnpooled `
    -CustomerCode $CustomerCode `
    -CustomerName $CustomerName
}

Write-Host "Onboarding flow complete for $CustomerCode."
