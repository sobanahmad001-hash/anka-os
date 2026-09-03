import { supabase } from '../lib/supabase.js'

async function invoke(action, input = {}) {
  const { data, error } = await supabase.functions.invoke('department-chat', {
    body: { action, ...input },
  })
  if (error) {
    let detail
    try { detail = await error.context?.json() } catch { /* Non-JSON transport error. */ }
    throw Object.assign(new Error(detail?.error || error.message || 'Department Chat function failed'), { outcome: detail?.outcome })
  }
  if (data?.error) throw Object.assign(new Error(data.error), { outcome: data.outcome })
  return data?.data
}

export const departmentChat = Object.freeze({
  getOfficialRecord: async (organizationId, decision) => {
    const table = decision.artifact_version_id ? 'artifact_versions' : 'work_items'
    const id = decision.artifact_version_id || decision.work_item_id
    if (!organizationId || !id) throw new Error('Official record identity is required')
    const { data, error } = await supabase.from(table).select('*').eq('organization_id', organizationId).eq('id', id).single()
    if (error) throw error
    return data
  },
  proposeArtifact: (departmentId, input) => invoke('propose_artifact', {
    department_id: departmentId,
    ...input,
  }),
  proposeWorkItem: (departmentId, input) => invoke('propose_work_item', {
    department_id: departmentId,
    ...input,
  }),
  confirmProposal: proposalId => invoke('confirm_proposal', {
    proposal_id: proposalId,
  }),
  rejectProposal: proposalId => invoke('reject_proposal', {
    proposal_id: proposalId,
  }),
})
