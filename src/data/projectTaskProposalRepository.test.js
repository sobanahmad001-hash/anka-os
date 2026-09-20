import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'

const key = '__projectTaskProposalRepositoryTest'
globalThis[key] = { from() {}, rpc() {}, functions: { invoke() {} } }
const source = readFileSync(new URL('./projectTaskProposalRepository.js', import.meta.url), 'utf8')
  .replace(/import \{ supabase \} from '\.\.\/lib\/supabase\.js'/,
    'const supabase = globalThis[' + JSON.stringify(key) + ']')
const { createProjectTaskProposalRepository } = await import(
  'data:text/javascript;base64,' + Buffer.from(source).toString('base64'))
delete globalThis[key]

const org = '00000000-0000-4000-8000-000000000001'
const project = '90000000-0000-4000-8000-000000000001'
const proposal = 'c0000000-0000-4000-8000-000000000001'
const taskId = 'b0000000-0000-4000-8000-000000000001'

test('proposal creation binds exact task version, project, and source', async () => {
  const calls = []
  const repository = createProjectTaskProposalRepository({ from() {}, functions: { invoke() {} },
    rpc(name, args) {
      calls.push({ name, args })
      return Promise.resolve({ data: { id: proposal, organization_id: org, project_id: project, task_id: taskId } })
    } })
  await repository.create({ organizationId: org, projectId: project, proposalId: proposal, taskId,
    expectedRowVersion: 4, beforeStatus: 'backlog', proposedStatus: 'blocked',
    rationale: '  Dependency  ', impact: '  Pauses work  ', costNote: '  No extra cost  ', sourceCommentId: proposal })
  assert.equal(calls[0].name, 'create_project_task_change_proposal')
  assert.equal(calls[0].args.p_expected_row_version, 4)
  assert.equal(calls[0].args.p_source_comment_id, proposal)
  assert.equal(calls[0].args.p_rationale, 'Dependency')
  await assert.rejects(repository.create({ organizationId: org, projectId: project,
    proposalId: proposal, taskId, expectedRowVersion: 0, beforeStatus: 'backlog',
    proposedStatus: 'blocked', rationale: 'Reason', impact: 'Impact', costNote: 'None' }), /Complete/)
})

test('human decision uses scoped work-items action and validates receipt', async () => {
  const calls = []
  const repository = createProjectTaskProposalRepository({ from() {}, rpc() {},
    functions: { invoke(name, args) {
      calls.push({ name, args })
      return Promise.resolve({ data: { data: { id: proposal, organization_id: org,
        project_id: project, status: 'approved_failed' } } })
    } } })
  const result = await repository.decide({ organizationId: org, projectId: project,
    proposalId: proposal, decision: 'approve' })
  assert.equal(result.status, 'approved_failed')
  assert.equal(calls[0].name, 'work-items')
  assert.equal(calls[0].args.body.organizationId, org)
  assert.equal(calls[0].args.body.proposalId, proposal)
  await assert.rejects(repository.decide({ organizationId: org, projectId: taskId,
    proposalId: proposal, decision: 'approve' }), /did not match/)
})
