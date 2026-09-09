function assertIdentifier(value, label) {
  if (!value || typeof value !== 'string') {
    throw new TypeError(`${label} is required`)
  }
}

export async function recordClientApproval(client, input, userId) {
  assertIdentifier(input?.organizationId, 'organizationId')
  assertIdentifier(input?.deliverableVersionId, 'deliverableVersionId')
  assertIdentifier(userId, 'userId')
  if (!['approved', 'changes_required'].includes(input.decision)) {
    throw new TypeError('Client approval decision must be approved or changes_required')
  }

  const { data, error, status } = await client.rpc('decide_governed_deliverable_version', {
    p_organization_id: input.organizationId,
    p_deliverable_version_id: input.deliverableVersionId,
    p_expected_state_version: input.expectedStateVersion,
    p_decision: input.decision,
    p_rationale: input.rationale?.trim() || '',
    p_request_id: input.requestId || crypto.randomUUID(),
  })

  if (error) {
    const failure = new Error(error.message || 'Supabase delivery query failed')
    failure.cause = error
    failure.status = status ?? error.status ?? error.statusCode
    throw failure
  }

  return data
}
