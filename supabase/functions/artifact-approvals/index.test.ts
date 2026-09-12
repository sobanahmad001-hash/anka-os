import { assertEquals, assertThrows } from 'jsr:@std/assert@1.0.14'
import { approvalChangeRequestInput, approvalRequestInput } from './index.ts'

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

Deno.test('MB02B permits one approver only through the explicit campaign-brief minimum', () => {
  assertEquals(approvalRequestInput({
    artifact_version_id: 'version', approval_policy: 'parallel', required_approver_ids: ['leader'],
  }, 1), {
    artifactVersionId: 'version', approvalPolicy: 'parallel', approverIds: ['leader'],
  })
  assertThrows(() => approvalRequestInput({
    artifact_version_id: 'version', approval_policy: 'parallel', required_approver_ids: ['leader'],
  }), Error, 'between 2 and 50')
})

Deno.test('B06a requires an exact pending request identity and non-empty change comment', () => {
  assertEquals(approvalChangeRequestInput({
    request_id: 'request-1', comment: '  Correct the product claim.  ',
  }), { requestId: 'request-1', comment: 'Correct the product claim.' })
  assertThrows(() => approvalChangeRequestInput({ request_id: 'request-1', comment: '   ' }),
    Error, 'comment is required')
  assertThrows(() => approvalChangeRequestInput({ comment: 'Change this.' }),
    Error, 'Approval request is required')
})
