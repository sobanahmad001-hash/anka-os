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
  create: (releaseId, engagementId, designPackageVersionId = null) => invoke('create_package', {
    design_direction_release_id: releaseId,
    engagement_id: engagementId,
    design_delivery_package_version_id: designPackageVersionId,
  }),
  signDownload: packageId => invoke('sign_package', { package_id: packageId }),
  releaseToClient: async (organizationId, packageId, requestId, summary = '') => {
    const { data, error } = await supabase.rpc('release_design_handoff_to_client', {
      p_organization_id: organizationId, p_handoff_package_id: packageId,
      p_request_id: requestId, p_summary: summary,
    })
    if (error) throw new Error(error.message || 'Design handoff client release failed')
    return data
  },
})
