import { assertEquals, assertThrows } from 'jsr:@std/assert@1.0.14'
import { approvalRequestInput } from './index.ts'

Deno.test('D4 preserves the supplied order for sequential approval', () => {
  assertEquals(approvalRequestInput({
    artifact_version_id: 'version', approval_policy: 'sequential',
    required_approver_ids: ['second', 'first'],
  }), {
    artifactVersionId: 'version', approvalPolicy: 'sequential', approverIds: ['second', 'first'],
  })
})

Deno.test('D4 requires a valid policy and at least two unique approvers', () => {
  assertThrows(() => approvalRequestInput({
    artifact_version_id: 'version', approval_policy: 'any', required_approver_ids: ['one', 'two'],
  }), Error, 'sequential or parallel')
  assertThrows(() => approvalRequestInput({
    artifact_version_id: 'version', approval_policy: 'parallel', required_approver_ids: ['one'],
  }), Error, 'between 2 and 50')
  assertThrows(() => approvalRequestInput({
    artifact_version_id: 'version', approval_policy: 'parallel', required_approver_ids: ['one', 'one'],
  }), Error, 'unique')
})
