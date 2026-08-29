import { supabase } from '../lib/supabase.js'

async function invoke(action, input) {
  const { data, error } = await supabase.functions.invoke('development-studio', {
    body: { action, ...input },
  })
  if (error) throw new Error(error.message || 'Development Studio function failed')
  if (data?.error) throw new Error(data.error)
  return data?.data
}

export const developmentStudio = Object.freeze({
  updateStage: input => invoke('update_stage', input),
  saveArtifact: input => invoke('save_artifact', input),
})
