param(
  [Parameter(Mandatory = $true)][string]$PostgresBin,
  [int]$Port = 55439,
  [string]$ClusterParent = [System.IO.Path]::GetTempPath(),
  [switch]$Administration,
  [switch]$Assignment,
  [switch]$Participation,
  [switch]$Recurring
)
$ErrorActionPreference = 'Stop'
if ($Port -lt 1024 -or $Port -gt 65535) { throw 'Use an unprivileged local test port.' }
foreach ($program in @('initdb.exe', 'pg_ctl.exe', 'psql.exe')) {
  if (-not (Test-Path -LiteralPath (Join-Path $PostgresBin $program))) { throw "Missing $program" }
}
$taskParent = Get-Item -LiteralPath $ClusterParent
if (-not $taskParent.PSIsContainer -or ($taskParent.Attributes -band [System.IO.FileAttributes]::ReparsePoint)) {
  throw 'ClusterParent must be an existing physical directory, not a link.'
}
$taskCluster = Join-Path $taskParent.FullName ('anka-n1-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $taskCluster | Out-Null
$taskData = Join-Path $taskCluster 'data'
$started = $false
try {
  & (Join-Path $PostgresBin 'initdb.exe') -D $taskData -U postgres --auth=trust --encoding=UTF8 --no-locale --no-sync
  if ($LASTEXITCODE -ne 0) { throw 'Local initdb failed.' }
  & (Join-Path $PostgresBin 'pg_ctl.exe') -D $taskData -l (Join-Path $taskCluster 'postgres.log') -o "-h 127.0.0.1 -p $Port" -w start
  if ($LASTEXITCODE -ne 0) { throw 'Local PostgreSQL startup failed.' }
  $started = $true
  if ($Recurring) {
    & node (Join-Path $PSScriptRoot 'n1c-run.mjs') $PostgresBin $Port recurring
    if ($LASTEXITCODE -ne 0) { throw 'N1-C recurring delegation validation failed.' }
    & node (Join-Path $PSScriptRoot 'n1c-recurring-concurrency.mjs') $PostgresBin $Port
    if ($LASTEXITCODE -ne 0) { throw 'N1-C recurring delegation concurrency failed.' }
    & (Join-Path $PostgresBin 'psql.exe') -X -h 127.0.0.1 -p $Port -U postgres -d postgres -v ON_ERROR_STOP=1 -f (Join-Path $PSScriptRoot 'n1c_recurring.final-scope.sql')
    if ($LASTEXITCODE -ne 0) { throw 'N1-C recurring final scope validation failed.' }
  } elseif ($Participation) {
    & node (Join-Path $PSScriptRoot 'n1c-run.mjs') $PostgresBin $Port participation
    if ($LASTEXITCODE -ne 0) { throw 'N1-C participation validation failed.' }
    & node (Join-Path $PSScriptRoot 'n1c-participation-concurrency.mjs') $PostgresBin $Port
    if ($LASTEXITCODE -ne 0) { throw 'N1-C participation concurrency failed.' }
  } elseif ($Assignment) {
    & node (Join-Path $PSScriptRoot 'n1c-run.mjs') $PostgresBin $Port
    if ($LASTEXITCODE -ne 0) { throw 'N1-C assignment validation failed.' }
    & node (Join-Path $PSScriptRoot 'n1c-concurrency.mjs') $PostgresBin $Port
    if ($LASTEXITCODE -ne 0) { throw 'N1-C concurrent assignment validation failed.' }
  } else {
  $taskSqlFiles = @('n1_authority_compatibility.fixture.sql', '../migrations/20260919135700_n1_authority_compatibility.sql')
  if ($Administration) {
    $taskSqlFiles += @('n1b_authority_administration.fixture.sql', '../migrations/20260919142833_n1b_authority_administration.sql', 'n1b_authority_administration.behavior.sql')
  } else {
    $taskSqlFiles += @('n1_authority_compatibility.behavior.sql', 'n1_authority_compatibility.service-role.sql')
  }
  $taskSqlArgs = @('-X', '-h', '127.0.0.1', '-p', $Port, '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1')
  foreach ($taskSql in $taskSqlFiles) { $taskSqlArgs += @('-f', (Join-Path $PSScriptRoot $taskSql)) }
  & (Join-Path $PostgresBin 'psql.exe') @taskSqlArgs
  if ($LASTEXITCODE -ne 0) { throw 'N1 isolated SQL validation failed.' }
  }
  if ($Administration -and -not $Assignment -and -not $Participation -and -not $Recurring) {
    & node (Join-Path $PSScriptRoot 'n1b-concurrency.mjs') $PostgresBin $Port
    if ($LASTEXITCODE -ne 0) { throw 'N1-B concurrent SQL validation failed.' }
    & (Join-Path $PSScriptRoot '../../node_modules/.bin/supabase.cmd') db advisors --db-url "postgresql://postgres@127.0.0.1:${Port}/postgres?sslmode=disable" --type security --level warn
    if ($LASTEXITCODE -ne 0) { Write-Warning 'Synthetic local advisor unavailable; not hosted acceptance.' }
  }
  if ($Assignment -or $Participation -or $Recurring) {
    & (Join-Path $PSScriptRoot '../../node_modules/.bin/supabase.cmd') db advisors --db-url "postgresql://postgres@127.0.0.1:${Port}/postgres?sslmode=disable" --type security --level warn
    if ($LASTEXITCODE -ne 0) { Write-Warning 'Synthetic local advisor unavailable; not hosted acceptance.' }
  }
} finally {
  if ($started) {
    & (Join-Path $PostgresBin 'pg_ctl.exe') -D $taskData -m fast -w stop
    if ($LASTEXITCODE -ne 0) { Write-Warning 'Local PostgreSQL did not stop successfully.' }
  }
  Write-Output "Isolated test cluster retained (not shared/live): $taskCluster"
}
