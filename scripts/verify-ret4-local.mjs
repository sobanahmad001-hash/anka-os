// Explicitly isolated RET4 verifier. No network target, credentials or database name is caller-controlled.
import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import assert from 'node:assert/strict'
const root = resolve(import.meta.dirname, '..')
const qa = resolve(root, '..', '.qa')
const psql = resolve(qa, 'qts5-postgres-local/pgsql/bin/psql.exe')
const password = readFileSync(resolve(qa, 'ret4-postgres-local/local-password.txt'), 'utf8').trim()
const env = { ...process.env, PGPASSWORD: password }
const database = process.env.RET4_TEST_DATABASE || 'ret4'
assert.ok(['ret4','ret4_clean_20260904'].includes(database), 'Only explicitly named local RET4 databases are permitted')
const results = []
function start(sql, app = 'ret4_verify') {
  const child = spawn(psql, ['-X','-qAt','-h','127.0.0.1','-p','55444','-U','ret4_admin','-d',database,'-v','ON_ERROR_STOP=1'], { env, windowsHide: true })
  let out = '', err = ''
  let marked
  const marker = new Promise(resolve => { marked = resolve })
  child.stdout.on('data', b => { out += b; if (out.includes('RET4_LOCKED')) marked() })
  child.stderr.on('data', b => { err += b })
  const done = new Promise((resolve, reject) => {
    child.on('error', reject)
    child.on('exit', code => resolve({ code, out: out.trim(), err: err.trim() }))
  })
  child.stdin.end("set application_name='" + app + "'; set statement_timeout='15s'; set lock_timeout='10s';\n" + sql)
  return { done, marker }
}
async function run(sql) {
  const r = await start(sql).done
  assert.equal(r.code, 0, r.err)
  return r.out
}
async function json(sql) { return JSON.parse((await run(sql)).split('\n').at(-1)) }
const literal = value => "'" + String(value).replaceAll("'", "''") + "'"
const q = (f, key) => literal(f[key])
const admit = f => `public.admit_recurring_schedule(${q(f,'plan')},${q(f,'period')},${q(f,'machine')})`
const execute = (f, id) => `public.execute_recurring_schedule('${id}',${q(f,'machine')})`
const manual = f => `public.confirm_recurring_work_period(${q(f,'plan')},${q(f,'period')},gen_random_uuid(),'Synthetic recovery',${q(f,'owner')})`
const fixture = (name, offset=-1, optin=true) => json(`set role postgres; select private.ret4_fixture('${name}',${offset},${optin});`)
async function admission(f) { return json(`set role service_role; select to_jsonb(a) from ${admit(f)} a;`) }
async function scheduled(f,a) { return json(`set role service_role; select ${execute(f,a.id)};`) }
async function denied(sql, code='42501') {
  // Catch inside a rolled-back transaction without changing the effective test role.
  const output = await run(`begin; set local role service_role; do $test$ begin
    begin ${sql}; raise exception 'Expected rejection did not occur' using errcode='XX999';
    exception when sqlstate '${code}' then raise notice 'EXPECTED_REJECTION'; end;
    end $test$; rollback;`)
  return output
}
async function test(name, fn) {
  try { await fn(); results.push({name,passed:true}); console.log('PASS '+name) }
  catch(e) { results.push({name,passed:false,error:e.message}); console.log('FAIL '+name+': '+e.message) }
}
async function overlap(first, second, name) {
  const a = start(`begin; ${first}; select 'RET4_LOCKED'; select pg_sleep(2); commit;`, name+'_a')
  await Promise.race([a.marker, a.done.then(r => { throw new Error('First race participant ended before lock marker: '+r.err) })])
  const b = start(second, name+'_b')
  let blocked = false
  for (let i=0; i<30; i++) {
    blocked = (await run(`select exists(select 1 from pg_stat_activity where application_name='${name}_b' and wait_event_type='Lock' and cardinality(pg_blocking_pids(pid))>0);`)) === 't'
    if (blocked) break
    await new Promise(r => setTimeout(r,20))
  }
  const [ar,br] = await Promise.all([a.done,b.done])
  assert.equal(ar.code,0,ar.err); assert.equal(br.code,0,br.err)
  assert.ok(blocked,'No actual lock overlap observed')
  return [ar.out,br.out]
}
assert.equal(await run("select current_database()||':'||host(inet_server_addr())||':'||inet_server_port();"),database+':127.0.0.1:55444')
await run('set role postgres;\n'+readFileSync(resolve(root,'supabase/tests/ret4/fixture.sql'),'utf8'))
await test('private helper security, owner, empty search_path, exact ACL and no direct grants', async () => {
  const value = await json(`select jsonb_build_object(
    'definer',prosecdef,'owner',pg_get_userbyid(proowner),'config',proconfig,
    'allowed',has_function_privilege('service_role',oid,'EXECUTE'),
    'anon',has_function_privilege('anon',oid,'EXECUTE'),
    'human',has_function_privilege('authenticated',oid,'EXECUTE'),
    'public',exists(select 1 from aclexplode(proacl) where grantee=0),
    'auth_read',has_table_privilege('service_role','auth.users','SELECT'),
    'auth_update',has_table_privilege('service_role','auth.users','UPDATE'),
    'registry_update',has_table_privilege('service_role','private.recurring_scheduler_principals','UPDATE'),
    'locks',(length(prosrc)-length(replace(prosrc,'for share','')))/9)
    from pg_proc where oid='private.assert_recurring_scheduler(uuid,uuid)'::regprocedure;`)
  assert.deepEqual(value,{definer:true,owner:'postgres',config:['search_path=""'],allowed:true,anon:false,human:false,public:false,auth_read:false,auth_update:false,registry_update:false,locks:3})
  assert.equal(await run("select bool_and(not prosecdef) from pg_proc where oid in ('public.admit_recurring_schedule(uuid,date,uuid)'::regprocedure,'public.execute_recurring_schedule(uuid,uuid)'::regprocedure);"),'t')
})
await test('anonymous and authenticated cannot invoke helper or either action', async () => {
  for(const role of ['anon','authenticated']) for(const call of [
    "private.assert_recurring_scheduler(gen_random_uuid(),gen_random_uuid())",
    "public.admit_recurring_schedule(gen_random_uuid(),current_date,gen_random_uuid())",
    "public.execute_recurring_schedule(gen_random_uuid(),gen_random_uuid())"]) {
    const r=await start(`set role ${role}; select ${call};`).done
    assert.notEqual(r.code,0); assert.match(r.err,/permission denied/)
  }
})
for (const mode of ['missing','disabled','human','deleted','banned','wrong_org','inactive_org']) await test('machine rejects '+mode,async()=>{
  const f=await fixture('deny_'+mode)
  let actor=q(f,'machine'), org=q(f,'org'), change=''
  if(mode==='missing') actor="'00000000-0000-4000-8000-000000000004'"
  if(mode==='disabled') change=`update private.recurring_scheduler_principals set enabled=false where actor_id=${actor};`
  if(mode==='human') change=`insert into public.organization_memberships(organization_id,user_id,member_kind,role,department_id,status) values(${org},${actor},'team','contributor','content','active');`
  if(mode==='deleted') change=`update auth.users set deleted_at=clock_timestamp() where id=${actor};`
  if(mode==='banned') change=`update auth.users set banned_until=clock_timestamp()+interval '1 hour' where id=${actor};`
  if(mode==='wrong_org') org="'00000000-0000-4000-8000-000000000004'"
  if(mode==='inactive_org') change=`update public.organizations set status='suspended' where id=${org};`
  await run(`begin; set role postgres; ${change} set local role service_role;
    do $test$ begin begin perform private.assert_recurring_scheduler(${actor},${org}); raise exception 'Accepted invalid machine' using errcode='XX999';
    exception when sqlstate '42501' then null; end; end $test$; rollback;`)
})
await test('actual service-role admission, generation, audit attribution and exact replay',async()=>{
  const f=await fixture('generate')
  const a=await admission(f), b=await admission(f)
  assert.equal(a.id,b.id); assert.equal(a.retry_deadline,b.retry_deadline)
  const result=await scheduled(f,a)
  assert.equal(result.outcome,'generated',JSON.stringify(result))
  const replay=await scheduled(f,a)
  assert.equal(replay.outcome,'replayed'); assert.equal(replay.occurrence_id,result.occurrence_id)
  const counts=await json(`select jsonb_build_object('occurrences',(select count(*) from public.recurring_work_occurrences where plan_id=${q(f,'plan')}),
    'items',(select count(*) from public.work_items where recurring_plan_id=${q(f,'plan')}),
    'machine_items',(select count(*) from public.work_items where recurring_plan_id=${q(f,'plan')} and created_by=${q(f,'machine')}),
    'machine_events',(select count(*) from public.engagement_events where engagement_id=${q(f,'engagement')} and payload->>'execution_source'='recurring_scheduler' and actor_id=${q(f,'machine')}),
    'attempts',(select count(*) from public.recurring_work_generation_attempts where request_key='${a.id}'));`)
  assert.deepEqual(counts,{occurrences:1,items:2,machine_items:2,machine_events:5,attempts:1})
})
for(const [name,offset,optin] of [['empty settings',-1,false],['future due',2,true],['missed due',-6,true]]) await test('admission denies '+name,async()=>{
  const f=await fixture(name,offset,optin); await denied('perform '+admit(f),'55000')
})
for(const name of ['manual_first','scheduler_first']) await test('genuine concurrent '+name,async()=>{
  const f=await fixture(name), a=await admission(f)
  const first=name==='manual_first'?manual(f):execute(f,a.id)
  const second=name==='manual_first'?execute(f,a.id):manual(f)
  const output=await overlap('set local role service_role; select '+first,'set role service_role; select '+second+';',name)
  assert.ok(output[1].includes('replayed'),output[1])
  assert.deepEqual(await json(`select jsonb_build_object('occurrences',(select count(*) from public.recurring_work_occurrences where plan_id=${q(f,'plan')}),'items',(select count(*) from public.work_items where recurring_plan_id=${q(f,'plan')}));`),{occurrences:1,items:2})
})
for(const mode of ['disable','ban']) await test('concurrent '+mode+' waits for share lock and rejects subsequent admission',async()=>{
  const f=await fixture('race_'+mode)
  const change=mode==='disable'?`update private.recurring_scheduler_principals set enabled=false where actor_id=${q(f,'machine')}`:`update auth.users set banned_until=clock_timestamp()+interval '1 hour' where id=${q(f,'machine')}`
  await overlap(`set local role service_role; select private.assert_recurring_scheduler(${q(f,'machine')},${q(f,'org')})`, 'set role postgres; '+change+';', 'revoke_'+mode)
  await denied('perform '+admit(f))
})

