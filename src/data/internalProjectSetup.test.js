import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

let moduleSequence = 0
async function setupModule(client) {
  const key = '__internalProjectSetupTest' + moduleSequence++
  globalThis[key] = client
  const source = readFileSync(new URL('./internalProjectSetupRepository.js', import.meta.url), 'utf8')
    .replace(/import \{ supabase \} from '\.\.\/lib\/supabase\.js'/, 'const supabase = globalThis[' + JSON.stringify(key) + ']')
  try { return await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64')) }
  finally { delete globalThis[key] }
}

function fakeClient(seed = {}, rpcResult = { data: null, error: null, status: 200 }) {
  const calls = []
  return {
    calls,
    from(table) {
      const call = { type: 'from', table, filters: [], range: null, signal: null }
      calls.push(call)
      const query = {
        select() { return query },
        eq(column, value) { call.filters.push(['eq', column, value]); return query },
        in(column, values) { call.filters.push(['in', column, values]); return query },
        order() { return query },
        range(from, to) { call.range = [from, to]; return query },
        abortSignal(signal) { call.signal = signal; return query },
        then(resolve, reject) {
          let rows = [...(seed[table] || [])].filter((row) => call.filters.every(([operator, column, value]) => operator === 'in' ? value.includes(row[column]) : row[column] === value))
          if (call.range) rows = rows.slice(call.range[0], call.range[1] + 1)
          return Promise.resolve({ data: rows, error: null, status: 200 }).then(resolve, reject)
        },
      }
      return query
    },
    rpc(name, args) {
      const call = { type: 'rpc', name, args, signal: null }
      calls.push(call)
      const query = {
        abortSignal(signal) { call.signal = signal; return query },
        then(resolve, reject) { return Promise.resolve(rpcResult).then(resolve, reject) },
      }
      return query
    },
  }
}

const requestId = '11111111-1111-4111-8111-111111111111'
const input = {
  organizationId: 'org-a', requestId, name: 'Internal platform', description: 'Build the operating layer', ownerId: 'owner-a',
  startDate: '2026-09-04', dueDate: '2026-10-04', scope: 'Internal delivery', exclusions: 'No client work',
  workstreams: [{ departmentId: 'marketing', ownerId: 'owner-m' }, { departmentId: 'content', ownerId: 'owner-c' }],
}

test('P3 normalizes exact Internal Work inputs and rejects empty, duplicate, or unsupported workstreams', async () => {
  const module = await setupModule(fakeClient())
  const normalized = module.normalizeInternalProjectSetup(input)
  assert.deepEqual(normalized.workstreams, [
    { department_id: 'content', owner_id: 'owner-c' },
    { department_id: 'marketing', owner_id: 'owner-m' },
  ])
  await assert.rejects(async () => module.normalizeInternalProjectSetup({ ...input, workstreams: [] }), /Select at least one/)
  await assert.rejects(async () => module.normalizeInternalProjectSetup({ ...input, workstreams: [input.workstreams[0], input.workstreams[0]] }), /Duplicate/)
  await assert.rejects(async () => module.normalizeInternalProjectSetup({ ...input, workstreams: [{ departmentId: 'sales', ownerId: 'owner-a' }] }), /Unsupported/)
})

test('P3 loads only active team members and canonical departments from the active organization', async () => {
  const memberships = Array.from({ length: 501 }, (_, index) => ({ organization_id: 'org-a', user_id: `member-${String(index).padStart(3, '0')}`, role: 'contributor', department_id: 'content', member_kind: 'team', status: 'active' }))
  const profiles = memberships.map((row) => ({ id: row.user_id, full_name: row.user_id }))
  const client = fakeClient({ memberships, organization_memberships: memberships, profiles, departments: [{ id: 'content', organization_id: 'org-a', name: 'Content' }] })
  const signal = new AbortController().signal
  const options = await (await setupModule(client)).createInternalProjectSetupRepository(client).getOptions('org-a', { signal })
  assert.equal(options.members.length, 501)
  assert.deepEqual(options.departments.map((row) => row.id), ['content'])
  assert.equal(client.calls.filter((call) => call.table === 'organization_memberships').length, 2)
  assert.equal(client.calls.filter((call) => call.type === 'from').every((call) => call.signal === signal), true)
  for (const call of client.calls.filter((row) => ['organization_memberships', 'departments'].includes(row.table))) {
    assert.ok(call.filters.some(([operator, column, value]) => operator === 'eq' && column === 'organization_id' && value === 'org-a'))
  }
  assert.deepEqual(client.calls.find((call) => call.table === 'profiles').filters, [['in', 'id', memberships.map((row) => row.user_id).sort()]])
})

test('P3 setup invokes only the authenticated atomic RPC with exact normalized arguments and cancellation', async () => {
  const result = { project_id: 'project-a', workstreams: [{ id: 'stream-a', department_id: 'content', owner_id: 'owner-c' }], idempotent_replay: false }
  const client = fakeClient({}, { data: result, error: null, status: 200 })
  const signal = new AbortController().signal
  const repository = (await setupModule(client)).createInternalProjectSetupRepository(client)
  assert.deepEqual(await repository.create(input, { signal }), result)
  const call = client.calls.find((row) => row.type === 'rpc')
  assert.equal(call.name, 'create_internal_project_setup')
  assert.equal(call.signal, signal)
  assert.deepEqual(call.args, {
    p_organization_id: 'org-a', p_request_id: requestId, p_name: 'Internal platform', p_description: 'Build the operating layer',
    p_owner_id: 'owner-a', p_start_date: '2026-09-04', p_due_date: '2026-10-04', p_scope_statement: 'Internal delivery',
    p_exclusions: 'No client work', p_workstreams: [{ department_id: 'content', owner_id: 'owner-c' }, { department_id: 'marketing', owner_id: 'owner-m' }],
  })
  assert.equal(client.calls.some((row) => row.type === 'from'), false)
})

test('P3 setup preserves denied, stale, and malformed-result states', async () => {
  for (const [code, expectedStatus] of [['42501', 403], ['40001', 409]]) {
    const client = fakeClient({}, { data: null, error: { code, message: 'Rejected' }, status: 400 })
    const repository = (await setupModule(client)).createInternalProjectSetupRepository(client)
    await assert.rejects(repository.create(input), (error) => error.status === expectedStatus && error.code === code)
  }
  const malformed = fakeClient({}, { data: { project_id: 'project-a' }, error: null, status: 200 })
  await assert.rejects((await setupModule(malformed)).createInternalProjectSetupRepository(malformed).create(input), (error) => error.status === 409)
})

test('P3 SQL contract is invoker-only, exact-replay atomic, tenant-scoped, and creates no external delivery graph', () => {
  const migration = readFileSync(new URL('../../supabase/migrations/20260904003651_p3_internal_project_setup.sql', import.meta.url), 'utf8')
  const verifier = readFileSync(new URL('../../supabase/verify_20260904003651_p3_internal_project_setup.sql', import.meta.url), 'utf8')
  const screen = readFileSync(new URL('../apps/InternalProjectSetupPanel.jsx', import.meta.url), 'utf8')
  const internalDirectory = readFileSync(new URL('../apps/InternalWorkspace.jsx', import.meta.url), 'utf8')
  const operatingSpine = readFileSync(new URL('./operatingSpineRepository.js', import.meta.url), 'utf8')
  assert.match(migration, /language plpgsql[\s\S]*security invoker[\s\S]*set search_path = ''/)
  assert.match(migration, /pg_advisory_xact_lock[\s\S]*normalized_payload_sha256[\s\S]*idempotent_replay/)
  assert.match(migration, /member_kind = 'team'[\s\S]*membership\.status = 'active'/)
  assert.match(migration, /department\.organization_id = p_organization_id/)
  assert.match(migration, /membership\.department_id = v_department_ids\[v_position\]/)
  assert.match(migration, /revoke all on function public\.create_internal_project_setup[\s\S]*from public, anon, authenticated, service_role;[\s\S]*grant execute[\s\S]*to authenticated;/)
  assert.doesNotMatch(migration, /security definer/)
  assert.doesNotMatch(migration, /insert into public\.(engagements|engagement_services|milestones|recurring_plans)/)
  for (const evidence of ['atomic_rollback_on_workstream_failure', 'exact_replay_no_duplicates', 'conflicting_request_rejected', 'inactive_team_denied', 'foreign_owner_denied', 'department_owner_mismatch_denied', 'empty_workstreams_rejected']) assert.match(verifier, new RegExp(evidence))
  assert.match(screen, /one internal project and \{selected\.length\} selected workstream/)
  assert.match(screen, /no client, engagement, services, milestones, or schedule/)
  assert.match(internalDirectory, /New Internal Work/)
  assert.match(operatingSpine, /rpc\('compose_engagement'/)
  assert.doesNotMatch(operatingSpine, /create_internal_project_setup/)
})
