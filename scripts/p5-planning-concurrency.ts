// Admin-only LOCAL PostgreSQL 17 proof. The template must already contain P5.
// This script accepts loopback only, clones and drops only its own random DB,
// and never applies a migration or contacts a hosted database.
import pg from 'npm:pg@8.23.0'
import assert from 'node:assert/strict'

const urlText = Deno.env.get('P5_LOCAL_TEMPLATE_URL')
if (!urlText) throw new Error('P5_LOCAL_TEMPLATE_URL is required; no database was touched')
const url = new URL(urlText)
if (url.protocol !== 'postgresql:' || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || url.search || url.hash) {
  throw new Error('Only an explicitly configured loopback PostgreSQL template is allowed')
}
const template = decodeURIComponent(url.pathname.slice(1))
if (!template.startsWith('p5_template_') || !/^[a-z0-9_]+$/.test(template)) {
  throw new Error('Template database must be named p5_template_*')
}

const database = 'p5_verify_' + crypto.randomUUID().replaceAll('-', '')
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
  assert.equal(guard.rows[0].template_exists, true, 'P5 local template does not exist')
  await admin.query('CREATE DATABASE "' + database + '" TEMPLATE "' + template + '"')
  created = true

  for (let index = 0; index < 3; index++) {
    const client = new pg.Client({ connectionString: testUrl.toString() })
    await client.connect()
    clients.push(client)
  }
  const [setup, first, second] = clients
  const ids = {
    actor: crypto.randomUUID(), org: crypto.randomUUID(), client: crypto.randomUUID(),
    agencyClient: crypto.randomUUID(), project: crypto.randomUUID(), brand: crypto.randomUUID(),
    engagement: crypto.randomUUID(), task: crypto.randomUUID(),
    itemA: crypto.randomUUID(), itemB: crypto.randomUUID(), itemC: crypto.randomUUID(),
  }

  await setup.query('insert into auth.users(id) values($1)', [ids.actor])
  await setup.query('insert into public.organizations(id,name,slug,status) values($1,$2,$3,$4)', [ids.org, 'P5 concurrency', 'p5-' + ids.org, 'active'])
  await setup.query("insert into public.organization_memberships(organization_id,user_id,member_kind,role,status) values($1,$2,'team','system_owner','active')", [ids.org, ids.actor])
  await setup.query("insert into public.clients(id,organization_id,name,company,status,owner_id) values($1,$2,'P5 client','P5 client','active',$3)", [ids.client, ids.org, ids.actor])
  await setup.query("insert into public.agency_clients(id,organization_id,legacy_client_id,canonical_client_id,name,status,owner_id,created_by) values($1,$2,$3,$3,'P5 agency client','active',$4,$4)", [ids.agencyClient, ids.org, ids.client, ids.actor])
  await setup.query("insert into public.projects(id,organization_id,client_id,name,engagement_type,status,owner_id) values($1,$2,$3,'P5 project','project','active',$4)", [ids.project, ids.org, ids.client, ids.actor])
  await setup.query("insert into public.brands(id,organization_id,client_id,name,status,created_by) values($1,$2,$3,'P5 brand','active',$4)", [ids.brand, ids.org, ids.agencyClient, ids.actor])
  await setup.query("insert into public.engagements(id,organization_id,client_id,brand_id,legacy_project_id,project_id,name,status,created_by) values($1,$2,$3,$4,$5,$5,'P5 engagement','active',$6)", [ids.engagement, ids.org, ids.agencyClient, ids.brand, ids.project, ids.actor])
  await setup.query("insert into public.tasks(id,organization_id,project_id,user_id,created_by,assigned_to,title,status) values($1,$2,$3,$4,$4,$4,'P5 task','ready')", [ids.task, ids.org, ids.project, ids.actor])
  await setup.query(
    "insert into public.work_items(id,organization_id,engagement_id,project_id,brand_id,title,status,position,created_by) values($1,$4,$5,$6,$7,'A','not_started',1000,$8),($2,$4,$5,$6,$7,'B','not_started',2000,$8),($3,$4,$5,$6,$7,'C','done',1000,$8)",
    [ids.itemA, ids.itemB, ids.itemC, ids.org, ids.engagement, ids.project, ids.brand, ids.actor],
  )

  await beginService(first)
  const firstTask = await first.query(
    "select (public.transition_p5_project_task($1,$2,1,'in_progress','first',$3)).row_version version",
    [ids.org, ids.task, ids.actor],
  )
  assert.equal(firstTask.rows[0].version, '2')

  let secondTaskSettled = false
  const secondTask = (async () => {
    await beginService(second)
    try {
      await second.query(
        "select public.transition_p5_project_task($1,$2,1,'blocked','second',$3)",
        [ids.org, ids.task, ids.actor],
      )
      await second.query('commit')
      return null
    } catch (error) {
      await second.query('rollback')
      return error as { code?: string; message?: string }
    } finally {
      secondTaskSettled = true
    }
  })()
  await new Promise(resolve => setTimeout(resolve, 150))
  assert.equal(secondTaskSettled, false, 'second task writer did not wait on the row lock')
  await first.query('commit')
  const stale = await secondTask
  assert.equal(stale?.code, '40001')
  const stalePayload = JSON.parse(stale?.message || '{}')
  assert.deepEqual(stalePayload, {
    code: 'stale_write',
    recordKind: 'project_task',
    recordId: ids.task,
    expectedRowVersion: 1,
    currentRowVersion: 2,
  })

  await beginService(first)
  const firstMove = await first.query(
    'select id,row_version from public.move_p5_work_item($1,$2,1,$3,$4,$5)',
    [ids.org, ids.itemA, 'done', ids.itemC, ids.actor],
  )
  assert.equal(firstMove.rowCount, 2)

  let secondMoveSettled = false
  const secondMove = (async () => {
    await beginService(second)
    try {
      const result = await second.query(
        'select id,row_version from public.move_p5_work_item($1,$2,1,$3,$4,$5)',
        [ids.org, ids.itemB, 'done', ids.itemC, ids.actor],
      )
      await second.query('commit')
      return result
    } catch (error) {
      await second.query('rollback')
      throw error
    } finally {
      secondMoveSettled = true
    }
  })()
  await new Promise(resolve => setTimeout(resolve, 150))
  assert.equal(secondMoveSettled, false, 'second move did not wait on the engagement ordering lock')
  await first.query('commit')
  const moved = await secondMove
  assert.equal(moved.rowCount, 2)

  const finalRows = await setup.query(
    'select id,status,position from public.work_items where id=any($1::uuid[]) order by position,id',
    [[ids.itemA, ids.itemB, ids.itemC]],
  )
  assert.deepEqual(finalRows.rows, [
    { id: ids.itemA, status: 'done', position: 1000 },
    { id: ids.itemB, status: 'done', position: 2000 },
    { id: ids.itemC, status: 'done', position: 3000 },
  ])
  console.log('task_second_session_waited=true; exact_stale_payload=true; moves_serialized=true; final_order_unique=true')
} finally {
  for (const client of clients) {
    await client.query('rollback').catch(() => {})
    await client.end()
  }
  if (created) await admin.query('DROP DATABASE "' + database + '"')
  await admin.end()
}
