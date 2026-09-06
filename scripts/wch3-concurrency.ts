// LOCAL-only WCH lock regression. The template must contain the reviewed migration.
import pg from 'npm:pg@8.23.0'
import assert from 'node:assert/strict'
const raw = Deno.env.get('WCH3_LOCAL_TEMPLATE_URL')
if (!raw) throw new Error('WCH3_LOCAL_TEMPLATE_URL is required')
const url = new URL(raw)
if (url.protocol !== 'postgresql:' || !['localhost','127.0.0.1','[::1]'].includes(url.hostname) || url.search || url.hash) {
  throw new Error('Only an explicitly configured local PostgreSQL template is allowed')
}
const template = decodeURIComponent(url.pathname.slice(1))
if (template !== 'wch3_test' && !template.startsWith('wch3_template_')) throw new Error('Unexpected WCH template name')
const name = 'wch3_verify_' + crypto.randomUUID().replaceAll('-','')
const adminUrl = new URL(url); adminUrl.pathname = '/postgres'
const testUrl = new URL(url); testUrl.pathname = '/' + name
const admin = new pg.Client({connectionString:adminUrl.toString()})
const clients: pg.Client[] = []
let created = false
async function blocked(setup: pg.Client) {
  for (let attempt=0; attempt<150; attempt++) {
    const result = await setup.query("select exists(select 1 from pg_locks where database=(select oid from pg_database where datname=current_database()) and locktype='relation' and not granted) blocked")
    if (result.rows[0].blocked) return true
    await new Promise(resolve => setTimeout(resolve,20))
  }
  return false
}
await admin.connect()
try {
  await admin.query('CREATE DATABASE "' + name + '" TEMPLATE "' + template + '"')
  created = true
  for (let index=0; index<3; index++) { const client=new pg.Client({connectionString:testUrl.toString()}); await client.connect(); clients.push(client) }
  const [setup,first,second]=clients
  const org=crypto.randomUUID(), actor=crypto.randomUUID()
  await setup.query('insert into auth.users(id) values($1)',[actor])
  await setup.query('insert into public.organizations(id,name,slug) values($1,$2,$3)',[org,'WCH concurrency fixture','wch-'+org])
  await setup.query("insert into public.organization_memberships(organization_id,user_id,member_kind,role,department_id,status) values($1,$2,'team','contributor','development','active')",[org,actor])
  const client=(await setup.query("insert into public.clients(name,company,owner_id,organization_id) values('WCH fixture','WCH',$1,$2) returning id",[actor,org])).rows[0].id
  const agency=(await setup.query("insert into public.agency_clients(organization_id,legacy_client_id,canonical_client_id,name,owner_id,created_by) values($1,$2,$2,'WCH fixture',$3,$3) returning id",[org,client,actor])).rows[0].id
  const brand=(await setup.query("insert into public.brands(organization_id,client_id,name,is_default,created_by) values($1,$2,'WCH fixture',true,$3) returning id",[org,agency,actor])).rows[0].id
  const project=(await setup.query("insert into public.projects(name,department_id,status,owner_id,organization_id,client_id,engagement_type) values('WCH fixture','development','active',$1,$2,$3,'project') returning id",[actor,org,client])).rows[0].id
  const engagement=(await setup.query("insert into public.engagements(organization_id,client_id,brand_id,legacy_project_id,project_id,name,engagement_type,status,created_by) values($1,$2,$3,$4,$4,'WCH fixture','project','active',$5) returning id",[org,agency,brand,project,actor])).rows[0].id
  const service=(await setup.query("insert into public.service_catalog(organization_id,department_id,slug,name) values($1,'development',$2,'WCH fixture') returning id",[org,'wch_fixture_'+org.replaceAll('-','')])).rows[0].id
  await setup.query("insert into public.engagement_services(organization_id,engagement_id,service_id,status,activated_by) values($1,$2,$3,'active',$4)",[org,engagement,service,actor])
  const connector=(await setup.query("insert into public.integration_connections(organization_id,provider,display_name,public_config,secret_name,status,created_by) values($1,'openai','WCH fixture','{\"model_id\":\"wch-fixture-model\"}','ANKA_OPENAI_WCH_FIXTURE','verified',$2) returning id",[org,actor])).rows[0].id
  await setup.query("insert into public.integration_connection_departments(connection_id,organization_id,department_id,created_by) values($1,$2,'development',$3)",[connector,org,actor])
  await setup.query("insert into public.integration_connection_engagements(connection_id,organization_id,engagement_id,department_id,created_by) values($1,$2,$3,'development',$4)",[connector,org,engagement,actor])
  const saveSql="select public.save_department_chat_proposal($1,$2,$3,'development',$4,'work_item','task',null,null,'{\"title\":\"Concurrent WCH\",\"description\":\"Fixture\",\"priority\":\"medium\"}','{\"title\":\"Concurrent WCH\"}','{}','{}',$5,$6,'wch-fixture-model',$7,'','',1,1,1,0) result"
  const args=[org,engagement,project,actor,'a'.repeat(64),connector,crypto.randomUUID()]
  const proposal=(await setup.query(saveSql,args)).rows[0].result
  const confirmSql="select public.confirm_department_chat_proposal($1,$2,$3,$4,'wch-fixture-model') result"
  await first.query('set role service_role'); await second.query('set role service_role')
  await first.query('begin')
  const accepted=await first.query(confirmSql,[proposal.proposal_id,actor,'a'.repeat(64),connector])
  await second.query('begin')
  let writerDone=false
  const writer=second.query("update public.projects set name=name || ' changed' where id=$1",[project]).then((result: unknown)=>{writerDone=true;return result})
  assert.equal(await blocked(setup),true); assert.equal(writerDone,false)
  await first.query('commit'); await writer; await second.query('commit')
  assert.equal(accepted.rows[0].result.outcome,'accepted')
  const artifact=(await setup.query("insert into public.artifacts(organization_id,project_id,engagement_id,brand_id,artifact_type,title,created_by) values($1,$2,$3,$4,'brand_statement','WCH context',$5) returning id",[org,project,engagement,brand,actor])).rows[0].id
  const version=(await setup.query("insert into public.artifact_versions(organization_id,artifact_id,version_number,content,content_checksum,ai_use_allowed,data_classification,created_by) values($1,$2,1,'{\"context\":true}',$3,true,'internal',$4) returning id",[org,artifact,'7'.repeat(64),actor])).rows[0].id
  args[6]=crypto.randomUUID()
  const staleProposal=(await setup.query(saveSql,args)).rows[0].result
  await second.query('begin')
  await second.query('insert into public.artifact_approvals(organization_id,artifact_id,artifact_version_id,engagement_id,approved_by) values($1,$2,$3,$4,$5)',[org,artifact,version,engagement,actor])
  await first.query('begin')
  let confirmationDone=false
  const pending=first.query(confirmSql,[staleProposal.proposal_id,actor,'a'.repeat(64),connector]).then((result: {rows:Array<{result:Record<string,unknown>}>})=>{confirmationDone=true;return result})
  assert.equal(await blocked(setup),true); assert.equal(confirmationDone,false)
  await second.query('commit')
  const stale=await pending; await first.query('commit')
  assert.equal(stale.rows[0].result.outcome,'stale')
  assert.equal((await setup.query('select accepted_work_item_id from public.department_chat_proposals where id=$1',[staleProposal.proposal_id])).rows[0].accepted_work_item_id,null)
  console.log('two_sessions=true; context_writer_blocked=true; approval_writer_precedes_confirmation=true; stale_zero_write=true; deadlocks=0')
} finally {
  for (const client of clients) { await client.query('rollback').catch(()=>{}); await client.end() }
  if (created) await admin.query('DROP DATABASE "'+name+'"')
  await admin.end()
}
