import { supabase } from '../lib/supabase.js'
import { CONTENT_ARTIFACT_TYPES } from './contentStudio.js'
import { BRAND_STATEMENT_SOURCE_TYPES, BRAND_STATEMENT_TYPE } from './brandBrief.js'

const CONTENT_WORKSPACE_TYPES = [...CONTENT_ARTIFACT_TYPES, BRAND_STATEMENT_TYPE]

async function dataOrThrow(query, { signal } = {}) {
  if (signal && typeof query.abortSignal === 'function') query = query.abortSignal(signal)
  const { data, error } = await query
  if (error) throw Object.assign(new Error(error.message || 'Content Studio query failed'), {
    status: error.status || error.statusCode,
  })
  return data
}

async function invoke(organizationId, functionName, action, input = {}, { signal } = {}) {
  const { data, error } = await supabase.functions.invoke(functionName, {
    body: { ...input, action, organization_id: organizationId }, signal,
  })
  if (error) throw Object.assign(new Error(error.message || 'Content Studio function failed'), {
    status: error.status || error.statusCode || error.context?.status,
  })
  if (data?.error) throw new Error(data.error)
  return data?.data
}

async function listBlogEventLinks(organizationId, brandId, options) {
  return dataOrThrow(supabase.from('content_event_links')
    .select('*, external_events!inner(id, brand_id, event_name, event_category, start_date, end_date), work_items(id, title, status, deleted_at)')
    .eq('organization_id', organizationId).eq('content_type', 'blog')
    .eq('external_events.brand_id', brandId).order('created_at'), options)
}

export function createContentStudioScope(organizationId, { signal } = {}) {
  if (!organizationId) throw new TypeError('Active organization is required')
  const options = { signal }
  return Object.freeze({
  organizationId,
  async listEngagements() {
    return dataOrThrow(supabase.from('engagements')
      .select('id, organization_id, name, brand_id, status, agency_clients(name), brands(name), engagement_services!inner(id, status, service_catalog!inner(name, department_id))')
      .eq('organization_id', organizationId).eq('engagement_services.status', 'active')
      .eq('engagement_services.service_catalog.department_id', 'content')
      .order('updated_at', { ascending: false }), options)
  },

  async load(engagementId) {
    const [engagement, stages, artifacts, versions, approvals, contentTasks] = await Promise.all([
      dataOrThrow(supabase.from('engagements').select('*, agency_clients(name), brands(name)').eq('organization_id', organizationId).eq('id', engagementId).single(), options),
      dataOrThrow(supabase.from('engagement_stage_instances').select('*').eq('organization_id', organizationId).eq('engagement_id', engagementId).order('position'), options),
      dataOrThrow(supabase.from('artifacts').select('*').eq('organization_id', organizationId).eq('engagement_id', engagementId).in('artifact_type', CONTENT_WORKSPACE_TYPES).order('created_at'), options),
      dataOrThrow(supabase.from('artifact_versions').select('*, artifacts!inner(engagement_id, artifact_type)').eq('organization_id', organizationId).eq('artifacts.engagement_id', engagementId).in('artifacts.artifact_type', CONTENT_WORKSPACE_TYPES).order('version_number'), options),
      dataOrThrow(supabase.from('artifact_approvals').select('*, artifacts!inner(artifact_type)').eq('organization_id', organizationId).eq('engagement_id', engagementId).in('artifacts.artifact_type', CONTENT_WORKSPACE_TYPES).order('approved_at'), options),
      dataOrThrow(supabase.from('work_items').select('*').eq('organization_id', organizationId).eq('engagement_id', engagementId).not('linked_page_path', 'is', null).is('deleted_at', null).order('position'), options),
    ])
    const [brandBrief, brandSourceArtifacts] = await Promise.all([
      dataOrThrow(supabase.from('brand_briefs').select('*').eq('organization_id', organizationId).eq('brand_id', engagement.brand_id).maybeSingle(), options),
      dataOrThrow(supabase.from('artifacts').select('*').eq('organization_id', organizationId).eq('brand_id', engagement.brand_id)
        .in('artifact_type', BRAND_STATEMENT_SOURCE_TYPES).order('created_at'), options),
    ])
    const sourceArtifactIds = brandSourceArtifacts.map(item => item.id)
    const brandSourceApprovals = sourceArtifactIds.length
      ? await dataOrThrow(supabase.from('artifact_approvals').select('*').eq('organization_id', organizationId)
          .in('artifact_id', sourceArtifactIds).order('approved_at', { ascending: false }), options)
      : []
    const blogEventLinks = await listBlogEventLinks(organizationId, engagement.brand_id, options)
    return { engagement, stages, artifacts, versions, approvals, contentTasks,
      brandBrief, brandSourceArtifacts, brandSourceApprovals, blogEventLinks }
  },

  saveArtifact: input => invoke(organizationId, 'content-studio', 'save_artifact', input, options),
  saveBrandBrief: input => invoke(organizationId, 'content-studio', 'save_brand_brief', input, options),
  generateBrandStatement: input => invoke(organizationId, 'content-studio', 'generate_brand_statement', input, options),
  approveArtifact: (artifactVersionId, notes = '') => invoke(organizationId, 'content-studio', 'approve_artifact', {
    artifact_version_id: artifactVersionId, notes,
  }, options),
  updateBlogEventLink: (link, status) => invoke(organizationId, 'external-events', 'update_link', {
    linkId: link.id, contentType: 'blog', leadTimeDays: link.lead_time_days,
    linkedWorkItemId: link.linked_work_item_id, status,
  }, options),
  generateContentTasks: engagementId => invoke(organizationId, 'work-items', 'generate_content_tasks', { engagementId }, options),
  proposeArtifact: input => invoke(organizationId, 'department-chat', 'propose_artifact', {
    department_id: 'content', ...input,
  }, options),
  proposeWorkItem: input => invoke(organizationId, 'department-chat', 'propose_work_item', {
    department_id: 'content', ...input,
  }, options),
  })
}

export const contentStudio = Object.freeze({
  forOrganization: createContentStudioScope,
})
