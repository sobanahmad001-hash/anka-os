import test from 'node:test'
import assert from 'node:assert/strict'
import { createProjectChatActionRepository, prepareProjectChatContentAction } from './projectChatActionRepository.js'
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const identity = { organizationId: id(1), projectId: id(2), conversationId: id(3), sourceMessageId: id(4), requestId: id(5) }
const save = () => ({ version: 1, kind: 'save_content', engagement_id: id(6), selection: null, source_work: { id: id(7), row_version: 3 }, active_service_id: id(8), artifact_id: null, expected_parent_version_id: null,
  content: { schema_version: 2, output_type: 'website_page_copy', variant_number: 1, working_title: 'Homepage', body: '  Explicit reviewed body\nwith whitespace  ', source_architecture_version_id: id(9), target_page_key: 'home' }, change_summary: 'Reviewed edit', ai_use_allowed: false, data_classification: 'internal' })
const handoff = () => ({ version: 1, kind: 'handoff_design', engagement_id: id(6), selection: null, source_work: { id: id(7), row_version: 4 }, artifact_version_id: id(11), content_checksum: 'a'.repeat(64), approval_id: id(12), receiving_service_id: id(13), receiving_workstream_id: id(14), receiving_work: { id: id(15), row_version: 1 }, recipient_note: 'Design this exact version' })
const receipt = (kind = 'save_content') => ({ version: 1, request_id: id(5), organization_id: id(1), project_id: id(2), engagement_id: id(6), conversation_id: id(3), source_message_id: id(4), actor_id: id(16), selection: null, kind, status: kind === 'save_content' ? 'content_saved' : 'handoff_recorded', source_work: { id: id(7), row_version: 4 }, output: { artifact_id: id(10), artifact_version_id: id(11), version_number: 1, content_checksum: 'a'.repeat(64) }, handoff: kind === 'save_content' ? null : { request_id: id(5), approval_id: id(12), receiving_service_id: id(13), receiving_workstream_id: id(14), receiving_work_item_id: id(15) }, review_required: kind === 'save_content' })
const repo = answer => { const calls = []; return { calls, api: createProjectChatActionRepository({ rpc: async (name, args) => { calls.push({ name, args }); return answer(name, args) } }) } }
const stage = () => ({ version: 1, organization_id: id(1), project_id: id(2), engagement_id: id(6), plan_id: id(20), group_id: id(21), phase: 'website.content', partition: { kind: 'website_page', id: id(22), architecture_version_id: id(9) }, context_sha256: 'b'.repeat(64) })

test('prepare freezes exact reviewed body and identity with stable hash, without transport', async () => {
  const action = save(), before = structuredClone(action), proposal = await prepareProjectChatContentAction(identity, action)
  assert.deepEqual(action, before)
  assert.equal(proposal.action.content.body, before.content.body)
  assert.ok(Object.isFrozen(proposal.action.content))
  action.content.body = 'Later edit'
  assert.equal(proposal.action.content.body, before.content.body)
  const reordered = Object.fromEntries(Object.entries(before).reverse())
  assert.equal((await prepareProjectChatContentAction(identity, reordered)).sha256, proposal.sha256)
})
test('explicit confirm makes exactly one canonical atomic RPC and returns review-required output, no next dispatch', async () => {
  const r = repo(() => ({ data: receipt(), error: null })), proposal = await r.api.prepare(identity, save())
  const result = await r.api.confirm(proposal)
  assert.equal(result.status, 'content_saved'); assert.equal(result.review_required, true)
  assert.deepEqual(r.calls, [{ name: 'apply_project_chat_content_action', args: { p_organization_id: id(1), p_project_id: id(2), p_conversation_id: id(3), p_source_message_id: id(4), p_request_id: id(5), p_action: proposal.action } }])
  assert.equal('p_actor_id' in r.calls[0].args, false)
})
test('handoff keeps source Content Work and receiving Design Work distinct', async () => {
  const r = repo(() => ({ data: receipt('handoff_design'), error: null }))
  const result = await r.api.confirm(await r.api.prepare(identity, handoff()))
  assert.equal(result.handoff.receiving_work_item_id, id(15)); assert.equal(result.source_work.id, id(7))
  assert.equal(result.status, 'handoff_recorded'); assert.equal('completed' in result, false)
  const bad = handoff(); bad.receiving_work.id = bad.source_work.id
  await assert.rejects(r.api.prepare(identity, bad), /differ/)
})
test('save/create and handoff/create require explicit reviewed Work details', async () => {
  for (const action of [save(), handoff()]) {
    if (action.kind === 'save_content') action.source_work = { id: null, title: 'Content Work', description: 'Explicit brief' }
    else action.receiving_work = { id: null, title: 'Design Work', description: 'Explicit brief' }
    assert.ok(await prepareProjectChatContentAction(identity, action))
  }
  const a = handoff(); a.source_work = { id: null, title: 'Wrong', description: '' }
  await assert.rejects(prepareProjectChatContentAction(identity, a))
})
test('invalid stage selection never falls back; foreign project/page architecture and trusted extras reject', async () => {
  const selected = { version: 1, organization_id: id(1), project_id: id(2), engagement_id: id(6), plan_id: id(20), group_id: id(21), phase: 'website.content', partition: { kind: 'website_page', id: id(22), architecture_version_id: id(9) }, context_sha256: 'b'.repeat(64) }
  assert.ok(await prepareProjectChatContentAction(identity, { ...save(), selection: selected }))
  for (const selection of [undefined, {}, { ...selected, project_id: id(30) }, { ...selected, approved: true }, { ...selected, partition: { ...selected.partition, architecture_version_id: id(31) } }]) {
    await assert.rejects(prepareProjectChatContentAction(identity, { ...save(), selection }))
  }
  await assert.rejects(prepareProjectChatContentAction(identity, { ...save(), actor_id: id(16) }))
})

