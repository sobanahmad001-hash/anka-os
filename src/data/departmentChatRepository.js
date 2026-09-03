import { supabase } from '../lib/supabase.js'

async function invoke(action, input = {}) {
  const { data, error } = await supabase.functions.invoke('department-chat', {
    body: { action, ...input },
  })
  if (error) throw new Error(error.message || 'Department Chat function failed')
  if (data?.error) throw new Error(data.error)
  return data?.data
}

export const departmentChat = Object.freeze({
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
