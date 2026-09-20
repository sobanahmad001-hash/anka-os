// Local-only two-session regression for N4 preset publication/catalogue races.
// Run against a disposable database whose name starts with n4_preset_.
import { spawn } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const [psql, portText, database, option] = process.argv.slice(2)
const port = Number(portText)
if (!psql || basename(psql).toLowerCase() !== 'psql.exe'
  || !Number.isInteger(port) || port < 1024 || port > 65535
  || !/^n4_preset_[a-z0-9_]+$/.test(database || '')
  || (option && option !== '--skip-fixture')) {
  throw new Error('Usage: node scripts/n4-preset-concurrency.mjs <local psql.exe> <local port> <n4_preset_* database> [--skip-fixture]')
}
const args = ['-X', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-h', '127.0.0.1', '-p', String(port), '-U', 'postgres', '-d', database]
const ownerClaims = '{"sub":"b4000000-0000-4000-8000-000000000002","role":"authenticated"}'
const serviceId = 'b4000000-0000-4000-8000-000000000011'
const version = number => `(select version.id from public.pipeline_template_versions version join public.pipeline_templates template on template.id=version.pipeline_template_id where template.slug='n4_concurrency' and version.version_number=${number})`
const root = mkdtempSync(join(tmpdir(), 'anka-n4-concurrency-'))
let sequence = 0

function start(sql, { timeoutMs = 40000 } = {}) {
  const file = join(root, `session-${++sequence}.sql`)
  writeFileSync(file, sql, 'utf8')
  const child = spawn(psql, [...args, '-f', file], { windowsHide: true })
  let output = ''
  child.stdout.on('data', chunk => { output += chunk.toString() })
  child.stderr.on('data', chunk => { output += chunk.toString() })
  const done = new Promise((resolve, reject) => {
    const timer = setTimeout(() => { child.kill(); reject(new Error(`Local psql session timed out: ${output}`)) }, timeoutMs)
    child.on('error', error => { clearTimeout(timer); reject(error) })
    child.on('close', code => { clearTimeout(timer); resolve({ code, output }) })
  })
  async function marker(value) {
    const deadline = Date.now() + 10000
    while (Date.now() < deadline) {
      if (output.includes(value)) return
      if (child.exitCode !== null) throw new Error(`Expected ${value} before session exit: ${output}`)
      await new Promise(resolve => setTimeout(resolve, 50))
    }
    throw new Error(`Timed out waiting for ${value}: ${output}`)
  }
  return { done, marker }
}

async function run(sql) {
  return start(sql).done
}
function requireSuccess(result, label) {
  if (result.code !== 0) throw new Error(`${label} failed: ${result.output}`)
  return result.output.trim()
}
function requireFailure(result, pattern, label) {
  if (result.code === 0 || !pattern.test(result.output)) throw new Error(`${label} did not fail as required: ${result.output}`)
}

const fixture = fileURLToPath(new URL('../supabase/tests/n4_pipeline_preset_concurrency.fixture.sql', import.meta.url))
if (option !== '--skip-fixture') {
  requireSuccess(await start(`\\i '${fixture.replaceAll('\\', '/')}'\n`).done, 'synthetic local fixture')
}
const ready = requireSuccess(await run(`
select (select count(*) from public.pipeline_template_versions version join public.pipeline_templates template on template.id=version.pipeline_template_id where template.slug='n4_concurrency')=2
  and (select count(*) from public.pipeline_template_department_approvals approval join public.pipeline_template_versions version on version.id=approval.pipeline_template_version_id join public.pipeline_templates template on template.id=version.pipeline_template_id where template.slug='n4_concurrency')=4;
`), 'fixture check')
if (!ready.includes('t')) throw new Error(`Two approved fixture versions required: ${ready}`)

const publisherOne = start(`
begin;
set local role authenticated;
select set_config('request.jwt.claims','${ownerClaims}',true);
select public.publish_pipeline_template_version(${version(1)});
\\echo PUBLISHED_ONE
select pg_sleep(12);
commit;
`)
await publisherOne.marker('PUBLISHED_ONE')
for (const [field, value] of [['department_id', "'development'"], ['is_active', 'false']]) {
  const result = await run(`
begin;
set local role authenticated;
select set_config('request.jwt.claims','${ownerClaims}',true);
set local lock_timeout='1200ms';
update public.service_catalog set ${field}=${value} where id='${serviceId}';
commit;
`)
  requireFailure(result, /lock timeout/i, `concurrent ${field} change`)
}
requireSuccess(await publisherOne.done, 'first publication')
const firstManifest = requireSuccess(await run(`
select exists(select 1 from public.pipeline_template_publications publication,
 jsonb_array_elements(publication.published_rule_manifest->'services') service
 where publication.pipeline_template_version_id=${version(1)}
 and service->>'id'='${serviceId}' and service->>'department_id'='design'
 and (service->>'is_active')::boolean);
`), 'first publication snapshot')
if (!firstManifest.includes('t')) throw new Error(`Published manifest changed under lock: ${firstManifest}`)

const updater = start(`
begin;
set local role authenticated;
select set_config('request.jwt.claims','${ownerClaims}',true);
update public.service_catalog set department_id='development' where id='${serviceId}';
\\echo UPDATED_BEFORE_PUBLISH
select pg_sleep(12);
commit;
`)
await updater.marker('UPDATED_BEFORE_PUBLISH')
const secondPublication = run(`
begin;
set local role authenticated;
select set_config('request.jwt.claims','${ownerClaims}',true);
set local statement_timeout='30000ms';
select public.publish_pipeline_template_version(${version(2)});
commit;
`)
requireSuccess(await updater.done, 'catalogue reassignment')
requireFailure(await secondPublication, /Current approval from a head of department development/i, 'publication after reassignment')
const secondAbsent = requireSuccess(await run(`select count(*) from public.pipeline_template_publications where pipeline_template_version_id=${version(2)};`), 'second publication absence')
if (secondAbsent !== '0') throw new Error(`Unapproved department publication persisted: ${secondAbsent}`)
console.log('PASS two-session N4 regression: concurrent catalogue changes wait behind publication; a prior reassignment forces current-department reapproval')
