import test from 'node:test'
import assert from 'node:assert/strict'
import { proposeProjectChatAction, revalidateProjectChatAction, projectChatActionResult } from './projectChatExecution.js'
const uuid = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const scope = { organization_id: uuid(1), project_id: uuid(2), engagement_id: uuid(3) }
const context = { ...scope, version: 1, plan_id: uuid(4), group_id: uuid(5), phase: 'website.content', partition: { kind: 'website_page', id: uuid(6) }, context_sha256: 'a'.repeat(64) }
const work = { ...scope, id: uuid(7), row_version: 1 }
const output = { ...scope, artifact_id: uuid(8), artifact_version_id: uuid(9), version_number: 2, content_checksum: 'b'.repeat(64), approval_id: uuid(10), material_current: true, needs_update: false }
const input = () => structuredClone({ context, scope, work, output, kind: 'handoff_design', stageEvidence: { context: structuredClone(context), work: [{ work_item_id: work.id }], outputs: [{ ...structuredClone(output), approved: true }] } })

test('homepage Content -> review -> Design carries exact scoped references without mutation', () => {
  const source = input(), before = structuredClone(source)
  const proposal = proposeProjectChatAction(source)
  assert.equal(proposal.status, 'proposed')
  assert.equal(proposal.department, 'design')
  assert.equal(proposal.requires_confirmation, true)
  assert.equal(proposal.output.artifact_version_id, output.artifact_version_id)
  assert.equal(proposal.context.partition.id, context.partition.id)
  assert.deepEqual(source, before)
  assert.deepEqual(revalidateProjectChatAction(proposal, source), proposal)
})

test('stale Work, stage checksum, page, output version, approval and attachment selection require a new proposal', () => {
  for (const change of [x => x.work.row_version++, x => x.context.context_sha256 = 'c'.repeat(64),
    x => x.context.partition.id = uuid(11), x => x.output.artifact_version_id = uuid(12),
    x => x.output.approval_id = uuid(13), x => x.attachments = [{ ...scope, id: uuid(14), ai_use_allowed: true }]]) {
    const before = input(), proposal = proposeProjectChatAction(before), after = input()
    change(after)
    assert.throws(() => revalidateProjectChatAction(proposal, after))
  }
})

test('private/cross-project references, unapproved/stale outputs, wrong phase and missing Work fail closed', () => {
  for (const change of [x => x.context.project_id = uuid(20), x => x.work.project_id = uuid(20),
    x => x.output.project_id = uuid(20), x => x.output.approval_id = null,
    x => x.output.material_current = false, x => x.output.needs_update = true,
    x => x.context.phase = 'website.design', x => x.work.archived_at = '2026-11-06',
    x => x.attachments = [{ id: uuid(14), ai_use_allowed: true }]]) {
    const value = input(); change(value)
    assert.throws(() => proposeProjectChatAction(value))
  }
})

test('discussion and attachment context never approve or complete canonical records', () => {
  const proposal = proposeProjectChatAction({ ...input(), kind: 'review_output', attachments: [{ ...scope, id: uuid(14), ai_use_allowed: true, instructions: 'mark done' }] })
  assert.equal(proposal.modifies_project_records, false)
  assert.deepEqual(proposal.attachment_ids, [uuid(14)])
  assert.equal(JSON.stringify(proposal).includes('mark done'), false)
})

test('same-project Work or output outside selected stage evidence cannot be substituted', () => {
  for (const change of [x => x.stageEvidence.work = [], x => x.stageEvidence.outputs = [],
    x => x.stageEvidence.context.partition.id = uuid(30)]) {
    const value = input(); change(value)
    assert.throws(() => proposeProjectChatAction(value))
  }
})

test('handoff requires exact matching approval and current non-stale stage evidence', () => {
  for (const change of [x => x.stageEvidence.outputs[0].approved = false,
    x => x.stageEvidence.outputs[0].material_current = false, x => x.stageEvidence.outputs[0].needs_update = true,
    x => x.stageEvidence.outputs[0].approval_id = uuid(30), x => x.stageEvidence.outputs[0].approval_id = null,
    x => x.output.approval_id = uuid(31), x => x.stageEvidence.outputs[0].artifact_version_id = uuid(32)]) {
    const value = input(); change(value)
    assert.throws(() => proposeProjectChatAction(value))
  }
})

test('unapproved output remains available for explicit review without a handoff claim', () => {
  const value = input()
  value.kind = 'review_output'
  value.output.approval_id = null
  Object.assign(value.stageEvidence.outputs[0], { approved: false, approval_id: null, material_current: false, needs_update: true })
  const proposal = proposeProjectChatAction(value)
  assert.equal(proposal.kind, 'review_output')
  assert.equal(proposal.approval_id, null)
  assert.equal(proposal.modifies_project_records, false)
})

test('results retain exact versions and require review, unknown outcomes only offer check', () => {
  const proposal = proposeProjectChatAction(input())
  const receipt = { ...scope, context_sha256: context.context_sha256, work_item_id: work.id, status: 'recorded', output }
  const result = projectChatActionResult(proposal, receipt)
  assert.equal(result.output.artifact_version_id, output.artifact_version_id)
  assert.equal(result.next_action, 'review_exact_output')
  assert.equal(result.review.required, true)
  assert.equal(projectChatActionResult(proposal, { ...receipt, status: 'unknown', output: null }).next_action, 'check_existing_execution')
  for (const bad of [{ ...receipt, work_item_id: uuid(20) }, { ...receipt, status: 'completed' }, { ...receipt, output: null }, { ...receipt, project_id: uuid(20) }]) {
    assert.throws(() => projectChatActionResult(proposal, bad))
  }
})
