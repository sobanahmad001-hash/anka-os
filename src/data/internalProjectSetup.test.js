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

test('P3 loads tenant-safe owner choices through the authenticated options RPC', async () => {
  const rpcOptions = {
    members: [
      { id: 'member-a', name: 'Member A', role: 'contributor', department_id: 'content' },
      { id: 'member-b', name: 'Member B', role: 'project_owner', department_id: 'design' },
    ],
    departments: [
      { id: 'content', organization_id: 'org-a', name: 'Content' },
      { id: 'design', organization_id: 'org-a', name: 'Design' },
    ],
  }
  const client = fakeClient({}, { data: rpcOptions, error: null, status: 200 })
  const signal = new AbortController().signal
  const options = await (await setupModule(client)).createInternalProjectSetupRepository(client).getOptions('org-a', { signal })
  assert.deepEqual(options.members, [
    { id: 'member-a', name: 'Member A', role: 'contributor', departmentId: 'content' },
    { id: 'member-b', name: 'Member B', role: 'project_owner', departmentId: 'design' },
  ])
  assert.deepEqual(options.departments.map((row) => row.id), ['content', 'design'])
  assert.equal(client.calls.some((call) => call.type === 'from'), false)
  assert.deepEqual(client.calls[0].args, { p_organization_id: 'org-a' })
  assert.equal(client.calls[0].name, 'get_internal_project_setup_options')
  assert.equal(client.calls[0].signal, signal)
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
  const concurrency = readFileSync(new URL('../../scripts/p3-internal-project-setup-concurrency.ts', import.meta.url), 'utf8')
  const organizationFoundation = readFileSync(new URL('../../supabase/migrations/20260825010000_organization_access_foundation.sql', import.meta.url), 'utf8')
  const canonicalDelivery = readFileSync(new URL('../../supabase/migrations/20260825040000_canonical_delivery_core.sql', import.meta.url), 'utf8')
  const screen = readFileSync(new URL('../apps/InternalProjectSetupPanel.jsx', import.meta.url), 'utf8')
  const internalDirectory = readFileSync(new URL('../apps/InternalWorkspace.jsx', import.meta.url), 'utf8')
  const operatingSpine = readFileSync(new URL('./operatingSpineRepository.js', import.meta.url), 'utf8')
  const createRpcDefinition = migration.slice(
    migration.indexOf('create function public.create_internal_project_setup'),
    migration.indexOf('revoke all on function public.create_internal_project_setup'),
  )
  assert.match(migration, /language plpgsql[\s\S]*security invoker[\s\S]*set search_path = ''/)
  assert.match(migration, /pg_advisory_xact_lock[\s\S]*normalized_payload_sha256[\s\S]*idempotent_replay/)
  assert.match(migration, /member_kind = 'team'[\s\S]*membership\.status = 'active'/)
  assert.match(migration, /department\.organization_id = p_organization_id/)
  assert.match(migration, /membership\.department_id = p_department_id/)
  assert.match(migration, /create index internal_project_setup_requests_requested_by_idx[\s\S]*\(requested_by\)/)
  assert.match(migration, /create function private\.can_select_internal_project_owner[\s\S]*security definer[\s\S]*public\.is_team_organization_member/)
  assert.match(migration, /create function public\.get_internal_project_setup_options\(p_organization_id uuid\)[\s\S]*security definer[\s\S]*membership\.member_kind = 'team'[\s\S]*membership\.status = 'active'/)
  assert.match(migration, /private\.can_select_internal_project_owner\(p_organization_id, p_owner_id, null\)/)
  assert.match(canonicalDelivery, /create policy "Team can create projects"[\s\S]*with check \(public\.is_team_organization_member\(organization_id\)\)/)
  assert.match(organizationFoundation, /create policy "Members can read permitted memberships"[\s\S]*user_id = auth\.uid\(\)[\s\S]*array\['system_owner', 'operations_admin', 'executive', 'department_manager'\]/)
  assert.match(migration, /revoke all on function public\.create_internal_project_setup[\s\S]*from public, anon, authenticated, service_role;[\s\S]*grant execute[\s\S]*to authenticated;/)
  assert.doesNotMatch(createRpcDefinition, /security definer/)
  assert.doesNotMatch(migration, /insert into public\.(engagements|engagement_services|milestones|recurring_plans)/)
  assert.match(verifier, /errcode = 'P3001',[\s\S]*message = 'P3 forced workstream failure\.'/)
  assert.match(verifier, /when sqlstate 'P3001' then[\s\S]*sqlerrm <> 'P3 forced workstream failure\.'[\s\S]*when others then\s*raise;/)
  assert.doesNotMatch(verifier, /exception when others then\s*if sqlerrm/)
  for (const evidence of [
    'exact_create_rpc_catalog', 'exact_create_rpc_acl', 'exact_owner_directory_catalog',
    'exact_owner_directory_acl', 'exact_ledger_rls_and_policies', 'exact_ledger_acl',
    'exact_ledger_columns', 'exact_ledger_constraints', 'exact_ledger_indexes',
    'forced_failure_exact_sqlstate_and_message', 'atomic_rollback_on_workstream_failure',
    'authorized_owner_directory_runtime', 'exact_replay_no_duplicates', 'exact_internal_project_row',
    'exact_selected_workstream_rows', 'no_external_or_default_rows', 'conflicting_request_rejected',
    'inactive_team_denied', 'foreign_owner_denied', 'department_owner_mismatch_denied',
    'empty_workstreams_rejected',
  ]) assert.match(verifier, new RegExp(evidence))
  assert.match(verifier, /public\.recurring_work_plans[\s\S]*public\.recurring_work_occurrences[\s\S]*public\.recurring_schedule_admissions[\s\S]*public\.recurring_schedule_executions/)
  assert.match(concurrency, /P3_LOCAL_TEMPLATE_URL/)
  assert.match(concurrency, /\['localhost', '127\.0\.0\.1', '\[::1\]'\]/)
  assert.match(concurrency, /Template database must be named p3_template_\*/)
  assert.match(concurrency, /Promise\.all\([\s\S]*invoke\(first[\s\S]*invoke\(second/)
  assert.match(concurrency, /Promise\.allSettled\([\s\S]*invoke\(first[\s\S]*invoke\(second/)
  assert.match(concurrency, /conflictError\.code, '22023'/)
  assert.match(concurrency, /DROP DATABASE/)
  assert.match(screen, /one internal project and \{selected\.length\} selected workstream/)
  assert.match(screen, /no client, engagement, services, milestones, or schedule/)
  assert.match(internalDirectory, /New Internal Work/)
  assert.match(operatingSpine, /rpc\('compose_engagement'/)
  assert.doesNotMatch(operatingSpine, /create_internal_project_setup/)
})
