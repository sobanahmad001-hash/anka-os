// Admin-only loopback PostgreSQL 17 proof for MB04B replay and stale-version locks.
import pg from 'npm:pg@8.23.0'
import assert from 'node:assert/strict'

const raw = Deno.env.get('MB04B_LOCAL_TEMPLATE_URL')
if (!raw) throw new Error('MB04B_LOCAL_TEMPLATE_URL is required; no database was touched')
const source = new URL(raw)
if (source.protocol !== 'postgresql:' || !['localhost', '127.0.0.1', '[::1]'].includes(source.hostname) || source.search || source.hash) throw new Error('Only an explicit loopback PostgreSQL template is allowed')
const template = decodeURIComponent(source.pathname.slice(1))
if (!template.startsWith('mb04b_template_') || !/^[a-z0-9_]+$/.test(template)) throw new Error('Template database must be named mb04b_template_*')
const database = 'mb04b_verify_' + crypto.randomUUID().replaceAll('-', '')
const adminUrl = new URL(source); adminUrl.pathname = '/postgres'
const testUrl = new URL(source); testUrl.pathname = '/' + database
const admin = new pg.Client({ connectionString: adminUrl.toString() })
const clients: pg.Client[] = []
let created = false

async function begin(client: pg.Client) { await client.query('begin'); await client.query('set local role service_role') }

