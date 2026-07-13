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
  & psql --dbname="$targetUrl" -v ON_ERROR_STOP=1 -f "$SqlFile"
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
  $result = & psql --dbname="$targetUrl" -t -A -v ON_ERROR_STOP=1 -c "$query"
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

# sql/schema.sql is a consolidated dump that already bakes in the effect of
# migrations 001-013 (confirmed: jo_records already has vip_code/respond_time/
# total_minute_between_created_to_completed etc. from 010-013, and
# ai_chart_definitions/mo_records/co_records from 005-009). Re-running those
# numbered files here would fail on a database created from schema.sql, since
# none of them guard with IF NOT EXISTS. Only 014 adds columns schema.sql
# predates, and it is itself IF-NOT-EXISTS-guarded, so it's safe to apply
# whether the database came from schema.sql just now or was provisioned before.
Invoke-PsqlFile -SqlFile (Join-Path $sqlRoot "migrations/014_upload_jobs_hotel_identity.sql")

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
$seedSql | & psql --dbname="$seedTargetUrl" -v ON_ERROR_STOP=1
if ($LASTEXITCODE -ne 0) {
  throw "psql failed while seeding organization metadata (exit code $LASTEXITCODE)"
}

Write-Host "Customer database initialization complete."
