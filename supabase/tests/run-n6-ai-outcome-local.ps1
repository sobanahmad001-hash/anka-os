param(
  [Parameter(Mandatory = $true)][string]$PostgresBin,
  [int]$Port = 55923,
  [string]$ClusterParent = [System.IO.Path]::GetTempPath(),
  [string]$NodeBin = 'node'
)
$ErrorActionPreference = 'Stop'
if ($Port -lt 1024 -or $Port -gt 65535) { throw 'Choose an unprivileged local test port.' }
foreach ($name in @('initdb.exe','pg_ctl.exe','psql.exe')) {
  if (-not (Test-Path -LiteralPath (Join-Path $PostgresBin $name))) { throw "Missing $name" }
}
$parent = Get-Item -LiteralPath $ClusterParent
if (-not $parent.PSIsContainer -or ($parent.Attributes -band [System.IO.FileAttributes]::ReparsePoint)) {
  throw 'ClusterParent must be a physical directory.'
}
$cluster = Join-Path $parent.FullName ('anka-n6-ai-outcome-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $cluster | Out-Null
$data = Join-Path $cluster 'data'
$log = Join-Path $cluster 'postgres.log'
$initdb = Join-Path $PostgresBin 'initdb.exe'
$pgCtl = Join-Path $PostgresBin 'pg_ctl.exe'
$psql = Join-Path $PostgresBin 'psql.exe'
$started = $false
function Invoke-LocalSql([string]$path) {
  & $psql -X -h 127.0.0.1 -p $Port -U postgres -d postgres -v ON_ERROR_STOP=1 -q -f $path
  if ($LASTEXITCODE -ne 0) { throw "Local SQL failed: $path" }
}
try {
  & $initdb -A trust -U postgres -D $data --no-instructions | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'Local initdb failed.' }
  & $pgCtl -D $data -l $log -o "-h 127.0.0.1 -p $Port" -w start
  if ($LASTEXITCODE -ne 0) { throw 'Local PostgreSQL start failed.' }
  $started = $true
  Invoke-LocalSql (Join-Path $PSScriptRoot 'n6-ai-outcome-fixture.sql')
  Invoke-LocalSql (Join-Path $PSScriptRoot '..\migrations\20260922150000_n6_step_budget_reservations.sql')
  Invoke-LocalSql (Join-Path $PSScriptRoot '..\migrations\20260922170000_n6_ai_attempt_handoff.sql')
  Invoke-LocalSql (Join-Path $PSScriptRoot '..\migrations\20260922180000_n6_ai_outcome_lineage.sql')
  Invoke-LocalSql (Join-Path $PSScriptRoot 'n6-ai-outcome-behavior.sql')
  Write-Output "N6 isolated AI-outcome checks passed. Cluster: $cluster"
}
finally {
  if ($started) {
    & $pgCtl -D $data -m fast -w stop
    if ($LASTEXITCODE -ne 0) { Write-Warning "Could not stop local cluster: $cluster" }
  }
}
