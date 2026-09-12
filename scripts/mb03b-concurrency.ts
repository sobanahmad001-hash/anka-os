// Admin-only LOCAL PostgreSQL proof. The template must already contain MB03B.
// This accepts loopback only, clones/drops only its own random database, and never
// applies a migration or contacts a hosted database.
import pg from 'npm:pg@8.23.0'
import assert from 'node:assert/strict'

const urlText = Deno.env.get('MB03B_LOCAL_TEMPLATE_URL')
if (!urlText) throw new Error('MB03B_LOCAL_TEMPLATE_URL is required; no database was touched')
const url = new URL(urlText)
if (url.protocol !== 'postgresql:' || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || url.search || url.hash) {
  throw new Error('Only an explicitly configured loopback PostgreSQL template is allowed')
}
const template = decodeURIComponent(url.pathname.slice(1))
if (!template.startsWith('mb03b_template_') || !/^[a-z0-9_]+$/.test(template)) {
  throw new Error('Template database must be named mb03b_template_*')
}

const database = 'mb03b_verify_' + crypto.randomUUID().replaceAll('-', '')
const adminUrl = new URL(url); adminUrl.pathname = '/postgres'
const testUrl = new URL(url); testUrl.pathname = '/' + database
const admin = new pg.Client({ connectionString: adminUrl.toString() })
const clients: pg.Client[] = []
let created = false

async function beginService(client: pg.Client) {
  await client.query('begin')
  await client.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({ role: 'service_role' })])
  await client.query('set local role service_role')
}

await admin.connect()
try {
  const guard = await admin.query('select inet_server_addr()::text address, exists(select 1 from pg_database where datname=$1) template_exists', [template])
  assert.ok(['127.0.0.1', '127.0.0.1/32', '::1', '::1/128'].includes(guard.rows[0].address), 'PostgreSQL server is not loopback')
  assert.equal(guard.rows[0].template_exists, true, 'MB03B local template does not exist')
  await admin.query('CREATE DATABASE "' + database + '" TEMPLATE "' + template + '"')
  created = true
  for (let index = 0; index < 3; index += 1) {
    const client = new pg.Client({ connectionString: testUrl.toString() }); await client.connect(); clients.push(client)
  }
  const [setup, first, second] = clients
  const ids = { actor: crypto.randomUUID(), org: crypto.randomUUID(), client: crypto.randomUUID(), brand: crypto.randomUUID(), engagement: crypto.randomUUID(), service: crypto.randomUUID() }
  await setup.query('insert into auth.users(id) values($1)', [ids.actor])
  await setup.query("insert into public.organizations(id,name,slug,status) values($1,'MB03B concurrency',$2,'active')", [ids.org, 'mb03b-' + ids.org])
  await setup.query("insert into public.organization_memberships(organization_id,user_id,member_kind,role,department_id,status) values($1,$2,'team','contributor','marketing','active')", [ids.org, ids.actor])
  await setup.query("insert into public.agency_clients(id,organization_id,name,created_by) values($1,$2,'MB03B client',$3)", [ids.client, ids.org, ids.actor])
  await setup.query("insert into public.brands(id,organization_id,client_id,name,is_default,created_by) values($1,$2,$3,'MB03B brand',true,$4)", [ids.brand, ids.org, ids.client, ids.actor])
  await setup.query("insert into public.engagements(id,organization_id,client_id,brand_id,name,status,created_by) values($1,$2,$3,$4,'MB03B engagement','active',$5)", [ids.engagement, ids.org, ids.client, ids.brand, ids.actor])
  await setup.query("insert into public.service_catalog(id,organization_id,department_id,slug,name,is_active) values($1,$2,'marketing','mb03b_concurrency','MB03B concurrency',true)", [ids.service, ids.org])
  await setup.query("insert into public.engagement_services(organization_id,engagement_id,service_id,status,activated_by) values($1,$2,$3,'active',$4)", [ids.org, ids.engagement, ids.service, ids.actor])
  const content = { input: { research_type: 'page', target_url: 'https://example.test/page', market: 'Test market', language: null, device: null, seed_keywords: [], content_strategy_version_id: null }, captured_at: '2026-09-12T00:00:00Z', source_availability: [], source_facts: [], interpretations: [], limitations: ['Stored evidence only.'] }
  const save = (client: pg.Client, key: string) => client.query(
    "select public.save_marketing_seo_research($1,$2,null,null,'Race research',$3::jsonb,$4,'race',$5,$6,$7) result",
    [ids.org, ids.engagement, JSON.stringify(content), 'a'.repeat(64), key, 'b'.repeat(64), ids.actor],
  )
  async function sameKeyRace(key: string) {
    await beginService(first)
    const winner = await save(first, key)
    let contenderSettled = false
    const contender = (async () => {
      await beginService(second)
      const result = await save(second, key)
      await second.query('commit')
      contenderSettled = true
      return result
    })()
    await new Promise(resolve => setTimeout(resolve, 150))
    assert.equal(contenderSettled, false, 'concurrent save did not wait on the idempotency advisory lock')
    await first.query('commit')
    const replay = await contender
    assert.equal(winner.rows[0].result.replayed, false)
    assert.equal(replay.rows[0].result.replayed, true)
    assert.equal(replay.rows[0].result.id, winner.rows[0].result.id)
    return winner.rows[0].result
  }
  const key = crypto.randomUUID()
  await sameKeyRace(key)
  await setup.query("update public.marketing_seo_research_save_requests set created_at=clock_timestamp()-interval '31 days', expires_at=clock_timestamp()-interval '1 second' where organization_id=$1 and actor_id=$2 and idempotency_key=$3", [ids.org, ids.actor, key])
  const fresh = await sameKeyRace(key)
  const counts = await setup.query("select (select count(*)::int from public.marketing_seo_research_save_requests where organization_id=$1) ledgers, (select count(*)::int from public.artifacts where organization_id=$1 and artifact_type='seo_research') artifacts, (select count(*)::int from public.artifact_versions av join public.artifacts a on a.id=av.artifact_id and a.organization_id=av.organization_id where av.organization_id=$1 and a.artifact_type='seo_research') versions", [ids.org])
  assert.deepEqual(counts.rows[0], { ledgers: 1, artifacts: 2, versions: 2 })
  assert.equal(fresh.version_number, 1)
  console.log('loopback_clone=true; same_key_race=one_write_one_replay; expired_key_race=one_fresh_write_one_replay; ledgers=1; artifacts=2; versions=2')
} finally {
  for (const client of clients) { await client.query('rollback').catch(() => {}); await client.end() }
  if (created) await admin.query('DROP DATABASE "' + database + '"')
  await admin.end()
}
