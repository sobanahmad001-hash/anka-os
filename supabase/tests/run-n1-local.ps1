param(
  [Parameter(Mandatory = $true)][string]$PostgresBin,
  [int]$Port = 55439
)
$ErrorActionPreference = 'Stop'
if ($Port -lt 1024 -or $Port -gt 65535) { throw 'Use an unprivileged local test port.' }
foreach ($program in @('initdb.exe', 'pg_ctl.exe', 'psql.exe')) {
  if (-not (Test-Path -LiteralPath (Join-Path $PostgresBin $program))) { throw "Missing $program" }
}
$taskCluster = Join-Path ([System.IO.Path]::GetTempPath()) ('anka-n1-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $taskCluster | Out-Null
$taskData = Join-Path $taskCluster 'data'
$started = $false
try {
  & (Join-Path $PostgresBin 'initdb.exe') -D $taskData -U postgres --auth=trust --encoding=UTF8 --no-locale --no-sync
  if ($LASTEXITCODE -ne 0) { throw 'Local initdb failed.' }
  & (Join-Path $PostgresBin 'pg_ctl.exe') -D $taskData -l (Join-Path $taskCluster 'postgres.log') -o "-h 127.0.0.1 -p $Port" -w start
  if ($LASTEXITCODE -ne 0) { throw 'Local PostgreSQL startup failed.' }
  $started = $true
  & (Join-Path $PostgresBin 'psql.exe') -X -h 127.0.0.1 -p $Port -U postgres -d postgres -v ON_ERROR_STOP=1 `
    -f (Join-Path $PSScriptRoot 'n1_authority_compatibility.fixture.sql') `
    -f (Join-Path $PSScriptRoot '../migrations/20260919135700_n1_authority_compatibility.sql') `
    -f (Join-Path $PSScriptRoot 'n1_authority_compatibility.behavior.sql')
  if ($LASTEXITCODE -ne 0) { throw 'N1 isolated SQL validation failed.' }
} finally {
  if ($started) {
    & (Join-Path $PostgresBin 'pg_ctl.exe') -D $taskData -m fast -w stop
    if ($LASTEXITCODE -ne 0) { Write-Warning 'Local PostgreSQL did not stop successfully.' }
  }
  Write-Output "Isolated test cluster retained (not shared/live): $taskCluster"
}
