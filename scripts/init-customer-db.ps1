param(
  [Parameter(Mandatory = $true)]
  [string]$DatabaseUrl,
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
  & psql "$DatabaseUrl" -v ON_ERROR_STOP=1 -f "$SqlFile"
  if ($LASTEXITCODE -ne 0) {
    throw "psql failed for file: $SqlFile (exit code $LASTEXITCODE)"
  }
}

$root = Split-Path -Parent $PSScriptRoot
$sqlRoot = Join-Path $root "sql"

Invoke-PsqlFile -SqlFile (Join-Path $sqlRoot "schema.sql")
Invoke-PsqlFile -SqlFile (Join-Path $sqlRoot "migrations/001_upload_tracking.sql")
Invoke-PsqlFile -SqlFile (Join-Path $sqlRoot "migrations/002_jo_schema_alignment.sql")
Invoke-PsqlFile -SqlFile (Join-Path $sqlRoot "migrations/003_record_scope_columns.sql")

$escapedCode = $CustomerCode.Replace("'", "''")
$escapedName = $CustomerName.Replace("'", "''")

$seedSql = @"
insert into public.organizations (organization_code, organization_name, timezone)
values ('$escapedCode', '$escapedName', 'UTC')
on conflict (organization_code) do update
set organization_name = excluded.organization_name;
"@

Write-Host "Seeding organization metadata for $CustomerCode"
$seedSql | & psql "$DatabaseUrl" -v ON_ERROR_STOP=1
if ($LASTEXITCODE -ne 0) {
  throw "psql failed while seeding organization metadata (exit code $LASTEXITCODE)"
}

Write-Host "Customer database initialization complete."
