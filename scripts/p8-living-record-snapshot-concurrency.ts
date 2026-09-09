// Admin-only LOCAL disposable PostgreSQL proof. The template must already contain the P8 migration.
import pg from 'npm:pg@8.23.0'
import assert from 'node:assert/strict'

const value = Deno.env.get('P8_LOCAL_TEMPLATE_URL')
if (!value) throw new Error('P8_LOCAL_TEMPLATE_URL is required; no database was touched')
const url = new URL(value)
if (url.protocol !== 'postgresql:' || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || url.search || url.hash) {
  throw new Error('Only an explicitly configured loopback PostgreSQL template is allowed')
}
const template = decodeURIComponent(url.pathname.slice(1))
if (!template.startsWith('p8_template_') || !/^[a-z0-9_]+$/.test(template)) {
  throw new Error('Template database must be named p8_template_*')
}

const database = 'p8_verify_' + crypto.randomUUID().replaceAll('-', '')
const adminUrl = new URL(url); adminUrl.pathname = '/postgres'
const testUrl = new URL(url); testUrl.pathname = '/' + database
const admin = new pg.Client({ connectionString: adminUrl.toString() })
const clients: pg.Client[] = []
let created = false

type Input = {
  organizationId: string
  projectId: string
  documentId: string
  projectionKind: 'internal' | 'client'
  sourceVersion: number
  requestId: string
  reason: string
}

async function invoke(client: pg.Client, actorId: string, input: Input) {
  await client.query('begin')
  try {
    await client.query("select set_config('request.jwt.claims',$1,true)", [
      JSON.stringify({ sub: actorId, role: 'authenticated' }),
    ])
    await client.query('set local role authenticated')
    const response = await client.query(
      'select public.preserve_living_project_snapshot($1,$2,$3,$4,$5,$6,$7) result',
      [input.organizationId, input.projectId, input.documentId, input.projectionKind,
        input.sourceVersion, input.requestId, input.reason],
    )
    await client.query('commit')
    return response.rows[0].result as {
      snapshot: { id: string; snapshot: Record<string, unknown> }
      idempotent_replay: boolean
    }
  } catch (error) {
    await client.query('rollback').catch(() => {})
    throw error
  }
}

await admin.connect()
try {
  const guard = await admin.query(
    'select host(inet_server_addr()) server_address, exists(select 1 from pg_database where datname=$1) template_exists',
    [template],
  )
  assert.ok(['127.0.0.1', '::1'].includes(guard.rows[0].server_address), 'PostgreSQL server is not loopback')
  assert.equal(guard.rows[0].template_exists, true, 'P8 local template does not exist')
  await admin.query('CREATE DATABASE "' + database + '" TEMPLATE "' + template + '"')
  created = true

  for (let index = 0; index < 3; index += 1) {
    const client = new pg.Client({ connectionString: testUrl.toString() })
    await client.connect()
    clients.push(client)
  }
  const [setup, first, second] = clients
  const organizationId = crypto.randomUUID()
  const actorId = crypto.randomUUID()
  const projectId = crypto.randomUUID()

  await setup.query('insert into auth.users(id) values($1)', [actorId])
  await setup.query(
    "insert into public.organizations(id,name,slug,status) values($1,'P8 concurrency fixture',$2,'active')",
    [organizationId, 'p8-' + organizationId],
  )
  await setup.query(
    "insert into public.organization_memberships(organization_id,user_id,member_kind,role,status) values($1,$2,'team','system_owner','active')",
    [organizationId, actorId],
  )
  await setup.query(
    "insert into public.projects(id,organization_id,name,owner_id,engagement_type) values($1,$2,'P8 concurrency project',$3,'project')",
    [projectId, organizationId, actorId],
  )
  const document = await setup.query(
    'select id,source_version from public.living_project_documents where project_id=$1 and organization_id=$2',
    [projectId, organizationId],
  )
  assert.equal(document.rowCount, 1)
  const base: Input = {
    organizationId,
    projectId,
    documentId: document.rows[0].id,
    sourceVersion: Number(document.rows[0].source_version),
    projectionKind: 'internal',
    requestId: crypto.randomUUID(),
    reason: 'P8 concurrent replay',
  }

  const replay = await Promise.all([invoke(first, actorId, base), invoke(second, actorId, base)])
  assert.equal(replay[0].snapshot.id, replay[1].snapshot.id)
  assert.deepEqual(replay.map((result) => result.idempotent_replay).sort(), [false, true])
  const replayRows = await setup.query(
    `select
      (select count(*) from public.living_project_document_snapshots where id=$1) snapshot_count,
      (select count(*) from private.living_project_snapshot_requests
       where organization_id=$2 and requested_by=$3 and request_id=$4) request_count`,
    [replay[0].snapshot.id, organizationId, actorId, base.requestId],
  )
  assert.equal(replayRows.rows[0].snapshot_count, '1')
  assert.equal(replayRows.rows[0].request_count, '1')

  const conflictId = crypto.randomUUID()
  const conflictA = { ...base, projectionKind: 'client' as const, requestId: conflictId, reason: 'conflict A' }
  const conflictB = { ...conflictA, reason: 'conflict B' }
  const conflict = await Promise.allSettled([
    invoke(first, actorId, conflictA),
    invoke(second, actorId, conflictB),
  ])
  assert.equal(conflict.filter((result) => result.status === 'fulfilled').length, 1)
  const rejected = conflict.find((result) => result.status === 'rejected') as PromiseRejectedResult
  const error = rejected.reason as { code?: string; message?: string }
  assert.equal(error.code, '22023')
  assert.equal(error.message, 'Request id was already used with different inputs.')
  const conflictRows = await setup.query(
    `select
      (select count(*) from public.living_project_document_snapshots
       where living_project_document_id=$1 and projection_kind='client' and source_version=$2) snapshot_count,
      (select count(*) from private.living_project_snapshot_requests
       where organization_id=$3 and requested_by=$4 and request_id=$5) request_count`,
    [base.documentId, base.sourceVersion, organizationId, actorId, conflictId],
  )
  assert.equal(conflictRows.rows[0].snapshot_count, '1')
  assert.equal(conflictRows.rows[0].request_count, '1')
  console.log('two_sessions=true; exact_replay=true; conflicting_retry_rejected=true; one_snapshot=true; one_ledger_row=true')
} finally {
  for (const client of clients) {
    await client.query('rollback').catch(() => {})
    await client.end()
  }
  if (created) await admin.query('DROP DATABASE "' + database + '"')
  await admin.end()
}
