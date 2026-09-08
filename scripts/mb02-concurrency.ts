// Admin-only LOCAL disposable PostgreSQL race check. No hosted/remote URL is accepted.
// The template must already contain MB02B. This script creates and drops only its
// own random database and never applies a migration.
import pg from 'npm:pg@8.23.0'
import assert from 'node:assert/strict'

const urlText = Deno.env.get('MB02_LOCAL_TEMPLATE_URL')
if (!urlText) throw new Error('MB02_LOCAL_TEMPLATE_URL is required')
const url = new URL(urlText)
if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || url.protocol !== 'postgresql:' || url.search || url.hash) {
  throw new Error('Only an explicitly configured local PostgreSQL template is allowed')
}
const template = decodeURIComponent(url.pathname.slice(1))
if (!template.startsWith('mb02_template_') || !/^[a-z0-9_]+$/.test(template)) {
  throw new Error('Template database must be named mb02_template_*')
}

const dbName = 'mb02_verify_' + crypto.randomUUID().replaceAll('-', '')
const adminUrl = new URL(url); adminUrl.pathname = '/postgres'
const testUrl = new URL(url); testUrl.pathname = '/' + dbName
const admin = new pg.Client({ connectionString: adminUrl.toString() })
const clients: pg.Client[] = []
let created = false
await admin.connect()
try {
  await admin.query('CREATE DATABASE "' + dbName + '" TEMPLATE "' + template + '"')
  created = true
  for (let index = 0; index < 3; index++) {
    const client = new pg.Client({ connectionString: testUrl.toString() })
    await client.connect(); clients.push(client)
  }
  const [setup, firstWriter, secondWriter] = clients
  const ids = {
    org: crypto.randomUUID(), actor: crypto.randomUUID(), client: crypto.randomUUID(),
    brand: crypto.randomUUID(), engagement: crypto.randomUUID(), service: crypto.randomUUID(),
    campaign: crypto.randomUUID(), otherCampaign: crypto.randomUUID(), thirdCampaign: crypto.randomUUID(),
  }
  await setup.query('insert into auth.users(id) values($1)', [ids.actor])
  await setup.query('insert into public.organizations(id,name,slug) values($1,$2,$3)', [ids.org, 'MB02 concurrency', ids.org])
  await setup.query("insert into public.organization_memberships(organization_id,user_id,member_kind,role,status) values($1,$2,'team','system_owner','active')", [ids.org, ids.actor])
  await setup.query('insert into public.agency_clients(id,organization_id,name,created_by) values($1,$2,$3,$4)', [ids.client, ids.org, 'MB02 client', ids.actor])
  await setup.query('insert into public.brands(id,organization_id,client_id,name,is_default,created_by) values($1,$2,$3,$4,true,$5)', [ids.brand, ids.org, ids.client, 'MB02 brand', ids.actor])
  await setup.query("insert into public.engagements(id,organization_id,client_id,brand_id,name,status,created_by) values($1,$2,$3,$4,$5,'active',$6)", [ids.engagement, ids.org, ids.client, ids.brand, 'MB02 engagement', ids.actor])
  await setup.query("insert into public.service_catalog(id,organization_id,department_id,slug,name,is_active) values($1,$2,'marketing','mb02_concurrency','MB02 concurrency',true)", [ids.service, ids.org])
  await setup.query("insert into public.engagement_services(organization_id,engagement_id,service_id,status,activated_by) values($1,$2,$3,'active',$4)", [ids.org, ids.engagement, ids.service, ids.actor])
  await setup.query("insert into public.marketing_campaigns(id,organization_id,engagement_id,brand_id,name,planned_channels,created_by,updated_by) values($1,$4,$5,$6,'MB02 campaign','{email}',$7,$7),($2,$4,$5,$6,'MB02 other campaign','{search}',$7,$7),($3,$4,$5,$6,'MB02 third campaign','{social}',$7,$7)", [ids.campaign, ids.otherCampaign, ids.thirdCampaign, ids.org, ids.engagement, ids.brand, ids.actor])

  const saveSql = 'select public.save_marketing_campaign_brief($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) result'
  const initial = (key: string, checksum: string) => [
    ids.org, ids.engagement, ids.campaign, null, null, 'Concurrent brief',
    { campaign_goal: 'Launch', channels: ['email'], existing_asset_version_ids: [] },
    'a'.repeat(64), 'first', false, key, checksum, ids.actor,
  ]
  const firstKeys = [crypto.randomUUID(), crypto.randomUUID()]
  const firstRace = await Promise.allSettled([
    firstWriter.query(saveSql, initial(firstKeys[0], '1'.repeat(64))),
    secondWriter.query(saveSql, initial(firstKeys[1], '2'.repeat(64))),
  ])
  assert.equal(firstRace.filter(result => result.status === 'fulfilled').length, 1)
  assert.equal(firstRace.filter(result => result.status === 'rejected' && String(result.reason).includes('already has a canonical campaign brief')).length, 1)
  const winnerIndex = firstRace.findIndex(result => result.status === 'fulfilled')
  const winner = firstRace[winnerIndex] as PromiseFulfilledResult<pg.QueryResult>
  const firstVersion = winner.value.rows[0].result.id
  const artifact = winner.value.rows[0].result.artifact_id
  const reusedKey = firstKeys[winnerIndex]
  let counts = await setup.query("select (select count(*) from public.artifacts where organization_id=$1 and artifact_type='campaign_brief') artifacts,(select count(*) from public.marketing_campaign_artifacts where organization_id=$1 and campaign_id=$2 and relation_type='campaign_brief') links,(select count(*) from public.artifact_versions where organization_id=$1 and artifact_id=$3) versions", [ids.org, ids.campaign, artifact])
  assert.deepEqual(counts.rows[0], { artifacts: '1', links: '1', versions: '1' })

  await setup.query("update public.marketing_brief_save_requests set created_at=now()-interval '31 days',expires_at=now()-interval '1 day' where organization_id=$1 and actor_id=$2 and idempotency_key=$3", [ids.org, ids.actor, reusedKey])
  const reuse = [
    ids.org, ids.engagement, ids.campaign, artifact, firstVersion, 'Concurrent brief',
    { campaign_goal: 'Launch two', channels: ['email'], existing_asset_version_ids: [] },
    'b'.repeat(64), 'second', false, reusedKey, '3'.repeat(64), ids.actor,
  ]
  const reuseRace = await Promise.all([
    firstWriter.query(saveSql, reuse), secondWriter.query(saveSql, reuse),
  ])
  assert.equal(new Set(reuseRace.map((result: pg.QueryResult) => result.rows[0].result.id)).size, 1)
  assert.deepEqual(reuseRace.map((result: pg.QueryResult) => result.rows[0].result.replayed).sort(), [false, true])
  counts = await setup.query('select (select count(*) from public.artifact_versions where artifact_id=$1) versions,(select count(*) from public.marketing_brief_save_requests where organization_id=$2 and actor_id=$3 and idempotency_key=$4) ledger', [artifact, ids.org, ids.actor, reusedKey])
  assert.deepEqual(counts.rows[0], { versions: '2', ledger: '1' })

  const freeBrief = crypto.randomUUID()
  await setup.query("insert into public.artifacts(id,organization_id,brand_id,engagement_id,artifact_type,title,created_by) values($1,$2,$3,$4,'campaign_brief','Race binding',$5)", [freeBrief, ids.org, ids.brand, ids.engagement, ids.actor])
  const briefLinkSql = "insert into public.marketing_campaign_artifacts(organization_id,campaign_id,artifact_id,relation_type,linked_by) values($1,$2,$3,'campaign_brief',$4)"
  const bindingRace = await Promise.allSettled([
    firstWriter.query(briefLinkSql, [ids.org, ids.otherCampaign, freeBrief, ids.actor]),
    secondWriter.query(briefLinkSql, [ids.org, ids.thirdCampaign, freeBrief, ids.actor]),
  ])
  assert.equal(bindingRace.filter(result => result.status === 'fulfilled').length, 1)
  assert.equal(bindingRace.filter(result => result.status === 'rejected' && String(result.reason).includes('duplicate key')).length, 1)
  counts = await setup.query('select count(*) bindings from public.marketing_campaign_artifacts where organization_id=$1 and artifact_id=$2', [ids.org, freeBrief])
  assert.equal(counts.rows[0].bindings, '1')

  const sharedArtifact = crypto.randomUUID()
  await setup.query("insert into public.artifacts(id,organization_id,brand_id,engagement_id,artifact_type,title,created_by) values($1,$2,$3,$4,'channel_strategy','Shared strategy',$5)", [sharedArtifact, ids.org, ids.brand, ids.engagement, ids.actor])
  const sharedLinkSql = "insert into public.marketing_campaign_artifacts(organization_id,campaign_id,artifact_id,relation_type,linked_by) values($1,$2,$3,'channel_strategy',$4)"
  await Promise.all([
    firstWriter.query(sharedLinkSql, [ids.org, ids.otherCampaign, sharedArtifact, ids.actor]),
    secondWriter.query(sharedLinkSql, [ids.org, ids.thirdCampaign, sharedArtifact, ids.actor]),
  ])
  counts = await setup.query('select count(*) bindings from public.marketing_campaign_artifacts where organization_id=$1 and artifact_id=$2', [ids.org, sharedArtifact])
  assert.equal(counts.rows[0].bindings, '2')
  console.log('first_save_race=1_winner; expired_key_race=one_write_one_replay; campaign_brief_rebind_race=1_winner; non_brief_multi_campaign=2_links; local_clone_only=true')
} finally {
  for (const client of clients) await client.end().catch(() => {})
  if (created) await admin.query('DROP DATABASE "' + dbName + '"')
  await admin.end()
}
