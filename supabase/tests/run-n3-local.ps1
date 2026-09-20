param(
  [Parameter(Mandatory = $true)][string]$PostgresBin,
  [int]$Port = 55459,
  [string]$ClusterParent = [System.IO.Path]::GetTempPath()
)
$ErrorActionPreference = 'Stop'
if ($Port -lt 1024 -or $Port -gt 65535) { throw 'Use an unprivileged local test port.' }
foreach ($program in @('initdb.exe', 'pg_ctl.exe', 'psql.exe')) {
  if (-not (Test-Path -LiteralPath (Join-Path $PostgresBin $program))) { throw "Missing $program" }
}
$parent = Get-Item -LiteralPath $ClusterParent
if (-not $parent.PSIsContainer -or ($parent.Attributes -band [System.IO.FileAttributes]::ReparsePoint)) {
  throw 'ClusterParent must be an existing physical directory.'
}
$cluster = Join-Path $parent.FullName ('anka-n3-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $cluster | Out-Null
$data = Join-Path $cluster 'data'
$started = $false
try {
  & (Join-Path $PostgresBin 'initdb.exe') -D $data -U postgres --auth=trust --encoding=UTF8 --no-locale --no-sync | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'Local initdb failed.' }
  & (Join-Path $PostgresBin 'pg_ctl.exe') -D $data -l (Join-Path $cluster 'postgres.log') -o "-h 127.0.0.1 -p $Port" -w start
  if ($LASTEXITCODE -ne 0) { throw 'Local PostgreSQL startup failed.' }
  $started = $true
  foreach ($file in @(
    (Join-Path $PSScriptRoot 'n2_project_draft.fixture.sql'),
    (Join-Path $PSScriptRoot 'n3_project_discussion.fixture.sql'),
    (Join-Path $PSScriptRoot '../migrations/20260920020000_n3_project_discussion.sql'),
    (Join-Path $PSScriptRoot 'n3_project_discussion.behavior.sql')
  )) {
    & (Join-Path $PostgresBin 'psql.exe') -X -h 127.0.0.1 -p $Port -U postgres -d postgres -v ON_ERROR_STOP=1 -q -f $file | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "N3 local SQL verification failed: $file" }
  }
  Write-Output 'N3 local project discussion authority and history checks passed.'
} finally {
  if ($started) {
    & (Join-Path $PostgresBin 'pg_ctl.exe') -D $data -m fast -w stop
    if ($LASTEXITCODE -ne 0) { Write-Warning 'Local PostgreSQL did not stop successfully.' }
  }
  Write-Output "Isolated local test cluster retained: $cluster"
}
