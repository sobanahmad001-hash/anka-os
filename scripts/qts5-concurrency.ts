// Admin-only LOCAL disposable PostgreSQL check. No hosted/remote URL is accepted.
// Template must already contain approved QTS1-QTS5 schema. This script creates
// and drops only its own randomly named database, never applies migrations.
import pg from 'npm:pg@8.23.0'
import assert from 'node:assert/strict'
const urlText = Deno.env.get('QTS5_LOCAL_TEMPLATE_URL')
if (!urlText) throw new Error('QTS5_LOCAL_TEMPLATE_URL is required; native local PostgreSQL test unavailable')
const url = new URL(urlText)
if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || url.protocol !== 'postgresql:' || url.search || url.hash) {
  throw new Error('Only an explicitly configured local PostgreSQL template is allowed')
}
const template = decodeURIComponent(url.pathname.slice(1))
if (!template.startsWith('qts5_template_') || !/^[a-z0-9_]+$/.test(template)) {
  throw new Error('Template database must be named qts5_template_*')
}
const dbName = 'qts5_verify_' + crypto.randomUUID().replaceAll('-', '')
const adminUrl = new URL(url); adminUrl.pathname = '/postgres'
const admin = new pg.Client({ connectionString: adminUrl.toString() })
const testUrl = new URL(url); testUrl.pathname = '/' + dbName
const clients = []
let created = false
await admin.connect()
try {
  await admin.query('CREATE DATABASE "' + dbName + '" TEMPLATE "' + template + '"')
  created = true
  for (let i = 0; i < 3; i++) {
    const client = new pg.Client({ connectionString: testUrl.toString() })
    await client.connect(); clients.push(client)
  }
  const [setup, first, second] = clients
  const org = crypto.randomUUID(), actor = crypto.randomUUID(), source = crypto.randomUUID(), key = crypto.randomUUID()
  await setup.query('insert into auth.users(id) values($1)', [actor])
  await setup.query('insert into public.organizations(id,name,slug) values($1,$2,$3)', [org, 'QTS5 concurrent fixture', org])
  await setup.query("insert into public.organization_memberships(organization_id,user_id,member_kind,role,department_id,status) values($1,$2,'team','contributor','content','active')", [org, actor])
  await setup.query("insert into public.content_requests(id,organization_id,mode,output_path,format,brief,created_by) values($1,$2,'general','internal_engine','reel','Concurrent source',$3)", [source,org,actor])
  const sourceBefore = await setup.query('select to_jsonb(r) as row from public.content_requests r where id=$1',[source])
  const call = 'select public.copy_general_request_to_quick_task($1,$2,$3,$4) as result'
  const args = [org, source, key, actor]
  await first.query('begin')
  const a = await first.query(call, args)
  let secondFinished = false
  const pending = second.query(call, args).then((result: { rows: Array<{ result: { quick_task_id: string; replayed: boolean } }> }) => { secondFinished = true; return result })
  // Observe real lock contention instead of assuming that Promise.all races.
  let blocked = false
  for (let i = 0; i < 100; i++) {
    const locks = await setup.query("select exists(select 1 from pg_locks where locktype='advisory' and not granted and database=(select oid from pg_database where datname=current_database())) as blocked")
    if (locks.rows[0].blocked) { blocked = true; break }
    await new Promise(resolve => setTimeout(resolve, 20))
  }
  assert.equal(blocked, true, 'Second session must wait on the first copy transaction')
  assert.equal(secondFinished, false)
  await first.query('commit')
  const b = await pending
  assert.equal(a.rows[0].result.quick_task_id,b.rows[0].result.quick_task_id)
  assert.equal(b.rows[0].result.replayed,true)
  assert.equal(secondFinished,true)
  const counts = await setup.query('select (select count(*) from public.quick_tasks where organization_id=$1) tasks, (select count(*) from public.quick_task_revisions where organization_id=$1) revisions, (select count(*) from public.quick_task_request_copies where organization_id=$1) copies',[org])
  assert.deepEqual(counts.rows[0], {tasks:'1', revisions:'1', copies:'1'})
  const fresh = await second.query(call,[org,source,crypto.randomUUID(),actor])
  assert.notEqual(fresh.rows[0].result.quick_task_id,a.rows[0].result.quick_task_id)
  const sourceAfter = await setup.query('select to_jsonb(r) as row from public.content_requests r where id=$1',[source])
  assert.deepEqual(sourceAfter.rows,sourceBefore.rows)
  console.log('concurrent_retry_one_result=true; fresh_key_distinct=true; source_unchanged=true')
} finally {
  // Release the first transaction even when an assertion fails during contention.
  if (clients[1]) await clients[1].query('rollback').catch(() => {})
  for (const client of clients) await client.end()
  if (created) await admin.query('DROP DATABASE "' + dbName + '"')
  await admin.end()
}
