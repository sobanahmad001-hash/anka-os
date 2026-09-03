function failure(error, envelope, detail) {
  const status = [error?.context?.status, envelope?.status, error?.status, error?.statusCode, detail?.status, detail?.statusCode]
    .map(Number).find(value => Number.isInteger(value) && value >= 400 && value <= 599)
  return Object.assign(new Error(detail?.error || error?.message || 'Department Chat request failed'), {
    status, outcome: detail?.outcome || error?.outcome, code: error?.code,
  })
}

export function createDepartmentChatRepository(client) {
  async function invoke(action, input = {}, { organizationId, signal } = {}) {
    if (!organizationId) throw Object.assign(new Error('Selected organization is required'), { status: 400 })
    signal?.throwIfAborted()
    const envelope = await client.functions.invoke('department-chat', { body: { ...input, action, organization_id: organizationId }, signal })
    const { data, error } = envelope
    if (error || data?.error || envelope.status >= 400) {
      let detail = data
      try { detail = await error?.context?.json() || data } catch { /* Preserve transport status for non-JSON errors. */ }
      throw failure(error, envelope, detail)
    }
    return data?.data
  }
  return Object.freeze({
    getOfficialRecord: async (organizationId, decision, { signal } = {}) => {
      const table = decision.artifact_version_id ? 'artifact_versions' : 'work_items'
      const id = decision.artifact_version_id || decision.work_item_id
      if (!organizationId || !id) throw new Error('Official record identity is required')
      signal?.throwIfAborted()
      let query = client.from(table).select('*').eq('organization_id', organizationId).eq('id', id)
      if (signal) query = query.abortSignal(signal)
      const envelope = await query.single()
      if (envelope.error || envelope.status >= 400) throw failure(envelope.error, envelope)
      return envelope.data
    },
    proposeArtifact: (departmentId, input, scope) => invoke('propose_artifact', { ...input, department_id: departmentId }, scope),
    proposeWorkItem: (departmentId, input, scope) => invoke('propose_work_item', { ...input, department_id: departmentId }, scope),
    confirmProposal: (proposalId, scope) => invoke('confirm_proposal', { proposal_id: proposalId }, scope),
    rejectProposal: (proposalId, scope) => invoke('reject_proposal', { proposal_id: proposalId }, scope),
  })
}
