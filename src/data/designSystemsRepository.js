import { supabase } from '../lib/supabase.js'

async function dataOrThrow(query) {
  const { data, error } = await query
  if (error) throw new Error(error.message || 'Design Systems query failed')
  return data
}

async function invoke(action, input = {}) {
  const { data, error } = await supabase.functions.invoke('design-systems', { body: { action, ...input } })
  if (error) throw new Error(error.message || 'Design Systems function failed')
  if (data?.error) throw new Error(data.error)
  return data?.data
}

async function proposeDepartmentArtifact(input) {
  const { data, error } = await supabase.functions.invoke('department-chat', {
    body: { action: 'propose_artifact', department_id: 'design', ...input },
  })
  if (error) throw new Error(error.message || 'Department Chat failed')
  if (data?.error) throw new Error(data.error)
  return data?.data
}

export const designSystems = Object.freeze({
  async loadLibrary() {
    const [services, artifacts, versions, approvals, stages] = await Promise.all([
      dataOrThrow(supabase.from('engagement_services')
        .select('id, engagement_id, status, engagements!inner(id, name, brand_id, status, brands(name), agency_clients(name)), service_catalog!inner(id, name, slug, department_id, is_active)')
        .eq('status', 'active').eq('service_catalog.slug', 'design_systems')
        .eq('service_catalog.department_id', 'design').eq('service_catalog.is_active', true)
        .order('activated_at')),
      dataOrThrow(supabase.from('artifacts')
        .select('*, engagements(name, status), brands(name)')
        .eq('artifact_type', 'design_system').order('created_at', { ascending: false })),
      dataOrThrow(supabase.from('artifact_versions')
        .select('*, artifacts!inner(artifact_type)').eq('artifacts.artifact_type', 'design_system')
        .order('version_number')),
      dataOrThrow(supabase.from('artifact_approvals')
        .select('*, artifacts!inner(artifact_type)').eq('artifacts.artifact_type', 'design_system')
        .order('approved_at')),
      dataOrThrow(supabase.from('engagement_stage_instances')
        .select('id, engagement_id, accountable_department_id, status')
        .eq('accountable_department_id', 'design').neq('status', 'cancelled')),
    ])
    return { services, artifacts, versions, approvals, stages }
  },

  save: input => invoke('save_design_system', input),
  release: (artifactVersionId, engagementServiceId, notes = '') => invoke('release_design_system', {
    artifact_version_id: artifactVersionId,
    engagement_service_id: engagementServiceId,
    notes,
  }),
  proposeArtifact: input => proposeDepartmentArtifact(input),
})
