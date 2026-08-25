function assertIdentifier(value, label) {
  if (!value || typeof value !== 'string') {
    throw new TypeError(`${label} is required`)
  }
}

export async function recordClientApproval(client, input, userId) {
  assertIdentifier(input?.projectId, 'projectId')
  assertIdentifier(input?.deliverableId, 'deliverableId')
  assertIdentifier(input?.deliverableVersionId, 'deliverableVersionId')
  assertIdentifier(userId, 'userId')
  if (!['approved', 'changes_required'].includes(input.decision)) {
    throw new TypeError('Client approval decision must be approved or changes_required')
  }

  const { data, error } = await client.from('approvals').insert({
    project_id: input.projectId,
    deliverable_id: input.deliverableId,
    deliverable_version_id: input.deliverableVersionId,
    approval_type: 'client_approval',
    decision: input.decision,
    rationale: input.rationale?.trim() || '',
    checklist_result: input.checklistResult || {},
    decided_by: userId,
  }).select().single()

  if (error) {
    const failure = new Error(error.message || 'Supabase delivery query failed')
    failure.cause = error
    throw failure
  }

  return data
}