test('selected-stage source creation preserves explicit slot/dependencies; never creates prerequisites or receiver slots', async () => {
  const a = save()
  a.selection = { version: 1, organization_id: id(1), project_id: id(2), engagement_id: id(6), plan_id: id(20), group_id: id(21), phase: 'website.content', partition: { kind: 'website_page', id: id(22), architecture_version_id: id(9) }, context_sha256: 'b'.repeat(64) }
  a.source_work = { id: null, title: 'Homepage copy', description: 'Explicit slot', stage_slot: { step_key: 'copy', instance: 2, dependencies: [{ step_key: 'brief', instance: 1 }] } }
  const p = await prepareProjectChatContentAction(identity, a)
  assert.deepEqual(p.action.source_work.stage_slot, a.source_work.stage_slot)
  assert.ok(Object.isFrozen(p.action.source_work.stage_slot.dependencies))
  await assert.rejects(prepareProjectChatContentAction(identity, { ...a, selection: null }))
  const duplicate = structuredClone(a); duplicate.source_work.stage_slot.dependencies.push({ step_key: 'brief', instance: 1 })
  await assert.rejects(prepareProjectChatContentAction(identity, duplicate))
  const receiver = handoff(); receiver.receiving_work = a.source_work
  await assert.rejects(prepareProjectChatContentAction(identity, receiver))
  const unique = structuredClone(a); delete unique.source_work.stage_slot
  assert.ok(await prepareProjectChatContentAction(identity, unique))
})
test('tampered proposal hash rejects before RPC', async () => {
  const r = repo(() => { throw Error('must not dispatch') }), p = structuredClone(await r.api.prepare(identity, save()))
  p.action.content.body = 'Changed after review'
  await assert.rejects(r.api.confirm(p), /changed/)
  assert.equal(r.calls.length, 0)
})
test('uncertain dispatch retains immutable original proposal and never retries', async () => {
  const r = repo(() => { throw Error('response lost') }), p = await r.api.prepare(identity, save())
  await assert.rejects(r.api.confirm(p), error => { assert.equal(error.outcome, 'unknown'); assert.deepEqual(error.proposal, p); assert.ok(Object.isFrozen(error.proposal)); return true })
  assert.equal(r.calls.length, 1)
})
test('known backend stale/revoked validation surfaces without retry or draft changes', async () => {
  for (const code of ['40001', '42501', '55000']) {
    const r = repo(() => ({ data: null, error: { code, message: 'canonical denial' } })), p = await r.api.prepare(identity, save())
    await assert.rejects(r.api.confirm(p), e => e.code === code && e.knownRollback === true && e.proposal.sha256 === p.sha256)
    assert.equal(r.calls.length, 1)
  }
})
test('malformed/foreign success receipt becomes unknown, never success or resend', async () => {
  for (const change of [r => r.project_id = id(30), r => r.conversation_id = id(30), r => r.source_message_id = id(30), r => r.request_id = id(30), r => r.output = null, r => r.status = 'completed', r => r.review_required = false]) {
    const bad = receipt(); change(bad)
    const r = repo(() => ({ data: bad, error: null }))
    await assert.rejects(r.api.confirm(await r.api.prepare(identity, save())), e => e.outcome === 'unknown')
    assert.equal(r.calls.length, 1)
  }
})
test('handoff rejects changed exact output/approval or destination receipt', async () => {
  for (const change of [r => r.output.artifact_version_id = id(30), r => r.output.content_checksum = 'c'.repeat(64), r => r.handoff.approval_id = id(30), r => r.handoff.receiving_service_id = id(30), r => r.handoff.receiving_work_item_id = r.source_work.id]) {
    const bad = receipt('handoff_design'); change(bad)
    const r = repo(() => ({ data: bad, error: null }))
    await assert.rejects(r.api.confirm(await r.api.prepare(identity, handoff())), e => e.outcome === 'unknown')
  }
})
test('original request recovery only reads; absence never authorizes submission', async () => {
  for (const data of [{ status: 'recorded', receipt: receipt() }, { status: 'not_recorded', must_not_submit: true }]) {
    const r = repo(() => ({ data, error: null }))
    assert.deepEqual(await r.api.recover(identity), data)
    assert.equal(r.calls[0].name, 'recover_project_chat_content_action'); assert.equal(r.calls.length, 1)
    assert.equal('p_action' in r.calls[0].args, false)
  }
  const r = repo(() => ({ data: { status: 'not_recorded', must_not_submit: false }, error: null }))
  await assert.rejects(r.api.recover(identity))
})
test('list validates original conversation and bounded exact canonical receipts', async () => {
  const scope = { organizationId: id(1), projectId: id(2), conversationId: id(3) }
  const r = repo(() => ({ data: { items: [receipt()], limit: 25, offset: 0, has_more: false }, error: null }))
  assert.equal((await r.api.list(scope)).items[0].output.artifact_version_id, id(11))
  assert.equal(r.calls[0].name, 'read_project_chat_content_actions')
  await assert.rejects(r.api.list(scope, { limit: 51 }))
  const bad = repo(() => ({ data: { items: [{ ...receipt(), conversation_id: id(30) }], limit: 25, offset: 0, has_more: false }, error: null }))
  await assert.rejects(bad.api.list(scope))
})

