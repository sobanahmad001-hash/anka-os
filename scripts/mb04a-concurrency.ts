// Admin-only LOCAL PostgreSQL 17 proof. The template must already contain MB04A.
// This accepts loopback only, clones/drops only its own random database, and never
// applies a migration or contacts a hosted database.
import pg from 'npm:pg@8.23.0'
import assert from 'node:assert/strict'

const urlText = Deno.env.get('MB04A_LOCAL_TEMPLATE_URL')
if (!urlText) throw new Error('MB04A_LOCAL_TEMPLATE_URL is required; no database was touched')
const url = new URL(urlText)
if (url.protocol !== 'postgresql:' || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || url.search || url.hash) {
  throw new Error('Only an explicitly configured loopback PostgreSQL template is allowed')
}
const template = decodeURIComponent(url.pathname.slice(1))
if (!template.startsWith('mb04a_template_') || !/^[a-z0-9_]+$/.test(template)) {
  throw new Error('Template database must be named mb04a_template_*')
}

const database = 'mb04a_verify_' + crypto.randomUUID().replaceAll('-', '')
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
  const guard = await admin.query(
    'select inet_server_addr()::text address, exists(select 1 from pg_database where datname=$1) template_exists',
    [template],
  )
  assert.ok(['127.0.0.1', '127.0.0.1/32', '::1', '::1/128'].includes(guard.rows[0].address), 'PostgreSQL server is not loopback')
  assert.equal(guard.rows[0].template_exists, true, 'MB04A local template does not exist')
  await admin.query('CREATE DATABASE "' + database + '" TEMPLATE "' + template + '"')
  created = true

  for (let index = 0; index < 3; index++) {
    const client = new pg.Client({ connectionString: testUrl.toString() })
    await client.connect()
    clients.push(client)
  }
  const [setup, first, second] = clients
  const ids = {
    actor: crypto.randomUUID(), org: crypto.randomUUID(), agencyClient: crypto.randomUUID(),
    brand: crypto.randomUUID(), engagement: crypto.randomUUID(), service: crypto.randomUUID(),
    campaign: crypto.randomUUID(),
  }
  await setup.query('insert into auth.users(id) values($1)', [ids.actor])
  await setup.query("insert into public.organizations(id,name,slug,status) values($1,'MB04A concurrency',$2,'active')", [ids.org, 'mb04a-' + ids.org])
  await setup.query("insert into public.organization_memberships(organization_id,user_id,member_kind,role,status) values($1,$2,'team','system_owner','active')", [ids.org, ids.actor])
  await setup.query("insert into public.agency_clients(id,organization_id,name,created_by) values($1,$2,'MB04A client',$3)", [ids.agencyClient, ids.org, ids.actor])
  await setup.query("insert into public.brands(id,organization_id,client_id,name,is_default,created_by) values($1,$2,$3,'MB04A brand',true,$4)", [ids.brand, ids.org, ids.agencyClient, ids.actor])
  await setup.query("insert into public.engagements(id,organization_id,client_id,brand_id,name,status,created_by) values($1,$2,$3,$4,'MB04A engagement','active',$5)", [ids.engagement, ids.org, ids.agencyClient, ids.brand, ids.actor])
  await setup.query("insert into public.service_catalog(id,organization_id,department_id,slug,name,is_active) values($1,$2,'marketing','mb04a_concurrency','MB04A concurrency',true)", [ids.service, ids.org])
  await setup.query("insert into public.engagement_services(organization_id,engagement_id,service_id,status,activated_by) values($1,$2,$3,'active',$4)", [ids.org, ids.engagement, ids.service, ids.actor])
  await setup.query("insert into public.marketing_campaigns(id,organization_id,engagement_id,brand_id,name,planned_channels,created_by,updated_by) values($1,$2,$3,$4,'MB04A campaign',array['email'],$5,$5)", [ids.campaign, ids.org, ids.engagement, ids.brand, ids.actor])

  async function save(client: pg.Client, expected: string | null, title: string) {
    return client.query(
      "select public.save_marketing_campaign_plan_draft($1,$2,$3,$4,$5,'Qualified demand',array['Email'],null,null,'','',null,null,'[]'::jsonb,$6,null,$7) result",
      [ids.org, ids.engagement, ids.campaign, expected, title, title, ids.actor],
    )
  }
  async function race(expected: string | null, version: number) {
    await beginService(first)
    const winner = await save(first, expected, 'Winner ' + version)
    let contenderSettled = false
    const contender = (async () => {
      await beginService(second)
      try {
        await save(second, expected, 'Contender ' + version)
        await second.query('commit')
        return null
      } catch (error) {
        await second.query('rollback')
        return error as { code?: string; message?: string }
      } finally {
        contenderSettled = true
      }
    })()
    await new Promise(resolve => setTimeout(resolve, 150))
    assert.equal(contenderSettled, false, 'concurrent save did not wait on the campaign advisory lock')
    await first.query('commit')
    const stale = await contender
    assert.equal(stale?.code, '40001')
    assert.match(stale?.message || '', /changed since it was loaded/)
    const saved = winner.rows[0].result as { id: string; version_number: number }
    assert.equal(saved.version_number, version)
    return saved.id
  }

  const firstVersion = await race(null, 1)
  await race(firstVersion, 2)
  const final = await setup.query(
    'select version_number,parent_version_id from public.marketing_campaign_plan_versions where campaign_id=$1 order by version_number',
    [ids.campaign],
  )
  assert.deepEqual(final.rows, [
    { version_number: 1, parent_version_id: null },
    { version_number: 2, parent_version_id: firstVersion },
  ])
  console.log('loopback_clone=true; first_save_serialized=true; revision_save_serialized=true; stale_sqlstate_40001=true; immutable_lineage_exact=true')
} finally {
  for (const client of clients) {
    await client.query('rollback').catch(() => {})
    await client.end()
  }
  if (created) await admin.query('DROP DATABASE "' + database + '"')
  await admin.end()
}
