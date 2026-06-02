param(
  [Parameter(Mandatory = $true)]
  [string]$DatabaseUrl,
  [Parameter(Mandatory = $false)]
  [string]$DatabaseUrlUnpooled = "",
  [Parameter(Mandatory = $true)]
  [string]$CustomerCode,
  [Parameter(Mandatory = $true)]
  [string]$CustomerName
)

$ErrorActionPreference = "Stop"

function Invoke-PsqlFile {
  param(
    [Parameter(Mandatory = $true)]
    [string]$SqlFile
  )

  if (-not (Test-Path -LiteralPath $SqlFile)) {
    throw "SQL file not found: $SqlFile"
  }

  Write-Host "Applying $SqlFile"
  $targetUrl = if ($DatabaseUrlUnpooled) { $DatabaseUrlUnpooled } else { $DatabaseUrl }
  $targetUrl = $targetUrl -replace '([?&])channel_binding=require', ''
  & psql "$targetUrl" -v ON_ERROR_STOP=1 -f "$SqlFile"
  if ($LASTEXITCODE -ne 0) {
    throw "psql failed for file: $SqlFile (exit code $LASTEXITCODE)"
  }
}

$root = Split-Path -Parent $PSScriptRoot
$sqlRoot = Join-Path $root "sql"

function Test-TableExists {
  param(
    [Parameter(Mandatory = $true)]
    [string]$TableName
  )

  $query = "select to_regclass('public.$TableName') is not null as exists;"
  $targetUrl = if ($DatabaseUrlUnpooled) { $DatabaseUrlUnpooled } else { $DatabaseUrl }
  $targetUrl = $targetUrl -replace '([?&])channel_binding=require', ''
  $result = & psql "$targetUrl" -t -A -v ON_ERROR_STOP=1 -c "$query"
  if ($LASTEXITCODE -ne 0) {
    throw "Failed checking table existence for $TableName (exit code $LASTEXITCODE)"
  }

  return ($result.Trim().ToLowerInvariant() -eq "t")
}

$hasUploadJobs = Test-TableExists -TableName "upload_jobs"
if (-not $hasUploadJobs) {
  Write-Host "Fresh database detected; applying baseline schema.sql"
  Invoke-PsqlFile -SqlFile (Join-Path $sqlRoot "schema.sql")
}
else {
  Write-Host "Existing database detected; skipping baseline schema.sql"
}

Invoke-PsqlFile -SqlFile (Join-Path $sqlRoot "migrations/001_upload_tracking.sql")
Invoke-PsqlFile -SqlFile (Join-Path $sqlRoot "migrations/002_jo_schema_alignment.sql")
Invoke-PsqlFile -SqlFile (Join-Path $sqlRoot "migrations/003_record_scope_columns.sql")
Invoke-PsqlFile -SqlFile (Join-Path $sqlRoot "migrations/004_bigint_id_defaults.sql")
Invoke-PsqlFile -SqlFile (Join-Path $sqlRoot "migrations/005_ai_chart_playground.sql")

$escapedCode = $CustomerCode.Replace("'", "''")
$escapedName = $CustomerName.Replace("'", "''")

$seedSql = @"
insert into public.organizations (organization_code, organization_name, timezone)
values ('$escapedCode', '$escapedName', 'UTC')
on conflict (organization_code) do update
set organization_name = excluded.organization_name;
"@

Write-Host "Seeding organization metadata for $CustomerCode"
$seedTargetUrl = if ($DatabaseUrlUnpooled) { $DatabaseUrlUnpooled } else { $DatabaseUrl }
$seedTargetUrl = $seedTargetUrl -replace '([?&])channel_binding=require', ''
$seedSql | & psql "$seedTargetUrl" -v ON_ERROR_STOP=1
if ($LASTEXITCODE -ne 0) {
  throw "psql failed while seeding organization metadata (exit code $LASTEXITCODE)"
}

Write-Host "Customer database initialization complete."
