// Admin-only LOCAL disposable PostgreSQL check. No hosted/remote URL is accepted.
// The template must already contain PLN2 and PLN3. This script creates and drops
// only its own random database and never applies a migration.
import pg from 'npm:pg@8.23.0'
import assert from 'node:assert/strict'

const urlText = Deno.env.get('PLN3_LOCAL_TEMPLATE_URL')
if (!urlText) throw new Error('PLN3_LOCAL_TEMPLATE_URL is required')
const url = new URL(urlText)
if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || url.protocol !== 'postgresql:' || url.search || url.hash) throw new Error('Only an explicitly configured local PostgreSQL template is allowed')
const template = decodeURIComponent(url.pathname.slice(1))
if (!template.startsWith('pln3_template_') || !/^[a-z0-9_]+$/.test(template)) throw new Error('Template database must be named pln3_template_*')

const dbName = 'pln3_verify_' + crypto.randomUUID().replaceAll('-', '')
const adminUrl = new URL(url); adminUrl.pathname = '/postgres'
const testUrl = new URL(url); testUrl.pathname = '/' + dbName
const admin = new pg.Client({ connectionString: adminUrl.toString() })
const clients: pg.Client[] = []
let created = false
await admin.connect()
try {
  await admin.query('CREATE DATABASE "' + dbName + '" TEMPLATE "' + template + '"')
  created = true
  for (let i = 0; i < 3; i++) { const client = new pg.Client({ connectionString: testUrl.toString() }); await client.connect(); clients.push(client) }
  const [setup, composing, writer] = clients
  const ids = { org: crypto.randomUUID(), actor: crypto.randomUUID(), client: crypto.randomUUID(), brand: crypto.randomUUID(), serviceA: crypto.randomUUID(), serviceB: crypto.randomUUID(), stageA: crypto.randomUUID(), stageB: crypto.randomUUID(), fallback: crypto.randomUUID(), template: crypto.randomUUID(), version: crypto.randomUUID(), publication: crypto.randomUUID(), request: crypto.randomUUID() }

  await setup.query('insert into auth.users(id) values($1)', [ids.actor])
  await setup.query('insert into public.organizations(id,name,slug,status) values($1,$2,$3,$4)', [ids.org, 'PLN3 concurrency fixture', ids.org, 'active'])
  await setup.query("insert into public.organization_memberships(organization_id,user_id,member_kind,role,department_id,status) values($1,$2,'team','contributor','content','active')", [ids.org, ids.actor])
  // The frozen legacy activity trigger still validates against the seeded Anka
  // organization while canonical convergence remains compatibility-safe.
  await setup.query("insert into public.organization_memberships(organization_id,user_id,member_kind,role,department_id,status) select id,$1,'team','contributor','content','active' from public.organizations where id='8a6d2c5e-2c99-4ec7-a92f-6d1bd877eb25' on conflict do nothing", [ids.actor])
  await setup.query('insert into public.agency_clients(id,organization_id,name,created_by) values($1,$2,$3,$4)', [ids.client, ids.org, 'PLN3 client', ids.actor])
  await setup.query('insert into public.brands(id,organization_id,client_id,name,is_default,created_by) values($1,$2,$3,$4,true,$5)', [ids.brand, ids.org, ids.client, 'PLN3 brand', ids.actor])
  await setup.query("insert into public.service_catalog(id,organization_id,department_id,slug,name,display_order) values($1,$3,'content','pln3_concurrent_a','PLN3 concurrent A',1),($2,$3,'content','pln3_concurrent_b','PLN3 concurrent B',2)", [ids.serviceA, ids.serviceB, ids.org])
  await setup.query("insert into public.blueprint_stage_catalog(id,organization_id,slug,name,accountable_department_id,display_order,stage_kind) values($1,$4,'pln3_concurrent_a','PLN3 stage A','content',10,'delivery'),($2,$4,'pln3_concurrent_b','PLN3 stage B','content',20,'delivery'),($3,$4,'pln3_concurrent_context','PLN3 context','content',5,'short_prerequisite')", [ids.stageA, ids.stageB, ids.fallback, ids.org])
  await setup.query("insert into public.service_stage_rules(organization_id,service_id,target_stage_id,rule_kind,prerequisite_key,prerequisite_description,accepted_asset_kinds,satisfied_by_stage_slugs,fallback_stage_id) values($1,$2,$4,'primary',null,'','{}','{}',null),($1,$3,$5,'primary',null,'','{}','{}',null),($1,$3,$5,'prerequisite','brand_context','Brand context required','{brand_context}','{}',$6)", [ids.org, ids.serviceA, ids.serviceB, ids.stageA, ids.stageB, ids.fallback])
  await setup.query('insert into public.pipeline_templates(id,organization_id,slug,created_by) values($1,$2,$3,$4)', [ids.template, ids.org, 'pln3_concurrent', ids.actor])
  await setup.query("insert into public.pipeline_template_versions(id,organization_id,pipeline_template_id,version_number,name,service_selection_sha256,created_by) values($1,$2,$3,1,'PLN3 concurrent',$4,$5)", [ids.version, ids.org, ids.template, '1'.repeat(64), ids.actor])
  await setup.query('insert into public.pipeline_template_version_services(organization_id,pipeline_template_id,pipeline_template_version_id,service_id,position) values($1,$2,$3,$4,0),($1,$2,$3,$5,1)', [ids.org, ids.template, ids.version, ids.serviceA, ids.serviceB])
  await setup.query("insert into public.pipeline_template_publications(id,organization_id,pipeline_template_id,pipeline_template_version_id,publication_number,published_rule_manifest,published_rule_sha256,published_by) values($1,$2,$3,$4,1,'{}',$5,$6)", [ids.publication, ids.org, ids.template, ids.version, '2'.repeat(64), ids.actor])

  await composing.query('begin')
  await composing.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({ sub: ids.actor, role: 'authenticated' })])
  await composing.query('set local role authenticated')
  const preview = await composing.query('select public.preview_pipeline_engagement($1,$2,$3,$4) result', [ids.org, ids.version, [ids.serviceA, ids.serviceB], JSON.stringify([])])
  const compose = await composing.query("select public.compose_engagement_from_pipeline_template($1,$2,$3,$4,$5,$6,$7,'project',$8,null,'{}',null,null,'',$9) result", [ids.org, ids.request, ids.version, preview.rows[0].result.preview_rule_sha256, ids.client, ids.brand, 'PLN3 concurrent engagement', [ids.serviceA, ids.serviceB], JSON.stringify([])])
  assert.equal(compose.rows[0].result.idempotent_replay, false)
  const composingPid = (await composing.query('select pg_backend_pid() pid')).rows[0].pid

  const relationNames = ['blueprint_stage_catalog', 'blueprint_stage_dependencies', 'service_catalog', 'service_stage_rules']
  const observed = await setup.query("select class.relname from pg_locks locks join pg_class class on class.oid=locks.relation join pg_namespace namespace on namespace.oid=class.relnamespace where locks.pid=$1 and locks.granted and locks.mode='ShareLock' and namespace.nspname='public' and class.relname=any($2::text[]) order by class.relname", [composingPid, relationNames])
  assert.deepEqual(observed.rows.map((row: { relname: string }) => row.relname), [...relationNames].sort())

  for (const relation of relationNames) {
    await writer.query('begin')
    let blocked = false
    try { await writer.query(`lock table public.${relation} in row exclusive mode nowait`) } catch (error) { blocked = String(error).includes('could not obtain lock') }
    await writer.query('rollback')
    assert.equal(blocked, true, `${relation} must reject a conflicting NOWAIT lock`)
  }

  await writer.query('begin')
  await writer.query("set local lock_timeout = '1s'")
  const started = performance.now()
  let updateTimedOut = false
  try { await writer.query('update public.service_stage_rules set prerequisite_description=prerequisite_description where organization_id=$1', [ids.org]) } catch (error) { updateTimedOut = String(error).includes('lock timeout') }
  const waitedMs = performance.now() - started
  await writer.query('rollback')
  assert.equal(updateTimedOut, true)
  assert.ok(waitedMs >= 900, `writer waited only ${waitedMs}ms`)

  await composing.query('rollback')
  const cleanup = await setup.query("select (select count(*) from public.engagements where organization_id=$1) engagements,(select count(*) from public.engagement_composition_requests where organization_id=$1) requests,(select count(*) from pg_locks where pid=$2 and locktype='relation' and granted and relation=any(array['public.blueprint_stage_catalog'::regclass,'public.blueprint_stage_dependencies'::regclass,'public.service_catalog'::regclass,'public.service_stage_rules'::regclass])) locks", [ids.org, composingPid])
  assert.deepEqual(cleanup.rows[0], { engagements: '0', requests: '0', locks: '0' })
  console.log(`share_locks=4/4; nowait_writers_blocked=4/4; real_update_timed_out=true; wait_ms=${Math.round(waitedMs)}; rollback_clean=true`)
} finally {
  if (clients[1]) await clients[1].query('rollback').catch(() => {})
  if (clients[2]) await clients[2].query('rollback').catch(() => {})
  for (const client of clients) await client.end()
  if (created) await admin.query('DROP DATABASE "' + dbName + '"')
  await admin.end()
}
