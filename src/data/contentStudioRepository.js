import { supabase } from '../lib/supabase.js'
import { CONTENT_ARTIFACT_TYPES } from './contentStudio.js'
import { BRAND_STATEMENT_SOURCE_TYPES, BRAND_STATEMENT_TYPE } from './brandBrief.js'

const CONTENT_WORKSPACE_TYPES = [...CONTENT_ARTIFACT_TYPES, BRAND_STATEMENT_TYPE]

async function dataOrThrow(query) {
  const { data, error } = await query
  if (error) throw new Error(error.message || 'Content Studio query failed')
  return data
}

async function invoke(functionName, action, input = {}) {
  const { data, error } = await supabase.functions.invoke(functionName, { body: { action, ...input } })
  if (error) throw new Error(error.message || 'Content Studio function failed')
  if (data?.error) throw new Error(data.error)
  return data?.data
}

export const contentStudio = Object.freeze({
  async listEngagements() {
    return dataOrThrow(supabase.from('engagements')
      .select('id, name, brand_id, status, agency_clients(name), brands(name), engagement_services!inner(id, status, service_catalog!inner(name, department_id))')
      .eq('engagement_services.status', 'active')
      .eq('engagement_services.service_catalog.department_id', 'content')
      .order('updated_at', { ascending: false }))
  },

  async load(engagementId) {
    const [engagement, stages, artifacts, versions, approvals, contentTasks] = await Promise.all([
      dataOrThrow(supabase.from('engagements').select('*, agency_clients(name), brands(name)').eq('id', engagementId).single()),
      dataOrThrow(supabase.from('engagement_stage_instances').select('*').eq('engagement_id', engagementId).order('position')),
      dataOrThrow(supabase.from('artifacts').select('*').eq('engagement_id', engagementId).in('artifact_type', CONTENT_WORKSPACE_TYPES).order('created_at')),
      dataOrThrow(supabase.from('artifact_versions').select('*, artifacts!inner(engagement_id, artifact_type)').eq('artifacts.engagement_id', engagementId).in('artifacts.artifact_type', CONTENT_WORKSPACE_TYPES).order('version_number')),
      dataOrThrow(supabase.from('artifact_approvals').select('*, artifacts!inner(artifact_type)').eq('engagement_id', engagementId).in('artifacts.artifact_type', CONTENT_WORKSPACE_TYPES).order('approved_at')),
      dataOrThrow(supabase.from('work_items').select('*').eq('engagement_id', engagementId).not('linked_page_path', 'is', null).is('deleted_at', null).order('position')),
    ])
    const [brandBrief, brandSourceArtifacts] = await Promise.all([
      dataOrThrow(supabase.from('brand_briefs').select('*').eq('brand_id', engagement.brand_id).maybeSingle()),
      dataOrThrow(supabase.from('artifacts').select('*').eq('brand_id', engagement.brand_id)
        .in('artifact_type', BRAND_STATEMENT_SOURCE_TYPES).order('created_at')),
    ])
    const sourceArtifactIds = brandSourceArtifacts.map(item => item.id)
    const brandSourceApprovals = sourceArtifactIds.length
      ? await dataOrThrow(supabase.from('artifact_approvals').select('*').in('artifact_id', sourceArtifactIds)
          .order('approved_at', { ascending: false }))
      : []
    return { engagement, stages, artifacts, versions, approvals, contentTasks,
      brandBrief, brandSourceArtifacts, brandSourceApprovals }
  },

  saveArtifact: input => invoke('content-studio', 'save_artifact', input),
  saveBrandBrief: input => invoke('content-studio', 'save_brand_brief', input),
  generateBrandStatement: input => invoke('content-studio', 'generate_brand_statement', input),
  approveArtifact: (artifactVersionId, notes = '') => invoke('content-studio', 'approve_artifact', {
    artifact_version_id: artifactVersionId, notes,
  }),
  generateContentTasks: engagementId => invoke('work-items', 'generate_content_tasks', { engagementId }),
  proposeArtifact: input => invoke('department-chat', 'propose_artifact', {
    department_id: 'content', ...input,
  }),
})