await test('exact admission, strict approval/reactivation and retry boundary truth tables',async()=>{
  assert.equal(await run(`select bool_and(actual=expected) from (values
    (private.recurring_admission_open('2026-09-04 09:00Z','2026-09-04 09:00Z','2026-09-04','UTC','2026-09-04 08:00Z','2026-09-04 08:00Z'),true),
    (private.recurring_admission_open('2026-09-04 08:59:59.999999Z','2026-09-04 09:00Z','2026-09-04','UTC','2026-09-04 08:00Z','2026-09-04 08:00Z'),false),
    (private.recurring_admission_open('2026-09-04 09:04:59.999999Z','2026-09-04 09:00Z','2026-09-04','UTC','2026-09-04 08:00Z','2026-09-04 08:00Z'),true),
    (private.recurring_admission_open('2026-09-04 09:05Z','2026-09-04 09:00Z','2026-09-04','UTC','2026-09-04 08:00Z','2026-09-04 08:00Z'),false),
    (private.recurring_admission_open('2026-09-04 09:01Z','2026-09-04 09:00Z','2026-09-04','UTC','2026-09-04 09:00Z','2026-09-04 08:00Z'),false),
    (private.recurring_admission_open('2026-09-04 09:01Z','2026-09-04 09:00Z','2026-09-04','UTC','2026-09-04 08:00Z','2026-09-04 09:00Z'),false),
    (private.recurring_admission_open('2026-09-05 00:00Z','2026-09-04 23:59Z','2026-09-04','UTC','2026-09-04 08:00Z','2026-09-04 08:00Z'),false),
    (private.recurring_execution_open('2026-09-04 09:14:59.999999Z','2026-09-04 09:15Z','2026-09-04','UTC'),true),
    (private.recurring_execution_open('2026-09-04 09:15Z','2026-09-04 09:15Z','2026-09-04','UTC'),false),
    (private.recurring_execution_open('2026-09-04 19:00Z','2026-09-04 19:10Z','2026-09-04','Asia/Karachi'),false)
  ) checks(actual,expected);`),'t')
})
async function version(f,{start=f.period,end=null,approval='before'}={}) {
  return json(`begin; set role service_role;
    select to_jsonb(v) from public.create_recurring_work_plan_version(${q(f,'plan')},'New version','Synthetic','weekly','UTC',${literal(start)},${end?literal(end):'null'},${literal(JSON.stringify(f.schedule))}::jsonb,${literal(JSON.stringify(f.templates))}::jsonb,${q(f,'owner')}) v;
    set role postgres;
    insert into public.recurring_work_plan_version_approvals(organization_id,plan_id,plan_version_id,approved_by,approved_at)
      select organization_id,plan_id,id,${q(f,'lead')},${q(f,'due')}::timestamptz ${approval==='before'?"- interval '1 hour'":approval==='at'?'':"+ interval '1 second'"} from public.recurring_work_plan_versions where plan_id=${q(f,'plan')} order by version_number desc limit 1;
    update public.recurring_work_plans set approved_version_id=(select id from public.recurring_work_plan_versions where plan_id=${q(f,'plan')} order by version_number desc limit 1) where id=${q(f,'plan')};
    commit;`)
}
await test('version precedence, effective end inclusive, and version-change retry manual review',async()=>{
  const f=await fixture('version_change'), a=await admission(f)
  const v=await version(f,{end:f.period})
  const result=await scheduled(f,a)
  assert.equal(result.outcome,'manual_review')
  assert.equal(await run(`select count(*) from public.recurring_work_occurrences where plan_id=${q(f,'plan')};`),'0')
  const g=await fixture('inclusive_end')
  const latest=await version(g,{end:g.period})
  assert.equal((await admission(g)).plan_version_id,latest.id)
  assert.notEqual(v.id,f.version)
})
await test('effective_start outranks later version number and expired versions are excluded',async()=>{
  const f=await fixture('precedence')
  const earlier=new Date(f.period+'T00:00:00Z'); earlier.setUTCDate(earlier.getUTCDate()-7)
  await version(f,{start:earlier.toISOString().slice(0,10)})
  assert.equal((await admission(f)).plan_version_id,f.version)
  const g=await fixture('expired_version')
  const yesterday=new Date(g.period+'T00:00:00Z'); yesterday.setUTCDate(yesterday.getUTCDate()-1)
  await version(g,{start:earlier.toISOString().slice(0,10),end:yesterday.toISOString().slice(0,10)})
  assert.equal((await admission(g)).plan_version_id,g.version)
})
for(const approval of ['at','after']) await test('approval '+approval+' due cannot admit',async()=>{
  const f=await fixture('late_approval_'+approval)
  await version(f,{approval})
  await denied('perform '+admit(f),'55000')
})
await test('scheduled replay preserves manually generated older occurrence version and identity',async()=>{
  const f=await fixture('old_occurrence')
  const original=await json('set role service_role; select '+manual(f)+';')
  const latest=await version(f)
  const a=await admission(f)
  assert.equal(a.plan_version_id,latest.id)
  const replay=await scheduled(f,a)
  assert.equal(replay.outcome,'replayed')
  assert.equal(replay.occurrence_id,original.occurrence_id)
  assert.equal(replay.plan_version_id,original.plan_version_id)
})
for(const status of ['paused','ended','archived']) await test(status+' plan blocks scheduled execution',async()=>{
  const f=await fixture(status), a=await admission(f)
  const steps=status==='archived'?['ended','archived']:[status]
  for(const s of steps) await run(`set role service_role; select public.transition_recurring_work_plan(${q(f,'plan')},'${s}','Synthetic reason','Synthetic impact',${q(f,'lead')});`)
  assert.equal((await scheduled(f,a)).outcome,'manual_review')
  assert.equal(await run(`select count(*) from public.recurring_work_occurrences where plan_id=${q(f,'plan')};`),'0')
})
await test('reactivation cannot recover current due; future canonical period remains eligible',async()=>{
  const f=await fixture('reactivate')
  await run(`set role service_role;
    select public.transition_recurring_work_plan(${q(f,'plan')},'paused','Synthetic pause','',${q(f,'lead')});
    select public.transition_recurring_work_plan(${q(f,'plan')},'active','','',${q(f,'lead')});`)
  await denied('perform '+admit(f),'55000')
  assert.equal(await run(`select private.recurring_admission_open(${q(f,'due')}::timestamptz+interval '7 days',${q(f,'due')}::timestamptz+interval '7 days',${q(f,'period')}::date+7,'UTC',${q(f,'due')}::timestamptz-interval '1 hour',clock_timestamp());`),'t')
})
await test('current human Service Owner required; machine cannot impersonate manual owner',async()=>{
  const f=await fixture('human_authority')
  await denied(`perform public.confirm_recurring_work_period(${q(f,'plan')},${q(f,'period')},gen_random_uuid(),'',${q(f,'machine')})`)
  await denied(`perform public.confirm_recurring_work_period(${q(f,'plan')},${q(f,'period')},gen_random_uuid(),'',${q(f,'lead')})`)
  const preview=await json(`set role service_role; select public.preview_recurring_work_period(${q(f,'plan')},${q(f,'period')},'',${q(f,'owner')});`)
  assert.equal(preview.eligible,true)
})
await test('past missed period needs explicit human reason and has no scheduler catch-up',async()=>{
  const f=await fixture('past_recovery',-1441)
  await denied('perform '+admit(f),'55000')
  await denied(`perform public.confirm_recurring_work_period(${q(f,'plan')},${q(f,'period')},gen_random_uuid(),'',${q(f,'owner')})`,'22023')
  const manualResult=await json('set role service_role; select '+manual(f)+';')
  assert.equal(manualResult.outcome,'generated')
})
await run(`set role postgres;
  create or replace function private.ret4_test_failure() returns trigger language plpgsql set search_path='' as $test$
  begin
    if new.recurring_template_key='second_item' then
      if new.recurring_plan_id::text=current_setting('ret4.fail_plan',true) then raise exception 'Synthetic second-item failure'; end if;
      if new.recurring_plan_id::text=current_setting('ret4.delay_plan',true) then perform pg_sleep(5); end if;
    end if;
    return new;
  end; $test$;
  revoke all on function private.ret4_test_failure() from public,anon,authenticated,service_role;
  drop trigger if exists ret4_test_failure on public.work_items;
  create trigger ret4_test_failure before insert on public.work_items for each row execute function private.ret4_test_failure();`)