await admin.connect()
try {
  const guard = await admin.query('select inet_server_addr()::text address,exists(select 1 from pg_database where datname=$1) template_exists',[template])
  assert.ok(['127.0.0.1','127.0.0.1/32','::1','::1/128'].includes(guard.rows[0].address))
  assert.equal(guard.rows[0].template_exists,true)
  await admin.query('CREATE DATABASE "'+database+'" TEMPLATE "'+template+'"'); created=true
  for(let i=0;i<3;i++){const client=new pg.Client({connectionString:testUrl.toString()});await client.connect();clients.push(client)}
  const [setup,first,second]=clients
  const id=Object.fromEntries(['owner','manager','org','client','brand','engagement','service','campaign'].map(key=>[key,crypto.randomUUID()])) as Record<string,string>
  await setup.query('insert into auth.users(id) values($1),($2)',[id.owner,id.manager])
  await setup.query("insert into public.organizations(id,name,slug,status) values($1,'MB04B race',$2,'active')",[id.org,'mb04b-'+id.org])
  await setup.query("insert into public.organization_memberships(organization_id,user_id,member_kind,role,department_id,status) values($1,$2,'team','system_owner',null,'active'),($1,$3,'team','department_manager','marketing','active')",[id.org,id.owner,id.manager])
  await setup.query("insert into public.agency_clients(id,organization_id,name,created_by) values($1,$2,'Client',$3)",[id.client,id.org,id.owner])
  await setup.query("insert into public.brands(id,organization_id,client_id,name,is_default,created_by) values($1,$2,$3,'Brand',true,$4)",[id.brand,id.org,id.client,id.owner])
  await setup.query("insert into public.engagements(id,organization_id,client_id,brand_id,name,status,created_by) values($1,$2,$3,$4,'Engagement','active',$5)",[id.engagement,id.org,id.client,id.brand,id.owner])
  await setup.query("insert into public.service_catalog(id,organization_id,department_id,slug,name,is_active) values($1,$2,'marketing','mb04b_race','Race',true)",[id.service,id.org])
  await setup.query("insert into public.engagement_services(organization_id,engagement_id,service_id,status,activated_by) values($1,$2,$3,'active',$4)",[id.org,id.engagement,id.service,id.owner])
  await setup.query("insert into public.marketing_campaigns(id,organization_id,engagement_id,brand_id,name,planned_channels,created_by,updated_by) values($1,$2,$3,$4,'Campaign',array['email'],$5,$5)",[id.campaign,id.org,id.engagement,id.brand,id.owner])
  const saved=await setup.query("select public.save_marketing_campaign_plan_draft_with_budget($1,$2,$3,null,'Base','Goal',array['Email'],null,null,'','',100,'EUR',null,null,'[]','base',null,$4) result",[id.org,id.engagement,id.campaign,id.owner])
  const base=saved.rows[0].result.id as string
  const duplicateKey=crypto.randomUUID()
  const duplicateSql="select public.duplicate_marketing_campaign_plan_draft($1,$2,$3,$4,$5,$6,repeat('a',64),$7) result"
  await begin(first); const winner=await first.query(duplicateSql,[id.org,id.engagement,id.campaign,base,base,duplicateKey,id.owner])
  let settled=false
  const contender=(async()=>{await begin(second);const result=await second.query(duplicateSql,[id.org,id.engagement,id.campaign,base,base,duplicateKey,id.owner]);await second.query('commit');settled=true;return result.rows[0].result})()
  await new Promise(resolve=>setTimeout(resolve,150));assert.equal(settled,false,'duplicate contender did not wait on replay lock');await first.query('commit')
  const replay=await contender; const duplicate=winner.rows[0].result.id as string
  assert.equal(replay.id,duplicate);assert.equal(replay.replayed,true)

  const reviewKey=crypto.randomUUID(); const reviewSql="select public.submit_marketing_campaign_plan_review($1,$2,$3,$4,$4,null,'parallel',array[$5::uuid],$6,repeat('b',64),$7) result"
  await begin(first);const reviewWinner=await first.query(reviewSql,[id.org,id.engagement,id.campaign,duplicate,id.manager,reviewKey,id.owner])
  settled=false
  const reviewContender=(async()=>{await begin(second);const result=await second.query(reviewSql,[id.org,id.engagement,id.campaign,duplicate,id.manager,reviewKey,id.owner]);await second.query('commit');settled=true;return result.rows[0].result})()
  await new Promise(resolve=>setTimeout(resolve,150));assert.equal(settled,false,'review contender did not wait on replay lock');await first.query('commit')
  const reviewReplay=await reviewContender;assert.equal(reviewReplay.id,reviewWinner.rows[0].result.id);assert.equal(reviewReplay.replayed,true)

  await begin(first)
  await first.query("select pg_advisory_xact_lock(hashtextextended($1::text||':'||$2::text||':duplicate_campaign_plan:'||$3::text,0))",[id.org,id.owner,duplicateKey])
  settled=false
  const revokedDuplicateReplay=(async()=>{await begin(second);try{await second.query(duplicateSql,[id.org,id.engagement,id.campaign,base,base,duplicateKey,id.owner]);await second.query('commit');return null}catch(error){await second.query('rollback');return error as Error}finally{settled=true}})()
  await new Promise(resolve=>setTimeout(resolve,150));assert.equal(settled,false,'duplicate replay did not wait on replay lock')
  await setup.query("update public.organization_memberships set status='suspended' where organization_id=$1 and user_id=$2",[id.org,id.owner])
  await first.query('commit')
  assert.match((await revokedDuplicateReplay)?.message || '',/Marketing department access required/)
  await setup.query("update public.organization_memberships set status='active' where organization_id=$1 and user_id=$2",[id.org,id.owner])

  await begin(first)
  await first.query("select pg_advisory_xact_lock(hashtextextended($1::text||':'||$2::text||':submit_campaign_plan:'||$3::text,0))",[id.org,id.owner,reviewKey])
  settled=false
  const revokedReviewReplay=(async()=>{await begin(second);try{await second.query(reviewSql,[id.org,id.engagement,id.campaign,duplicate,id.manager,reviewKey,id.owner]);await second.query('commit');return null}catch(error){await second.query('rollback');return error as Error}finally{settled=true}})()
  await new Promise(resolve=>setTimeout(resolve,150));assert.equal(settled,false,'review replay did not wait on replay lock')
  await setup.query("update public.organization_memberships set status='suspended' where organization_id=$1 and user_id=$2",[id.org,id.owner])
  await first.query('commit')
  assert.match((await revokedReviewReplay)?.message || '',/Marketing department access required/)
  await setup.query("update public.organization_memberships set status='active' where organization_id=$1 and user_id=$2",[id.org,id.owner])

  await begin(first)
  const later=await first.query("select public.save_marketing_campaign_plan_draft_with_budget($1,$2,$3,$4,'Later','Goal',array['Email'],null,null,'','',null,null,null,null,'[]','later',null,$5) result",[id.org,id.engagement,id.campaign,duplicate,id.owner])
  settled=false
  const stale=(async()=>{await begin(second);try{await second.query("select public.submit_marketing_campaign_plan_review($1,$2,$3,$4,$4,$5,'parallel',array[$6::uuid],$7,repeat('c',64),$8)",[id.org,id.engagement,id.campaign,duplicate,reviewWinner.rows[0].result.artifact_version_id,id.manager,crypto.randomUUID(),id.owner]);await second.query('commit');return null}catch(error){await second.query('rollback');return error as {code?:string}}finally{settled=true}})()
  await new Promise(resolve=>setTimeout(resolve,150));assert.equal(settled,false,'stale submit did not wait on plan lock');await first.query('commit')
  assert.equal((await stale)?.code,'40001');assert.equal(later.rows[0].result.version_number,3)
  const counts=await setup.query('select (select count(*) from public.marketing_campaign_plan_versions where campaign_id=$1) versions,(select count(*) from public.marketing_campaign_plan_duplicate_requests where organization_id=$2) duplicates,(select count(*) from public.marketing_campaign_plan_review_submissions where organization_id=$2) submissions',[id.campaign,id.org])
  assert.deepEqual(counts.rows[0],{versions:'3',duplicates:'1',submissions:'1'})
  console.log('loopback_clone=true; duplicate_one_winner=true; duplicate_retry_same=true; review_one_winner=true; review_retry_same=true; duplicate_replay_revocation_denied=true; review_replay_revocation_denied=true; stale_submit_sqlstate_40001=true')
} finally {
  for(const client of clients){await client.query('rollback').catch(()=>{});await client.end()}
  if(created)await admin.query('DROP DATABASE "'+database+'"')
  await admin.end()
}
