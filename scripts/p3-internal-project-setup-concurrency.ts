// Admin-only LOCAL disposable PostgreSQL proof. The template must already
// contain the P3 migration. This script clones and drops only its own random
// database; it never applies migrations and rejects every non-loopback host.
import pg from 'npm:pg@8.23.0'
import assert from 'node:assert/strict'

const urlText = Deno.env.get('P3_LOCAL_TEMPLATE_URL')
if (!urlText) throw new Error('P3_LOCAL_TEMPLATE_URL is required; no database was touched')
const url = new URL(urlText)
if (url.protocol !== 'postgresql:' || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || url.search || url.hash) {
  throw new Error('Only an explicitly configured loopback PostgreSQL template is allowed')
}
const template = decodeURIComponent(url.pathname.slice(1))
if (!template.startsWith('p3_template_') || !/^[a-z0-9_]+$/.test(template)) {
  throw new Error('Template database must be named p3_template_*')
}

const database = 'p3_verify_' + crypto.randomUUID().replaceAll('-', '')
const adminUrl = new URL(url); adminUrl.pathname = '/postgres'
const testUrl = new URL(url); testUrl.pathname = '/' + database
const admin = new pg.Client({ connectionString: adminUrl.toString() })
const clients: pg.Client[] = []
let created = false

type SetupInput = {
  organizationId: string
  requestId: string
  name: string
  ownerId: string
  workstreams: Array<{ department_id: string; owner_id: string }>
}

