param(
  [Parameter(Mandatory = $true)][string]$PostgresBin,
  [int]$Port = 55924,
  [string]$ClusterParent = [System.IO.Path]::GetTempPath()
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
$cluster = Join-Path $parent.FullName ('anka-n6-dispatch-' + [guid]::NewGuid().ToString('N'))
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
  Invoke-LocalSql (Join-Path $PSScriptRoot 'n6-ai-attempt-fixture.sql')
  Invoke-LocalSql (Join-Path $PSScriptRoot '..\migrations\20260922150000_n6_step_budget_reservations.sql')
  Invoke-LocalSql (Join-Path $PSScriptRoot '..\migrations\20260922170000_n6_ai_attempt_handoff.sql')
  Invoke-LocalSql (Join-Path $PSScriptRoot 'n6-ai-attempt-behavior.sql')
  Invoke-LocalSql (Join-Path $PSScriptRoot '..\migrations\20260922200000_n6_single_use_dispatch_claim.sql')
  Invoke-LocalSql (Join-Path $PSScriptRoot 'n6-dispatch-claim-behavior.sql')
  # Two sessions race for the other prepared step. The first transaction holds
  # the progress row lock while the second reaches the claim.
  & $psql -X -h 127.0.0.1 -p $Port -U postgres -d postgres -v ON_ERROR_STOP=1 -q -c "update public.ai_execution_step_progress set status='waiting' where configured_step_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'"
  if ($LASTEXITCODE -ne 0) { throw 'Could not reset local race fixture.' }
  $claimSql = "select public.claim_pipeline_ai_step_dispatch('11111111-1111-4111-8111-111111111111',id,'07070707-0707-4707-8707-070707070707',repeat('d',64)) from private.ai_execution_step_attempts where configured_step_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'"
  $first = Start-Job -ScriptBlock {
    param($exe,$pgPort,$statement)
    & $exe -X -h 127.0.0.1 -p $pgPort -U postgres -d postgres -v ON_ERROR_STOP=1 -At -c "begin; $statement; select pg_sleep(2); commit;"
    if ($LASTEXITCODE -ne 0) { throw 'First claim session failed.' }
  } -ArgumentList $psql,$Port,$claimSql
  Start-Sleep -Milliseconds 300
  $second = Start-Job -ScriptBlock {
    param($exe,$pgPort,$statement)
    & $exe -X -h 127.0.0.1 -p $pgPort -U postgres -d postgres -v ON_ERROR_STOP=1 -At -c $statement
    if ($LASTEXITCODE -ne 0) { throw 'Second claim session failed.' }
  } -ArgumentList $psql,$Port,$claimSql
  $null = @($first,$second) | Wait-Job
  $firstOutput = (@($first | Receive-Job) -join ' ')
  $secondOutput = (@($second | Receive-Job) -join ' ')
  if ($first.State -ne 'Completed' -or $second.State -ne 'Completed' -or $firstOutput -notmatch '"status": "claimed"' -or $secondOutput -notmatch '"status": "already_claimed"') {
    throw "Concurrent claim race failed: first=$firstOutput second=$secondOutput"
  }
  Remove-Job $first,$second
  $claimCount = & $psql -X -h 127.0.0.1 -p $Port -U postgres -d postgres -v ON_ERROR_STOP=1 -At -c "select count(*) from private.ai_execution_dispatch_claims where dispatch_request_id='07070707-0707-4707-8707-070707070707'"
  if ($LASTEXITCODE -ne 0 -or $claimCount -ne '1') { throw 'Concurrent claim persisted more than once.' }  Write-Output "N6 isolated dispatch-claim checks passed. Cluster: $cluster"
}
finally {
  if ($started) {
    & $pgCtl -D $data -m fast -w stop
    if ($LASTEXITCODE -ne 0) { Write-Warning "Could not stop local cluster: $cluster" }
  }
}
