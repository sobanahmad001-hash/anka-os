import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
const source = readFileSync(new URL('./projectLifecycleRepository.js', import.meta.url), 'utf8')
  .replace("import { supabase } from '../lib/supabase.js'", 'const supabase = {}')
const { createProjectLifecycleRepository, isProjectLifecycleRollbackError } = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'))
const org = '11111111-1111-4111-8111-111111111111'
const project = '22222222-2222-4222-8222-222222222222'
const request = '33333333-3333-4333-8333-333333333333'
const previewId = '44444444-4444-4444-8444-444444444444'
const base = { organization_id: org, project_id: project }
const preview = { ...base, preview_id: previewId, project_name: 'Exact Name ', eligible: true,
  expires_at: '2026-09-30T12:00:00Z', dependencies: [{ schema: 'private', table: 'history', count: 0 }] }
const fake = data => createProjectLifecycleRepository({ rpc: async () => ({ data }) })

test('known lifecycle rollbacks allow a new request after direct or wrapped database errors', () => {
  for (const code of ['25001', '40001', '40P01', '42501', '23505', '22023', '23503', '55P03', '57014']) {
    assert.equal(isProjectLifecycleRollbackError({ code }), true, code)
    assert.equal(isProjectLifecycleRollbackError(new Error('Rejected', { cause: { code } })), true, code)
  }
})

test('ambiguous lifecycle failures retain the same request identity', () => {
  for (const code of ['40003', '08006', '08007', 'ECONNRESET', 'ETIMEDOUT', 'XX000', '40XYZ', '22XYZ', '57P01', '', undefined, null, 40001]) {
    assert.equal(isProjectLifecycleRollbackError({ code }), false, String(code))
    assert.equal(isProjectLifecycleRollbackError({ cause: { code } }), false, String(code))
  }
  for (const error of [undefined, null, {}, new TypeError('Failed to fetch'), new Error('Unknown outcome')]) {
    assert.equal(isProjectLifecycleRollbackError(error), false)
  }
  assert.equal(isProjectLifecycleRollbackError({ cause: { code: '40003' }, code: '40001' }), false)
  assert.equal(isProjectLifecycleRollbackError({ cause: {}, code: '25001' }), true)
})

test('archive and restore send explicit state and verify matching receipts', async () => {
  const calls = []
  const repo = createProjectLifecycleRepository({ rpc: async (name, args) => {
    calls.push({ name, args })
    return { data: { ...base, request_id: request, status: 'planning', archived_at: args.p_archived ? '2026-09-30T12:00:00Z' : null } }
  } })
  for (const archived of [true, false]) await repo.setArchived({ organizationId: org, projectId: project, archived, requestId: request })
  assert.deepEqual(calls.map(c => c.args.p_archived), [true, false])
  assert.equal(calls[0].name, 'set_project_archived')
  assert.equal(calls[0].args.p_request_id, request)
  await assert.rejects(fake({ ...base, request_id: request, status: 'planning', archived_at: null }).setArchived({ organizationId: org, projectId: project, archived: true, requestId: request }), /scope/)
  await assert.rejects(fake({ ...base, organization_id: project }).preview(org, project), /scope/)
})

test('preview rejects malformed and contradictory dependency counts', async () => {
  assert.deepEqual(await fake(preview).preview(org, project), preview)
  for (const count of [-1, '0', 1, null]) {
    await assert.rejects(fake({ ...preview, dependencies: [{ schema: 'private', table: 'history', count }] }).preview(org, project), /scope/)
  }
  const blocked = { ...preview, eligible: false, preview_id: null, expires_at: null,
    dependencies: [{ schema: 'private', table: 'history', count: 3 }] }
  assert.equal((await fake(blocked).preview(org, project)).eligible, false)
})

test('dependency identifiers accept arbitrary catalog schemas and validate quoted PostgreSQL names', async () => {
  for (const schema of ['audit', 'retained_history', 'Mixed Case', 'a.b', '履歴', 'a'.repeat(63)]) {
    const data = { ...preview, dependencies: [{ schema, table: 'History.Table', count: 0 }] }
    assert.deepEqual(await fake(data).preview(org, project), data)
  }
  for (const field of ['schema', 'table']) {
    for (const name of ['', null, 42, 'bad\0name', 'a'.repeat(64), '履'.repeat(22)]) {
      const data = { ...preview, dependencies: [{ schema: 'audit', table: 'history', count: 0, [field]: name }] }
      await assert.rejects(fake(data).preview(org, project), /scope/)
    }
  }
})

test('delete requires exact untrimmed name and scope before any RPC; retries retain all inputs', async () => {
  const calls = []
  const repo = createProjectLifecycleRepository({ rpc: async (name, args) => {
    calls.push({ name, args })
    return { data: { ...base, request_id: request, deleted: true, replayed: calls.length > 1 } }
  } })
  const input = { organizationId: org, projectId: project, preview, confirmation: preview.project_name, requestId: request }
  for (const bad of [{ confirmation: 'Exact Name' }, { preview: { ...preview, eligible: false } }, { projectId: org }, { requestId: 'bad' }]) {
    await assert.rejects(repo.deleteEmpty({ ...input, ...bad }), /preview and exact/)
  }
  assert.equal(calls.length, 0)
  await repo.deleteEmpty(input)
  assert.equal((await repo.deleteEmpty(input)).replayed, true)
  assert.deepEqual(calls[0], calls[1])
  assert.deepEqual(calls[0].args, { p_organization_id: org, p_project_id: project,
    p_preview_id: previewId, p_confirmation: 'Exact Name ', p_request_id: request })
  await assert.rejects(fake({ ...base, request_id: org, deleted: true }).deleteEmpty(input), /scope/)
})

test('admin lists reject wrong filter rows and propagate authorization failures', async () => {
  const row = { id: project, name: 'Project', status: 'planning', archived_at: null }
  assert.deepEqual(await fake({ organization_id: org, projects: [row] }).list(org, false), [row])
  await assert.rejects(fake({ organization_id: org, projects: [row] }).list(org, true), /scope/)
  const repo = createProjectLifecycleRepository({ rpc: async () => ({ error: { code: '42501', message: 'Admin required' } }) })
  await assert.rejects(repo.preview(org, project), error => error.status === 403 && error.cause.code === '42501')
})

test('aborted reads never reach the server', async () => {
  const controller = new AbortController(); controller.abort()
  let called = false
  const repo = createProjectLifecycleRepository({ rpc: () => { called = true } })
  await assert.rejects(repo.list(org, true, { signal: controller.signal }), { name: 'AbortError' })
  assert.equal(called, false)
})
