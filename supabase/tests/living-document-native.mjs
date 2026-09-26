import fs from 'node:fs'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { randomUUID } from 'node:crypto'
const require = createRequire(import.meta.url)
const pg = require(process.env.ANKA_PG_MODULE || 'pg')
const connection = { host: '127.0.0.1', port: Number(process.env.ANKA_NATIVE_PG_PORT || 55445), user: 'postgres' }
const boot = new pg.Client({ ...connection, database: 'postgres' })
await boot.connect()
const database = 'anka_living_doc_' + Date.now()
await boot.query('create database ' + database)
await boot.end()
const db = new pg.Client({ ...connection, database }), a = new pg.Client({ ...connection, database }), b = new pg.Client({ ...connection, database })
await Promise.all([db.connect(), a.connect(), b.connect()])
const original = fs.readFileSync(new URL('../migrations/20260904140000_p8_atomic_living_record_snapshots.sql', import.meta.url), 'utf8')
const migration = fs.readFileSync(new URL('../migrations/20260926134156_living_project_document_supplemental_history.sql', import.meta.url), 'utf8')
const coreTables = ['projects','workstreams','tasks','task_dependencies','milestones','research_records','deliverables','deliverable_versions','requests','activity_events','client_portal_items']
const extraTables = ['project_service_scopes','engagements','project_pipeline_configurations','project_pipeline_activations','project_task_change_proposals','ai_project_memory','comments','recurring_work_plans','recurring_work_plan_versions','recurring_work_plan_version_approvals','recurring_work_plan_template_items']
const allColumns = new Set([...original.matchAll(/(?:row|v_project|deliverable|version|portal|task|prerequisite)\.([a-z_]+)/g)].map(match => match[1]))
for (const name of 'id organization_id project_id owner_id archived_at created_at updated_at source_version name status member_kind user_id role service_id quantity scope_statement exclusions revision source start_date target_date engagement_id objective configuration_id definition_publication_id selected_steps selected_steps_sha256 activation_number activated_at task_id before_status proposed_status source_comment_id decided_at statement source_sha256 reviewed_at entity_type entity_id visibility content plan_id plan_version_id approved_version_id version_number title scope frequency timezone effective_start effective_end template_key default_assignee_id start_offset_days due_offset_days position'.split(' ')) allColumns.add(name)
const uuidColumns = new Set('id organization_id project_id owner_id user_id client_id workstream_id task_id depends_on_task_id assigned_to deliverable_id source_id actor_id target_id service_id engagement_id configuration_id definition_publication_id source_comment_id entity_id plan_id plan_version_id approved_version_id default_assignee_id'.split(' '))
const numberColumns = new Set('source_version version_number revision quantity position activation_number start_offset_days due_offset_days'.split(' '))
const jsonColumns = new Set(['metadata','sources','selected_steps'])
const columns = [...allColumns].filter(name => !['status','visibility'].includes(name)).map(name => `${name} ${uuidColumns.has(name) ? 'uuid' : numberColumns.has(name) ? 'bigint' : jsonColumns.has(name) ? 'jsonb' : name === 'client_visible' ? 'boolean' : 'text'}`).join(',') + ',status text,visibility text'
const org = randomUUID(), actor = randomUUID(), project = randomUUID(), document = randomUUID(), engagement = randomUUID(), service = randomUUID(), comment = randomUUID(), memory = randomUUID(), foreignOrg = randomUUID()
try {
  await db.query(`create schema auth; create schema private; create schema extensions;
    create extension pgcrypto with schema extensions;
    create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    create table public.organizations(id uuid primary key,status text);
    create table public.organization_memberships(organization_id uuid,user_id uuid,role text,member_kind text,status text);
    create function public.is_team_organization_member(uuid) returns boolean language sql stable as $$ select true $$;`)
  for (const table of [...coreTables, ...extraTables]) await db.query(`create table public.${table} (${columns},primary key(id))`)
  await db.query(`alter table public.projects add unique(id,organization_id);
    create table public.living_project_documents(id uuid primary key,organization_id uuid,project_id uuid,source_version bigint,internal_projection jsonb default '{}',client_projection jsonb default '{}',generated_at timestamptz);
    create table public.living_project_document_snapshots(id uuid primary key default gen_random_uuid(),organization_id uuid,living_project_document_id uuid,project_id uuid,projection_kind text,source_version bigint,snapshot jsonb,reason text,generated_by uuid,generated_at timestamptz,unique(living_project_document_id,projection_kind,source_version));
    grant usage on schema auth to authenticated; grant execute on function auth.uid() to authenticated;
    grant select,insert,update on public.living_project_documents to authenticated;
    grant select,insert on public.living_project_document_snapshots to authenticated;
    create policy "Team can manage living project documents" on public.living_project_documents for all using(true);
    create policy "Team can create living project snapshots" on public.living_project_document_snapshots for insert with check(true);`)
  await db.query('insert into auth.users values($1)',[actor])
  await db.query("insert into public.organizations values($1,'active')",[org])
  await db.query("insert into public.organization_memberships values($1,$2,'system_owner','team','active')",[org,actor])
  await db.query("insert into public.projects(id,organization_id,owner_id,name,status) values($1,$2,$3,'Exact project','active')",[project,org,actor])
  await db.query('insert into public.living_project_documents(id,organization_id,project_id,source_version) values($1,$2,$3,7)',[document,org,project])
  await db.query("insert into public.engagements(id,organization_id,project_id,objective,status) values($1,$2,$3,'Recorded objective','active')",[engagement,org,project])
  await db.query("insert into public.project_service_scopes(id,organization_id,project_id,service_id,status,quantity,revision) values($1,$2,$3,$4,'active',1,1)",[service,org,project,randomUUID()])
  await db.query("insert into public.comments(id,organization_id,project_id,entity_type,entity_id,visibility,content) values($1,$2,$3,'project',$3,'internal_only','Source statement')",[comment,org,project])
  await db.query("insert into public.ai_project_memory(id,organization_id,project_id,status,statement,source_comment_id,source_sha256) values($1,$2,$3,'confirmed','Confirmed preference',$4,encode(extensions.digest('Source statement','sha256'),'hex'))",[memory,org,project,comment])
  const plan = randomUUID(), planVersion = randomUUID(), template = randomUUID(), configuration = randomUUID(), proposal = randomUUID()
  await db.query("insert into public.recurring_work_plans(id,organization_id,project_id,engagement_id,status,approved_version_id) values($1,$2,$3,$4,'active',$5)",[plan,org,project,engagement,planVersion])
  await db.query("insert into public.recurring_work_plan_versions(id,organization_id,plan_id,version_number,title,frequency,effective_start) values($1,$2,$3,1,'Recorded plan','monthly','2026-09-01')",[planVersion,org,plan])
  await db.query('insert into public.recurring_work_plan_version_approvals(id,organization_id,plan_id,plan_version_id) values($1,$2,$3,$4)',[randomUUID(),org,plan,planVersion])
  await db.query("insert into public.recurring_work_plan_template_items(id,organization_id,plan_id,plan_version_id,title,start_offset_days,due_offset_days,position) values($1,$2,$3,$4,'Template work',0,3,0)",[template,org,plan,planVersion])
  await db.query("insert into public.project_pipeline_configurations(id,organization_id,project_id,engagement_id,revision,selected_steps) values($1,$2,$3,$4,1,'[{\"key\":\"draft\",\"quantity\":2}]')",[configuration,org,project,engagement])
  await db.query('insert into public.project_pipeline_activations(id,organization_id,engagement_id,configuration_id,activation_number) values($1,$2,$3,$4,1)',[randomUUID(),org,engagement,configuration])
  await db.query("insert into public.project_task_change_proposals(id,organization_id,project_id,status,before_status,proposed_status) values($1,$2,$3,'applied','draft','ready')",[proposal,org,project])
  await db.query("insert into public.ai_project_memory(id,organization_id,project_id,status,statement) values($1,$2,$3,'candidate','Never include candidate')",[randomUUID(),org,project])
  await db.query("insert into public.project_service_scopes(id,organization_id,project_id,status,quantity) values($1,$2,$3,'active',999)",[randomUUID(),foreignOrg,project])
  await db.query(original)
  for (const client of [db,a,b]) await client.query("select set_config('request.jwt.claim.sub',$1,false)",[actor])
  const preserve = async (client, version, request = randomUUID(), kind = 'internal') => (await client.query('select public.preserve_living_project_snapshot($1,$2,$3,$4,$5,$6,$7) as result',[org,project,document,kind,version,request,'Local fixture checkpoint'])).rows[0].result
  const version = async () => Number((await db.query('select source_version from public.living_project_documents where id=$1',[document])).rows[0].source_version)
  const oldRequest = randomUUID()
  await db.query('set role authenticated')
  const old = await preserve(db,7,oldRequest)
  await db.query('reset role')
  assert.equal(old.snapshot.snapshot.schema_version,1)
  const before = (await db.query("select 'private.build_living_project_snapshot_projection(uuid,uuid,text,bigint,timestamp with time zone)'::regprocedure::oid as oid")).rows[0].oid
  await db.query(migration)
  const after = (await db.query("select 'private.build_living_project_snapshot_projection(uuid,uuid,text,bigint,timestamp with time zone)'::regprocedure::oid as oid")).rows[0].oid
  assert.equal(before,after)
  assert.equal(await version(),8)
  const replay = await preserve(db,7,oldRequest)
  assert.deepEqual(replay.snapshot.snapshot,old.snapshot.snapshot)
  assert.equal(replay.idempotent_replay,true)
  await assert.rejects(preserve(db,7),error => error.code==='40001')
  const newRequest = randomUUID(), fresh = await preserve(db,8,newRequest)
  assert.equal(fresh.snapshot.snapshot.schema_version,2)
  assert.equal(fresh.snapshot.snapshot.supplemental.services[0].quantity,1)
  assert.equal(fresh.snapshot.snapshot.supplemental.confirmed_preferences[0].id,memory)
  assert.equal(fresh.snapshot.snapshot.supplemental.services.length,1)
  assert.equal(fresh.snapshot.snapshot.supplemental.engagements[0].active_configuration.id,configuration)
  assert.equal(fresh.snapshot.snapshot.supplemental.recurring_plans[0].versions[0].approved,true)
  assert.equal(fresh.snapshot.snapshot.supplemental.recurring_plans[0].versions[0].items[0].id,template)
  assert.equal(fresh.snapshot.snapshot.supplemental.task_decisions[0].id,proposal)
  assert.equal(fresh.snapshot.snapshot.supplemental.confirmed_preferences.length,1)
  assert.equal((await preserve(db,8,newRequest)).snapshot.id,fresh.snapshot.id)
  const clientSnapshot = await preserve(db,8,randomUUID(),'client')
  assert.equal(clientSnapshot.snapshot.snapshot.schema_version,1)
  assert.equal(clientSnapshot.snapshot.snapshot.supplemental,undefined)
  await db.query('update public.comments set content=$2 where id=$1',[comment,'Changed source'])
  assert.equal(await version(),9)
  assert.equal((await preserve(db,9)).snapshot.snapshot.supplemental.confirmed_preferences.length,0)
  await db.query('set role authenticated')
  await assert.rejects(db.query('select private.invalidate_living_project_supplemental_source()'),error => error.code==='42501')
  await db.query('reset role')
  // Two-session source-first race: writer row+document lock held; old version save must wait and reject.
  await a.query('begin'); await a.query("set local lock_timeout='3s'; set local statement_timeout='5s'")
  await a.query('update public.project_service_scopes set quantity=2,revision=2 where id=$1',[service])
  let done=false
  const pending = preserve(b,9).then(()=>({ok:true}),error=>({code:error.code})).finally(()=>{done=true})
  await new Promise(resolve=>setTimeout(resolve,100)); assert.equal(done,false)
  await a.query('commit'); assert.equal((await pending).code,'40001')
  assert.equal(await version(),10)
  // Snapshot-first race: preserve holds document; source update waits; checkpoint remains exact prior state.
  await a.query('begin')
  const checkpoint = await preserve(a,10)
  let changed=false
  const update = b.query('update public.project_service_scopes set quantity=3,revision=3 where id=$1',[service]).then(()=>{changed=true})
  await new Promise(resolve=>setTimeout(resolve,100)); assert.equal(changed,false)
  await a.query('commit'); await update
  assert.equal(checkpoint.snapshot.snapshot.supplemental.services[0].quantity,2)
  assert.equal(await version(),11)
  const next = await preserve(db,11)
  assert.equal(next.snapshot.snapshot.supplemental.services[0].quantity,3)
  assert.equal((await db.query('select snapshot from public.living_project_document_snapshots where id=$1',[checkpoint.snapshot.id])).rows[0].snapshot.supplemental.services[0].quantity,2)
  // Every supplemental source family advances the same document version.
  for (const [table, id, field, value] of [
    ['engagements',engagement,'objective','Changed objective'],
    ['project_task_change_proposals',proposal,'status','pending'],
    ['ai_project_memory',memory,'status','retired'],
    ['recurring_work_plans',plan,'status','paused'],
    ['recurring_work_plan_versions',planVersion,'title','Changed plan'],
    ['recurring_work_plan_template_items',template,'title','Changed template'],
    ['project_pipeline_configurations',configuration,'revision',2],
  ]) {
    const prior = await version()
    await db.query(`update public.${table} set ${field}=$2 where id=$1`,[id,value])
    assert.equal(await version(),prior+1,table)
  }
  const prior = await version()
  await db.query('insert into public.recurring_work_plan_version_approvals(id,organization_id,plan_id,plan_version_id) values($1,$2,$3,$4)',[randomUUID(),org,plan,planVersion])
  await db.query('insert into public.project_pipeline_activations(id,organization_id,engagement_id,configuration_id,activation_number) values($1,$2,$3,$4,2)',[randomUUID(),org,engagement,configuration])
  assert.equal(await version(),prior+2)
  await db.query('select set_config(\'request.jwt.claim.sub\',$1,false)',[randomUUID()])
  await assert.rejects(preserve(db,await version()),error => error.code==='42501')
  await db.query('select set_config(\'request.jwt.claim.sub\',$1,false)',[actor])
  for (let index=0; index<52; index++) await db.query("insert into public.ai_project_memory(id,organization_id,project_id,status,statement,source_comment_id,source_sha256,reviewed_at) values($1,$2,$3,'confirmed',$4,$5,encode(extensions.digest('Changed source','sha256'),'hex'),$6)",
    [randomUUID(),org,project,'Bounded confirmed '+index,comment,new Date(Date.UTC(2026,8,1,0,0,index)).toISOString()])
  assert.equal((await preserve(db,await version())).snapshot.snapshot.supplemental.confirmed_preferences.length,50)
  await db.query(fs.readFileSync(new URL('../verify_20260926134156_living_project_document_supplemental_history.sql', import.meta.url), 'utf8'))
  console.log('PASS native synthetic fixture: actual P8 public RPC invokes v2, same OID, cutover, immutable v1 replay, stale rejection, client exclusion, source hash revocation, hidden helper ACL, two-session writer/snapshot races; database='+database)
} finally {
  for (const client of [db,a,b]) { await client.query('rollback').catch(()=>{}); await client.end() }
}