test('recovery/list read failures preserve errors and never invoke mutation', async () => {
  const failure = { code: '42501', message: 'current ownership revoked' }
  const r = repo(() => ({ data: null, error: failure }))
  await assert.rejects(r.api.recover(identity), e => e === failure)
  await assert.rejects(r.api.list({ organizationId: id(1), projectId: id(2), conversationId: id(3) }), e => e === failure)
  assert.deepEqual(r.calls.map(c => c.name), ['recover_project_chat_content_action', 'read_project_chat_content_actions'])
  await assert.rejects(r.api.recover({ ...identity, sourceMessageId: 'bad' }))
  assert.equal(r.calls.length, 2)
})

test('confirm requires exact immutable original selection, rejecting missing, changed or unrelated composer context', async () => {
  const original = stage(), a = { ...save(), selection: original }
  const good = repo(() => ({ data: { ...receipt(), selection: original }, error: null }))
  assert.deepEqual((await good.api.confirm(await good.api.prepare(identity, a))).selection, original)
  for (const change of [r => delete r.selection, r => r.selection = null, r => r.selection.phase = 'website.design',
    r => r.selection.partition.id = id(30), r => r.selection.context_sha256 = 'c'.repeat(64), r => r.selection.project_id = id(31)]) {
    const bad = { ...receipt(), selection: stage() }; change(bad)
    const r = repo(() => ({ data: bad, error: null }))
    await assert.rejects(r.api.confirm(await r.api.prepare(identity, a)), error => error.outcome === 'unknown')
  }
  const unexpected = repo(() => ({ data: { ...receipt(), selection: original }, error: null }))
  await assert.rejects(unexpected.api.confirm(await unexpected.api.prepare(identity, save())), error => error.outcome === 'unknown')
})

test('recovery and reload list retain historical original selection without substituting current composer or refreshing it', async () => {
  const original = stage(), retained = { ...receipt(), selection: original }
  const r = repo(name => ({ data: name === 'recover_project_chat_content_action'
    ? { status: 'recorded', receipt: retained } : { items: [retained], limit: 25, offset: 0, has_more: false }, error: null }))
  const recovered = await r.api.recover(identity)
  const listed = await r.api.list({ organizationId: id(1), projectId: id(2), conversationId: id(3) })
  assert.deepEqual(recovered.receipt.selection, original)
  assert.deepEqual(listed.items[0].selection, original)
  assert.ok(Object.isFrozen(listed.items[0].selection.partition))
  assert.deepEqual(r.calls.map(c => c.name), ['recover_project_chat_content_action', 'read_project_chat_content_actions'])
})

test('recovery/list reject missing, malformed and foreign selection while ordinary receipt explicitly retains null', async () => {
  const scope = { organizationId: id(1), projectId: id(2), conversationId: id(3) }
  for (const change of [r => delete r.selection, r => r.selection = {}, r => r.selection = { ...stage(), engagement_id: id(30) },
    r => r.selection = { ...stage(), organization_id: id(30) }, r => r.selection = { ...stage(), project_id: id(30) }]) {
    const bad = receipt(); change(bad)
    const r = repo(name => ({ data: name === 'recover_project_chat_content_action'
      ? { status: 'recorded', receipt: bad } : { items: [bad], limit: 25, offset: 0, has_more: false }, error: null }))
    await assert.rejects(r.api.recover(identity))
    await assert.rejects(r.api.list(scope))
  }
  const r = repo(name => ({ data: name === 'recover_project_chat_content_action'
    ? { status: 'recorded', receipt: receipt() } : { items: [receipt()], limit: 25, offset: 0, has_more: false }, error: null }))
  assert.equal((await r.api.recover(identity)).receipt.selection, null)
  assert.equal((await r.api.list(scope)).items[0].selection, null)
})
