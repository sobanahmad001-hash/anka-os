import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { transform } from 'esbuild'
import { createProjectPipelineWorkBatchesRepository } from './projectPipelineWorkBatchesRepository.js'
const uid = n => `e1000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const scope = { organizationId: uid(1), projectId: uid(2), engagementId: uid(3), actorId: uid(4) }
function setup() {
  const calls = [], state = { actor: scope.actorId, error: null }
  const client = { auth: { getUser: async () => ({ data: { user: { id: state.actor } } }) }, rpc(name, args) { calls.push({ name, args }); return Promise.resolve({ data: { can_apply: true, review_sha256: 'a'.repeat(64) }, error: state.error }) } }
  return { repo: createProjectPipelineWorkBatchesRepository(client), calls, state }
}
test('review freezes original scope, exact choices and source token before apply', async () => {
  const { repo, calls } = setup(), partition = { kind: 'engagement', id: scope.engagementId }, proposal = { version: 1, slots: [{ key: 'brief', instance: 1, action: 'create_missing' }] }
  const reviewed = await repo.review(scope, uid(5), partition, proposal)
  proposal.slots[0].action = 'use_existing'; partition.id = uid(99)
  assert.throws(() => { reviewed.draft.p_proposal.slots[0].key = 'changed' })
  await repo.apply(reviewed, uid(6))
  assert.equal(calls[1].name, 'apply_project_pipeline_work_batch')
  assert.equal(calls[1].args.p_proposal.slots[0].action, 'create_missing')
  assert.equal(calls[1].args.p_partition.id, scope.engagementId)
  assert.equal(calls[1].args.p_request_id, uid(6))
  assert.equal(calls[1].args.p_review_sha256, 'a'.repeat(64))
  assert.equal('p_actor_id' in calls[1].args, false)
})
test('account change blocks apply and recovery without a write or fallback', async () => {
  const { repo, calls, state } = setup(), reviewed = await repo.review(scope, uid(5), { kind: 'engagement', id: scope.engagementId }, { version: 1, slots: [] })
  state.actor = uid(99)
  await assert.rejects(repo.apply(reviewed, uid(6)), /original account/)
  await assert.rejects(repo.recover(scope, uid(6)), /original account/)
  assert.equal(calls.length, 1)
})
test('lost apply response never retries and recovery only reads the original request', async () => {
  const { repo, calls, state } = setup(), reviewed = await repo.review(scope, uid(5), {}, { version: 1, slots: [] })
  state.error = { message: 'connection lost' }
  await assert.rejects(repo.apply(reviewed, uid(6)), error => error.knownRollback === false)
  assert.equal(calls.length, 2)
  state.error = null
  await repo.recover(scope, uid(6))
  assert.deepEqual(calls[2], { name: 'recover_project_pipeline_work_batch', args: { p_organization_id: scope.organizationId, p_project_id: scope.projectId, p_engagement_id: scope.engagementId, p_request_id: uid(6) } })
})
test('source CAS and request conflicts retain SQL codes without choosing a new source', async () => {
  const { repo, calls, state } = setup(), reviewed = await repo.review(scope, uid(5), {}, { version: 1, slots: [] })
  state.error = { code: '40001', message: 'head changed' }
  await assert.rejects(repo.apply(reviewed, uid(6)), error => error.code === '40001' && error.knownRollback)
  state.error = { code: '23505', message: 'original payload owns request' }
  await assert.rejects(repo.apply(reviewed, uid(6)), error => error.code === '23505' && !error.knownRollback)
  assert.equal(calls.length, 3)
})
test('blocked review and invalid IDs cannot reach apply RPC', async () => {
  const { repo, calls } = setup()
  await assert.rejects(repo.apply({ review: { can_apply: false } }, uid(6)), /Resolve blockers/)
  await assert.rejects(repo.context(scope, 'latest', {}), /UUID/)
  await assert.rejects(repo.context(scope, uid(5), {}, { workItemIds: Array(101).fill(uid(8)) }), /at most 100/)
  assert.equal(calls.length, 0)
})
test('actual Work Edge accepts generated-card edits and retains normal version validation', async () => {
  const source = readFileSync(new URL('../../supabase/functions/work-items/index.ts', import.meta.url), 'utf8')
  const prefix = source.slice(source.indexOf('type Json ='), source.indexOf('async function requireContext'))
  const { code } = await transform(prefix, { loader: 'ts', format: 'esm' })
  const { normalizeWorkItemInput } = await import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'))
  const input = { organizationId: uid(1), engagementId: uid(3), workItemId: uid(7), title: 'Human edit', expectedRowVersion: 2, created_via: 'pipeline_plan' }
  assert.equal(normalizeWorkItemInput(input).p_created_via, 'pipeline_plan')
  assert.equal(normalizeWorkItemInput(input).p_expected_row_version, 2)
  assert.throws(() => normalizeWorkItemInput({ ...input, expectedRowVersion: 0 }), /row version/)
  assert.throws(() => normalizeWorkItemInput({ ...input, created_via: 'invented_source' }), /created_via/)
  assert.equal(normalizeWorkItemInput({ title: 'Ordinary Work', engagementId: uid(3) }).p_created_via, 'manual')
})