await test('second-item failure atomically rolls back business batch but saves failure and admission for retry',async()=>{
  const f=await fixture('batch_failure'), a=await admission(f)
  const failure=await json(`set role service_role; set ret4.fail_plan=${q(f,'plan')}; select ${execute(f,a.id)};`)
  assert.equal(failure.outcome,'retryable_failure')
  const counts=await json(`select jsonb_build_object(
    'occurrences',(select count(*) from public.recurring_work_occurrences where plan_id=${q(f,'plan')}),
    'items',(select count(*) from public.work_items where recurring_plan_id=${q(f,'plan')}),
    'events',(select count(*) from public.engagement_events where engagement_id=${q(f,'engagement')} and payload->>'execution_source'='recurring_scheduler'),
    'attempts',(select count(*) from public.recurring_work_generation_attempts where plan_id=${q(f,'plan')}),
    'admissions',(select count(*) from public.recurring_schedule_admissions where id='${a.id}'),
    'failures',(select count(*) from public.recurring_schedule_executions where admission_id='${a.id}' and outcome='retryable_failure'));`)
  assert.deepEqual(counts,{occurrences:0,items:0,events:0,attempts:0,admissions:1,failures:1})
  assert.equal((await scheduled(f,a)).outcome,'generated')
  assert.equal((await admission(f)).retry_deadline,a.retry_deadline)
})
async function nearDeadline(f,remaining) {
  return json(`set role postgres; with timing as (select clock_timestamp()+make_interval(secs=>${remaining}) as deadline)
    insert into public.recurring_schedule_admissions(organization_id,plan_id,plan_version_id,period_start,timezone,due_at,admitted_at,retry_deadline,plan_status_changed_at,actor_id)
    select ${q(f,'org')},${q(f,'plan')},${q(f,'version')},${q(f,'period')},'UTC',deadline-interval '16 minutes',deadline-interval '15 minutes',deadline,p.status_changed_at,${q(f,'machine')}
    from timing cross join public.recurring_work_plans p where p.id=${q(f,'plan')} returning to_jsonb(recurring_schedule_admissions);`)
}
await test('expired admitted retry is terminal manual review with no work',async()=>{
  const f=await fixture('expired'), a=await nearDeadline(f,-1)
  assert.equal((await scheduled(f,a)).outcome,'manual_review')
  assert.equal((await scheduled(f,a)).outcome,'manual_review')
  assert.equal(await run(`select count(*) from public.work_items where recurring_plan_id=${q(f,'plan')};`),'0')
})
await test('deadline crossed inside batch rolls back all work and audit writes',async()=>{
  const f=await fixture('cross_deadline'), a=await nearDeadline(f,3)
  const result=await json(`set role service_role; set ret4.delay_plan=${q(f,'plan')}; select ${execute(f,a.id)};`)
  assert.equal(result.outcome,'manual_review')
  assert.equal(await run(`select count(*) from public.recurring_work_occurrences where plan_id=${q(f,'plan')};`),'0')
  assert.equal(await run(`select count(*) from public.work_items where recurring_plan_id=${q(f,'plan')};`),'0')
  assert.equal(await run(`select count(*) from public.engagement_events where engagement_id=${q(f,'engagement')} and payload->>'execution_source'='recurring_scheduler';`),'0')
})
await test('tenant binding and admission actor cannot be substituted',async()=>{
  const f=await fixture('tenant'), a=await admission(f), g=await fixture('other_actor')
  await denied('perform '+execute(g,a.id))
  await run(`begin; set role postgres; insert into public.organizations(id,name,slug) values('99999999-4444-4444-8444-444444444444','RET4 other tenant','ret4-other-tenant');
    update private.recurring_scheduler_principals set organization_id='99999999-4444-4444-8444-444444444444' where actor_id=${q(g,'machine')};
    set local role service_role; do $test$ begin begin perform public.admit_recurring_schedule(${q(f,'plan')},${q(f,'period')},${q(g,'machine')});
      raise exception 'Cross-tenant accepted' using errcode='XX999'; exception when sqlstate '42501' then null; end; end $test$; rollback;`)
})
await run('set role postgres; drop trigger ret4_test_failure on public.work_items; drop function private.ret4_test_failure();')

