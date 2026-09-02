import { supabase } from '../lib/supabase.js'

async function invoke(action, input = {}) {
  const { data, error } = await supabase.functions.invoke('production-handoff', {
    body: { action, ...input },
  })
  if (error) throw new Error(error.message || 'Production handoff function failed')
  if (data?.error) throw new Error(data.error)
  return data?.data
}

export const productionHandoffs = Object.freeze({
  create: (releaseId, engagementId) => invoke('create_package', {
    design_direction_release_id: releaseId,
    engagement_id: engagementId,
  }),
  signDownload: packageId => invoke('sign_package', { package_id: packageId }),
})