async function invoke(client: pg.Client, actorId: string, input: SetupInput) {
  await client.query('begin')
  try {
    await client.query("select set_config('request.jwt.claims',$1,true)", [
      JSON.stringify({ sub: actorId, role: 'authenticated' }),
    ])
    await client.query('set local role authenticated')
    const result = await client.query(
      `select public.create_internal_project_setup(
        $1,$2,$3,'Concurrency proof',$4,'2026-09-04','2026-10-04',
        'Internal concurrency scope','No client work',$5::jsonb
      ) result`,
      [input.organizationId, input.requestId, input.name, input.ownerId, JSON.stringify(input.workstreams)],
    )
    await client.query('commit')
    return result.rows[0].result as {
      project_id: string
      workstreams: Array<{ id: string; department_id: string; owner_id: string }>
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
    `select inet_server_addr()::text server_address,
      exists(select 1 from pg_database where datname=$1) template_exists`,
    [template],
  )
  assert.ok(['127.0.0.1', '::1'].includes(guard.rows[0].server_address), 'PostgreSQL server is not loopback')
  assert.equal(guard.rows[0].template_exists, true, 'P3 local template does not exist')

  await admin.query('CREATE DATABASE "' + database + '" TEMPLATE "' + template + '"')
  created = true
  for (let index = 0; index < 3; index++) {
    const client = new pg.Client({ connectionString: testUrl.toString() })
    await client.connect()
    clients.push(client)
  }
  const [setup, first, second] = clients
  const ids = {
    organization: crypto.randomUUID(),
    actor: crypto.randomUUID(),
    projectOwner: crypto.randomUUID(),
    contentOwner: crypto.randomUUID(),
    requestReplay: crypto.randomUUID(),
    requestConflict: crypto.randomUUID(),
  }

  await setup.query('insert into auth.users(id) values($1),($2),($3)', [
    ids.actor,
    ids.projectOwner,
    ids.contentOwner,
  ])
  await setup.query('insert into public.organizations(id,name,slug,status) values($1,$2,$3,$4)', [
    ids.organization,
    'P3 concurrency fixture',
    'p3-' + ids.organization,
    'active',
  ])
  await setup.query('update public.departments set organization_id=$1', [ids.organization])
  await setup.query(
    `insert into public.organization_memberships(
      organization_id,user_id,member_kind,role,department_id,status
    ) values
      ($1,$2,'team','contributor','content','active'),
      ($1,$3,'team','project_owner','design','active'),
      ($1,$4,'team','contributor','content','active')`,
    [ids.organization, ids.actor, ids.projectOwner, ids.contentOwner],
  )
  await setup.query(
    `update public.profiles set full_name=case id
      when $1 then 'P3 creator'
      when $2 then 'P3 project owner'
      when $3 then 'P3 content owner'
    end where id in ($1,$2,$3)`,
    [ids.actor, ids.projectOwner, ids.contentOwner],
  )

  await first.query('begin')
  await first.query("select set_config('request.jwt.claims',$1,true)", [
    JSON.stringify({ sub: ids.actor, role: 'authenticated' }),
  ])
  await first.query('set local role authenticated')
  const options = (await first.query(
    'select public.get_internal_project_setup_options($1) result',
    [ids.organization],
  )).rows[0].result
  await first.query('rollback')
  assert.deepEqual(
    options.members.map((member: { id: string }) => member.id).sort(),
    [ids.actor, ids.contentOwner, ids.projectOwner].sort(),
    'ordinary project creator must see the tenant-scoped selectable owners',
  )

  const selected = [
    { department_id: 'content', owner_id: ids.contentOwner },
    { department_id: 'design', owner_id: ids.projectOwner },
  ]
  const replayInput: SetupInput = {
    organizationId: ids.organization,
    requestId: ids.requestReplay,
    name: 'P3 concurrent replay',
    ownerId: ids.projectOwner,
    workstreams: selected,
  }
  const replayResults = await Promise.all([
    invoke(first, ids.actor, replayInput),
    invoke(second, ids.actor, replayInput),
  ])
  assert.equal(replayResults[0].project_id, replayResults[1].project_id)
  assert.deepEqual(replayResults.map((result) => result.idempotent_replay).sort(), [false, true])
  const replayRows = await setup.query(
    `select
      (select count(*) from public.projects where id=$1) project_count,
      (select jsonb_agg(jsonb_build_object('department_id',department_id,'owner_id',owner_id)
        order by department_id) from public.workstreams where project_id=$1) workstreams,
      (select count(*) from private.internal_project_setup_requests
        where organization_id=$2 and requested_by=$3 and request_id=$4) request_count`,
    [replayResults[0].project_id, ids.organization, ids.actor, ids.requestReplay],
  )
  assert.equal(replayRows.rows[0].project_count, '1')
  assert.deepEqual(replayRows.rows[0].workstreams, selected)
  assert.equal(replayRows.rows[0].request_count, '1')

  const conflictA: SetupInput = {
    ...replayInput,
    requestId: ids.requestConflict,
    name: 'P3 concurrent conflict A',
  }
  const conflictB: SetupInput = { ...conflictA, name: 'P3 concurrent conflict B' }
  const conflictResults = await Promise.allSettled([
    invoke(first, ids.actor, conflictA),
    invoke(second, ids.actor, conflictB),
  ])
  const accepted = conflictResults.filter((result) => result.status === 'fulfilled')
  const rejected = conflictResults.filter((result) => result.status === 'rejected')
  assert.equal(accepted.length, 1)
  assert.equal(rejected.length, 1)
  const conflictError = (rejected[0] as PromiseRejectedResult).reason as { code?: string; message?: string }
  assert.equal(conflictError.code, '22023')
  assert.equal(conflictError.message, 'Request id was already used with different inputs.')
  const acceptedResult = (accepted[0] as PromiseFulfilledResult<Awaited<ReturnType<typeof invoke>>>).value
  const conflictRows = await setup.query(
    `select
      (select count(*) from public.projects where id=$1) project_count,
      (select jsonb_agg(jsonb_build_object('department_id',department_id,'owner_id',owner_id)
        order by department_id) from public.workstreams where project_id=$1) workstreams,
      (select count(*) from private.internal_project_setup_requests
        where organization_id=$2 and requested_by=$3 and request_id=$4) request_count`,
    [acceptedResult.project_id, ids.organization, ids.actor, ids.requestConflict],
  )
  assert.equal(conflictRows.rows[0].project_count, '1')
  assert.deepEqual(conflictRows.rows[0].workstreams, selected)
  assert.equal(conflictRows.rows[0].request_count, '1')

  console.log('two_sessions=true; same_payload_exact_replay=true; conflicting_payload_rejected=true; exact_project_and_workstreams=true; ordinary_creator_owner_validation=true')
} finally {
  for (const client of clients) {
    await client.query('rollback').catch(() => {})
    await client.end()
  }
  if (created) await admin.query('DROP DATABASE "' + database + '"')
  await admin.end()
}
