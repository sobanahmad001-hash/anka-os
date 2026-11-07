import test from 'node:test'
import assert from 'node:assert/strict'
import { createProjectPositioningOutputRepository } from './projectPositioningOutputRepository.js'
const id = n => `ee000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const scope = { organization_id: id(1), project_id: id(2), engagement_id: id(3), actor_id: id(4), conversation_id: id(5) }
function fixture() {
  const output = { version_id: id(9), version_number: 1, wording_sha256: 'a'.repeat(64), binding_id: id(6), conversation_id: scope.conversation_id }
  const source = { id: id(7), organization_id: scope.organization_id, conversation_id: scope.conversation_id, status: 'completed', role: 'assistant', sequence: 2, body: 'Unselected beginning. Exact chosen positioning. Unselected tail.' }
  const approval = { id: id(8), organization_id: scope.organization_id, conversation_id: scope.conversation_id, status: 'completed', role: 'user', author_id: scope.actor_id, sequence: 3, body: 'A saved message; approval is explicit in review, never parsed.' }
  const data = { organization_id: scope.organization_id, project_id: scope.project_id, engagement_id: scope.engagement_id, actor_id: scope.actor_id, binding_id: id(6), current: null, selected: null }
  const calls = [], state = { unknown: false, missing: false }, client = { rpc(name, args) { calls.push({ name, args }); if (name === 'save_project_positioning_output') { if (state.unknown) return Promise.reject(Error('Lost response')); return Promise.resolve({ data: output }) } if (name === 'recover_project_positioning_output') return Promise.resolve({ data: state.missing ? null : output }); return Promise.resolve({ data: args.p_version_id ? { ...data, selected: { ...output, wording: 'Exact chosen positioning.' } } : data }) } }
  return { source, approval, output, data, calls, state, repo: createProjectPositioningOutputRepository(client) }
}
test('explicit saved wording and selected owner approval produce exact save with no raw approval text', async () => {
  const f = fixture(), reviewed = await f.repo.review(scope)
  const p = await f.repo.prepare(scope, f.source, f.approval, 'Exact chosen positioning.', reviewed, f.output.version_id, true)
  assert.equal(f.calls.length, 1); assert.ok(Object.isFrozen(p.scope)); assert.equal(Object.hasOwn(p, 'approval_text'), false)
  assert.deepEqual(await f.repo.confirm(p), f.output)
  assert.deepEqual(f.calls[1], { name: 'save_project_positioning_output', args: { p_organization_id: scope.organization_id, p_project_id: scope.project_id, p_engagement_id: scope.engagement_id, p_conversation_id: scope.conversation_id, p_source_message_id: f.source.id, p_approval_message_id: f.approval.id, p_wording: 'Exact chosen positioning.', p_binding_id: f.data.binding_id, p_expected_version_id: null, p_request_id: f.output.version_id, p_attested: true } })
})
test('wording saying approved never supplies attestation; approval must be completed owner message in same conversation', async () => {
  const f = fixture(), reviewed = await f.repo.review(scope)
  await assert.rejects(f.repo.prepare(scope, {...f.source,body:'Approved. Exact chosen positioning.'}, f.approval, 'Exact chosen positioning.', reviewed, id(9), false), /explicitly attest/)
  for (const change of [{ author_id: id(99) }, { role: 'assistant' }, { sequence: 1 }, { conversation_id: id(99) }, { status: 'pending' }]) await assert.rejects(f.repo.prepare(scope, f.source, { ...f.approval, ...change }, 'Exact chosen positioning.', reviewed, id(9), true))
  await assert.rejects(f.repo.prepare(scope, f.source, f.approval, 'Edited or fabricated positioning', reviewed, id(9), true), /exact wording/)
  assert.equal(f.calls.length, 1)
  const ownerWording = await f.repo.prepare(scope, f.approval, f.approval, 'A saved message', reviewed, id(9), true)
  assert.equal(ownerWording.source_message_id, ownerWording.approval_message_id)
})
test('history scope comes from the exact owned project conversation and rejects conflicting row fields', async () => {
  const f = fixture(), reviewed = await f.repo.review(scope)
  const parent = { id: scope.conversation_id, organization_id: scope.organization_id, project_id: scope.project_id, owner_id: scope.actor_id, context_kind: 'project_team' }
  const { organization_id, ...row } = f.approval
  const prepare = (source, approval, conversation) => f.repo.prepare(scope, source, approval, row.body, reviewed, id(9), true, conversation)
  for (const change of [{ id: id(99) }, { organization_id: id(99) }, { project_id: id(99) }, { owner_id: id(99) }, { context_kind: 'organization' }]) {
    await assert.rejects(prepare(row, row, { ...parent, ...change }), /exact wording/)
  }
  await assert.rejects(prepare(row, row, undefined), /exact wording/)
  for (const change of [{ organization_id: null }, { organization_id: id(99) }, { conversation_id: id(99) }]) {
    await assert.rejects(prepare({ ...row, ...change }, row, parent), /exact wording/)
    await assert.rejects(prepare(row, { ...row, ...change }, parent), /approval message/)
  }
  assert.deepEqual(f.calls.map(c => c.name), ['read_project_positioning_output'])
})
test('unknown save preserves original proposal and read-only recovery never retries, including null result', async () => {
  const f = fixture(), p = await f.repo.prepare(scope, f.source, f.approval, 'Exact chosen positioning.', await f.repo.review(scope), id(9), true)
  f.state.unknown = true
  await assert.rejects(f.repo.confirm(p), e => e.proposal.request_id === id(9) && !e.knownRollback)
  f.state.missing = true; assert.equal(await f.repo.recover(scope, id(9)), null)
  f.state.missing = false; assert.deepEqual(await f.repo.recover(scope, id(9)), f.output)
  assert.deepEqual(f.calls.map(c => c.name), ['read_project_positioning_output', 'save_project_positioning_output', 'recover_project_positioning_output', 'recover_project_positioning_output'])
})
test('exact saved version continuation discloses wording only after review and stays in originating conversation', async () => {
  const f = fixture(); f.data.current = f.output
  const review = await f.repo.continuation(scope, f.output)
  const staged = await f.repo.stageProductStructure(review, 'Existing draft', scope)
  assert.ok(staged.text.startsWith('Existing draft\n\nContinue with product and service structure'))
  assert.ok(staged.text.includes('Exact chosen positioning.')); assert.doesNotMatch(staged.text, /Unselected|approval is explicit/)
  assert.equal((await f.repo.beforeSend({ text: staged.text, handoff: staged.handoff, scope })).text, staged.text)
  await assert.rejects(f.repo.continuation({ ...scope, conversation_id: id(99) }, f.output), /saved positioning/)
  assert.ok(f.calls.every(c => c.name === 'read_project_positioning_output'))
})
test('binding or current version drift blocks continuation and source edits block Send without fallback', async () => {
  const f = fixture(); f.data.current = f.output
  const review = await f.repo.continuation(scope, f.output), staged = await f.repo.stageProductStructure(review, 'Draft', scope)
  f.data.binding_id = id(99)
  await assert.rejects(f.repo.beforeSend({ text: staged.text, handoff: staged.handoff, scope }), /binding changed/)
  f.data.binding_id = id(6); f.data.current = { ...f.output, version_id: id(99) }
  await assert.rejects(f.repo.continuation(scope, f.output), /changed/)
  f.data.current = f.output
  await assert.rejects(f.repo.beforeSend({ text: 'Edited source', handoff: staged.handoff, scope }), /changed/)
})
