import { supabase } from '../lib/supabase.js'

async function dataOrThrow(query) {
  const { data, error } = await query
  if (error) throw new Error(error.message || 'Artifact approval query failed')
  return data
}

async function invoke(action, input = {}) {
  const { data, error } = await supabase.functions.invoke('artifact-approvals', {
    body: { action, ...input },
  })
  if (error) throw new Error(error.message || 'Artifact approval function failed')
  if (data?.error) throw new Error(data.error)
  return data?.data
}

export const artifactApprovals = Object.freeze({
  async load(artifactVersionId) {
    const request = await dataOrThrow(supabase.from('artifact_approval_requests')
      .select('*').eq('artifact_version_id', artifactVersionId).maybeSingle())
    const [signoffs, approvers] = await Promise.all([
      request ? dataOrThrow(supabase.from('artifact_approval_signoffs')
        .select('*').eq('request_id', request.id).order('sequence_position')) : [],
      invoke('list_approvers', { artifact_version_id: artifactVersionId }),
    ])
    return { request, signoffs: signoffs || [], approvers: approvers || [] }
  },

  createRequest: (artifactVersionId, approvalPolicy, requiredApproverIds) => invoke('create_request', {
    artifact_version_id: artifactVersionId,
    approval_policy: approvalPolicy,
    required_approver_ids: requiredApproverIds,
  }),

  signOff: requestId => invoke('sign_off', { request_id: requestId }),
})