await test('noncanonical period and immutable admission deadline are rejected',async()=>{
  const f=await fixture('immutable'),a=await admission(f)
  await denied(`perform public.admit_recurring_schedule(${q(f,'plan')},${q(f,'period')}::date+1,${q(f,'machine')})`,'22023')
  await denied(`update public.recurring_schedule_admissions set retry_deadline=retry_deadline+interval '1 minute' where id='${a.id}'`)
  await run(`begin; set role postgres; do $test$ begin begin
    update public.recurring_schedule_admissions set retry_deadline=retry_deadline where id='${a.id}';
    raise exception 'Mutable admission' using errcode='XX999'; exception when sqlstate '55000' then null; end; end $test$; rollback;`)
})
for(const kind of ['assignee','service','engagement','catalog']) await test('inactive '+kind+' prevents scheduled business writes',async()=>{
  const f=await fixture('inactive_'+kind),a=await admission(f)
  const changes={
    assignee:`update public.organization_memberships set status='suspended' where organization_id=${q(f,'org')} and user_id=${q(f,'owner')}`,
    service:`update public.engagement_services set status='on_hold' where id=${q(f,'service')}`,
    engagement:`update public.engagements set status='on_hold' where id=${q(f,'engagement')}`,
    catalog:`update public.service_catalog set is_active=false where id=${q(f,'catalog')}`
  }
  await run('set role postgres; '+changes[kind]+';')
  assert.equal((await scheduled(f,a)).outcome,'manual_review')
  assert.equal(await run(`select count(*) from public.recurring_work_occurrences where plan_id=${q(f,'plan')};`),'0')
})
await test('concurrent pause waits behind execution and later execution is closed',async()=>{
  const f=await fixture('pause_race'),a=await admission(f)
  await overlap('set local role service_role; select '+execute(f,a.id),
    `set role service_role; select public.transition_recurring_work_plan(${q(f,'plan')},'paused','Synthetic race','',${q(f,'lead')});`,'pause_race')
  assert.equal((await scheduled(f,a)).outcome,'manual_review')
  assert.equal(await run(`select count(*) from public.recurring_work_occurrences where plan_id=${q(f,'plan')};`),'1')
})
await test('tenant read policies hide schedule evidence from a foreign team member',async()=>{
  const f=await fixture('rls'), a=await admission(f)
  await scheduled(f,a)
  const own = await run(`begin; set local role authenticated; select set_config('request.jwt.claim.sub',${q(f,'owner')},true);
    select (select count(*) from public.recurring_schedule_admissions where id='${a.id}')=1; rollback;`)
  assert.equal(own.split('\n').at(-1),'t')
  const foreign = await run(`begin; set role postgres;
    insert into public.organizations(id,name,slug) values('99999999-5555-4444-8444-444444444444','RET4 RLS tenant','ret4-rls-tenant');
    insert into auth.users(id) values('99999999-5555-4444-8444-444444444445');
    insert into public.organization_memberships(organization_id,user_id,member_kind,role,status)
      values('99999999-5555-4444-8444-444444444444','99999999-5555-4444-8444-444444444445','team','project_owner','active');
    set local role authenticated; select set_config('request.jwt.claim.sub','99999999-5555-4444-8444-444444444445',true);
    select (select count(*) from public.recurring_schedule_admissions where id='${a.id}')=0
      and (select count(*) from public.recurring_schedule_executions where admission_id='${a.id}')=0
      and (select count(*) from public.recurring_schedule_consents where plan_id=${q(f,'plan')})=0; rollback;`)
  assert.equal(foreign.split('\n').at(-1),'t')
})
console.log(JSON.stringify({checks:results.length,passed:results.filter(r=>r.passed).length,failed:results.filter(r=>!r.passed)},null,2))
if(results.some(r=>!r.passed)) process.exitCode=1
