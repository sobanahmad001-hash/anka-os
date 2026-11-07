import test from 'node:test'
import assert from 'node:assert/strict'
import { createProjectChatSharedContextRepository } from './projectChatSharedContextRepository.js'
const id = n => `dd000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const scope = { organization_id: id(1), project_id: id(2), engagement_id: id(3) }
function fixture() {
  const setup = { organization_id: scope.organization_id, project_id: scope.project_id, token: 'a'.repeat(32), leaves: [], catalog: [], scopes: [], state: null, can_manage: true }
  const header = { ...scope, state: 'available', plan_id: id(4), plan_version: 1, can_manage: true, groups: [{ id: id(5), kind: 'website', publication_id: id(6), configuration_id: id(22), configuration_current: true, steps: [{ key: 'copy' }] }], bindings: [{ group_id: id(5), publication_id: id(6), step_key: 'copy', phase: 'website.content' }] }
  const item = { instance: 1, work_item_id: id(7), work_required: true, work_done: true, work_status: 'done', output: { artifact_id: id(8), artifact_version_id: id(9), version_number: 1, artifact_type: 'content', approval_id: id(10), content_checksum: 'b'.repeat(64) }, output_approved: true, material_current: true, needs_update: false, dependency_blocked: false, missing_work: false }
  const partition = { ...scope, plan_id: id(4), group_id: id(5), partition: { kind: 'website_page', id: id(11), architecture_version_id: id(12) }, state: 'current', context_sha256: 'c'.repeat(64), page: { initial_path: 'home' }, steps: [{ key: 'copy', label: 'Page copy', phase: 'website.content', action: 'run', items: [item] }] }
  return { setup, header, partition, item, project: { id: scope.project_id, organization_id: scope.organization_id, name: 'Authorized Project', status: 'active', archived_at: null }, engagements: [{ id: scope.engagement_id, organization_id: scope.organization_id, project_id: scope.project_id, name: 'Website engagement', status: 'active' }] }
}
function client(f, denied = false) {
  const calls = []
  const reads = []
  return { calls, reads, from(table) {
    const entry = { table, filters: [] }; reads.push(entry)
    const q = { select(fields) { entry.fields = fields; return q }, eq(k, v) { entry.filters.push([k, v]); return q }, is(k, v) { entry.filters.push([k, v]); return q }, order() { return q }, limit(n) { entry.limit = n; return q }, abortSignal() { return q }, maybeSingle() { return q }, then(resolve, reject) { return Promise.resolve(denied ? { error: { code: '42501', message: 'private-diagnostic' } } : { data: structuredClone(table === 'projects' ? f.project : f.engagements) }).then(resolve, reject) } }; return q
  }, rpc(name, args) { calls.push({ name, args }); return Promise.resolve(denied ? { error: { code: '42501', message: 'private-diagnostic' } } : { data: name === 'get_project_setup' ? structuredClone(f.setup) : name === 'read_project_stage_plan' ? structuredClone(f.header) : structuredClone(f.partition) }) } }
}
const selected = f => ({ planId: f.header.plan_id, groupId: f.partition.group_id, partition: f.partition.partition })
const phase = result => result.execution.stages.find(s => s.phase === 'website.content')
test('a new project chat reports missing setup and unloaded execution truthfully without conversation reads', async () => {
  const f = fixture(); f.header = { ...f.header, state: 'unconfigured', plan_id: null, groups: [], bindings: [] }
  const api = client(f), repo = createProjectChatSharedContextRepository(api)
  const result = await repo.load({ ...scope, engagement_id: null })
  assert.equal(result.project.name, 'Authorized Project'); assert.equal(result.engagement_connection.resolved_engagement_id, scope.engagement_id)
  assert.equal(result.decisions.state, 'not_configured'); assert.equal(result.execution.coverage, 'configuration_only'); assert.equal(result.execution.state, 'unconfigured')
  assert.ok(result.execution.stages.every(s => s.status === null && s.progress === null && s.configured === false))
  assert.equal(result.private_conversation_history_included, false); assert.equal(result.changes_require_explicit_review, true)
  assert.deepEqual(Object.keys(repo), ['load'])
  assert.deepEqual(api.calls[0], { name: 'get_project_setup', args: { p_organization_id: scope.organization_id, p_project_id: scope.project_id } })
  assert.equal(api.calls[1].name, 'read_project_stage_plan')
  assert.deepEqual(api.reads[0].filters, [['organization_id', scope.organization_id], ['id', scope.project_id], ['archived_at', null]])
  assert.deepEqual(api.reads[1].filters, [['organization_id', scope.organization_id], ['project_id', scope.project_id]])
})
test('two chats share only saved canonical decisions; later reads refresh without sharing private history', async () => {
  const f = fixture(), api = client(f), chatA = createProjectChatSharedContextRepository(api), chatB = createProjectChatSharedContextRepository(api)
  f.setup.state = { revision: 1, plan: { pipelines: ['website'], private_conversation_text: 'PRIVATE_HISTORY_SENTINEL', questions: ['private brainstorm'] } }
  const a = await chatA.load(scope), b = await chatB.load(scope)
  assert.deepEqual(a, b); assert.equal(a.decisions.state, 'saved_decisions'); assert.equal(phase(a).status, null)
  assert.equal(phase(a).progress, null); assert.equal(a.execution.coverage, 'configuration_only')
  assert.doesNotMatch(JSON.stringify(a), /PRIVATE_HISTORY|brainstorm/)
  f.setup.state.revision = 2; f.setup.state.plan.pipelines.push('marketing')
  assert.deepEqual((await chatB.load(scope)).decisions.pipelines, ['website', 'marketing'])
  assert.deepEqual(a.decisions.pipelines, ['website']); assert.ok(Object.isFrozen(a.decisions.pipelines))
  assert.ok(api.calls.every(c => ['get_project_setup', 'read_project_stage_plan'].includes(c.name)))
})
test('saved service lifecycle completed never manufactures Work completion', async () => {
  const f = fixture(); f.setup.scopes = [{ id: id(20), service_id: id(21), revision: 2, quantity: 10, status: 'completed', private_notes: 'PRIVATE_SCOPE_NOTE' }]
  const result = await createProjectChatSharedContextRepository(client(f)).load(scope)
  assert.equal(result.decisions.state, 'existing_service_scope'); assert.equal(result.decisions.services[0].status, 'completed')
  assert.equal(result.decisions.provenance.execution_completion_inferred, false); assert.equal(phase(result).status, null)
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE_SCOPE_NOTE/)
})
test('exact loaded canonical Work and approval evidence is partition-only; missing approval is not done', async () => {
  const f = fixture(), repo = createProjectChatSharedContextRepository(client(f))
  const done = await repo.load(scope, { stageSelection: selected(f) })
  assert.equal(phase(done).status, 'done'); assert.equal(phase(done).progress.completed, 1)
  assert.equal(done.execution.whole_project_completion_known, false); assert.match(phase(done).scope_label, /not a whole-project total/)
  f.item.output_approved = false
  const review = await repo.load(scope, { stageSelection: selected(f) })
  assert.equal(phase(review).status, 'in_review'); assert.equal(phase(review).progress.completed, 0)
})
test('recorded foundation intent is shared but does not assert current approval', async () => {
  const f = fixture(); f.setup.state = { revision: 1, plan: { pipelines: ['branding'], foundation: { intent: { version: 1, engagement_id: scope.engagement_id, written: { mode: 'minimum', guidance: 'Reviewed limited guidance', reason: 'Limited scope' }, visual: null } } } }
  const result = await createProjectChatSharedContextRepository(client(f)).load(scope)
  assert.equal(result.decisions.foundation.status, 'recorded_intent'); assert.equal(result.decisions.foundation.current_approval_verified, false)
  assert.equal(phase(result).status, null)
})
test('denied scope remains denied for both chats without exposing diagnostics or empty success', async () => {
  const api = client(fixture(), true)
  for (const repo of [createProjectChatSharedContextRepository(api), createProjectChatSharedContextRepository(api)]) await assert.rejects(repo.load(scope), e => e.status === 403 && e.code === '42501' && !e.message.includes('private-diagnostic'))
  assert.equal(api.calls.length, 0); assert.equal(api.reads.length, 2)
})
test('foreign setup, foreign stage and malformed saved decisions fail closed', async () => {
  for (const mutate of [f => f.setup.project_id = id(99), f => f.header.engagement_id = id(99), f => f.setup.state = { revision: 1, plan: { pipelines: ['invented'] } }, f => f.setup.state = undefined]) {
    const f = fixture(); mutate(f)
    await assert.rejects(createProjectChatSharedContextRepository(client(f)).load(scope))
  }
})
test('scope cannot include a private conversation and cancellation prevents reads or late completion', async () => {
  const api = client(fixture()), repo = createProjectChatSharedContextRepository(api)
  await assert.rejects(repo.load({ ...scope, conversation_id: id(30) }))
  await assert.rejects(repo.load(scope, { signal: AbortSignal.abort() }))
  assert.equal(api.calls.length, 0)
  const controller = new AbortController(), f = fixture()
  const lateClient = client(f); lateClient.rpc = async () => { controller.abort(); return { data: f.setup } }
  const late = createProjectChatSharedContextRepository(lateClient)
  await assert.rejects(late.load(scope, { signal: controller.signal }))
})
test('unavailable and foreign project or engagement never become empty unconfigured success', async () => {
  for (const mutate of [f => f.project = null, f => f.project.organization_id = id(99), f => f.project.id = id(99), f => f.project.archived_at = '2026-01-01', f => f.engagements[0].project_id = id(99), f => f.engagements[0].organization_id = id(99)]) {
    const f = fixture(); mutate(f)
    await assert.rejects(createProjectChatSharedContextRepository(client(f)).load(scope))
  }
})
test('planning is connected and readable; completed engagement remains connected but not stage eligible', async () => {
  for (const status of ['planning', 'completed']) {
    const f = fixture(); f.engagements[0].status = status
    const api = client(f), result = await createProjectChatSharedContextRepository(api).load({ ...scope, engagement_id: null })
    assert.equal(result.engagement_connection.state, 'connected'); assert.equal(result.engagement_connection.stage_read_eligible, status === 'planning')
    assert.equal(api.calls.some(c => c.name === 'read_project_stage_plan'), status === 'planning')
    if (status === 'completed') assert.equal(result.execution.state, 'stage_read_unavailable')
  }
})
test('saved SQL-shaped group configuration false or null suppresses stale completion and counts', async () => {
  for (const current of [false, null]) {
    const f = fixture(); f.header.groups[0].configuration_current = current
    const result = await createProjectChatSharedContextRepository(client(f)).load(scope, { stageSelection: selected(f) })
    assert.equal(phase(result).configuration_current, false); assert.equal(phase(result).configured, false)
    assert.equal(phase(result).status, 'blocked'); assert.equal(phase(result).progress, null)
  }
})
test('fresh unscoped chat distinguishes no connection and multiple connections without choosing latest', async () => {
  for (const multiple of [false, true]) {
    const f = fixture(); f.engagements = multiple ? [f.engagements[0], { ...f.engagements[0], id: id(40) }] : []
    const api = client(f), result = await createProjectChatSharedContextRepository(api).load({ ...scope, engagement_id: null })
    assert.equal(result.engagement_connection.state, multiple ? 'selection_required' : 'not_connected')
    assert.equal(result.execution.coverage, 'not_loaded'); assert.equal(result.execution.whole_project_completion_known, false)
    assert.equal(api.calls.length, 1)
  }
})
