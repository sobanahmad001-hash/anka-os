import { supabase } from '../lib/supabase.js'

async function invoke(action, input) {
  const { data, error } = await supabase.functions.invoke('development-studio', {
    body: { action, ...input },
  })
  if (error) throw new Error(error.message || 'Development Studio function failed')
  if (data?.error) throw new Error(data.error)
  return data?.data
}

async function propose(action, input) {
  const { data, error } = await supabase.functions.invoke('department-chat', {
    body: { action, department_id: 'development', ...input },
  })
  if (error) throw new Error(error.message || 'Department Chat failed')
  if (data?.error) throw new Error(data.error)
  return data?.data
}

export const developmentStudio = Object.freeze({
  updateStage: input => invoke('update_stage', input),
  saveArtifact: input => invoke('save_artifact', input),
  proposeArtifact: input => propose('propose_artifact', input),
  proposeWorkItem: input => propose('propose_work_item', input),
})
