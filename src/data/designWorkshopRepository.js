import { supabase } from '../lib/supabase.js'

async function dataOrThrow(query) {
  const { data, error } = await query
  if (error) throw new Error(error.message || 'Design Workshop query failed')
  return data
}

async function invoke(action, input = {}) {
  const { data, error } = await supabase.functions.invoke('design-workshop', { body: { action, ...input } })
  if (error) throw new Error(error.message || 'Design Workshop function failed')
  if (data?.error) throw new Error(data.error)
  return data?.data
}

async function invokePageDesigns(action, input = {}) {
  const { data, error } = await supabase.functions.invoke('website-page-designs', { body: { action, ...input } })
  if (error) throw new Error(error.message || 'Website page design function failed')
  if (data?.error) throw new Error(data.error)
  return data?.data
}

async function invokeWordPressExport(action, input = {}) {
  const { data, error } = await supabase.functions.invoke('wordpress-export', { body: { action, ...input } })
  if (error) throw new Error(error.message || 'WordPress export function failed')
  if (data?.error) throw new Error(data.error)
  return data?.data
}

export const designWorkshop = Object.freeze({
  async listEngagements() {
    return dataOrThrow(supabase.from('engagements')
      .select('id, name, brand_id, status, agency_clients(name), brands(name), engagement_services!inner(id, status, service_catalog!inner(name, department_id, is_active))')
      .eq('engagement_services.status', 'active')
      .eq('engagement_services.service_catalog.department_id', 'design')
      .eq('engagement_services.service_catalog.is_active', true)
      .order('updated_at', { ascending: false }))
  },

  async load(engagementId) {
    const [engagement, stages, artifacts, versions, approvals, models, designServices, sessions, experimentReviewers] = await Promise.all([
      dataOrThrow(supabase.from('engagements').select('*, agency_clients(name), brands(name)').eq('id', engagementId).single()),
      dataOrThrow(supabase.from('engagement_stage_instances').select('*').eq('engagement_id', engagementId).order('position')),
      dataOrThrow(supabase.from('artifacts').select('*').eq('engagement_id', engagementId).order('created_at')),
      dataOrThrow(supabase.from('artifact_versions').select('*, artifacts!inner(engagement_id)').eq('artifacts.engagement_id', engagementId).order('version_number')),
      dataOrThrow(supabase.from('artifact_approvals').select('*').eq('engagement_id', engagementId).order('approved_at')),
      dataOrThrow(supabase.from('design_model_registry').select('*').eq('is_active', true).order('display_name')),
      dataOrThrow(supabase.from('engagement_services')
        .select('id, engagement_id, service_id, status, service_catalog!inner(id, name, slug, department_id, is_active)')
        .eq('engagement_id', engagementId).eq('status', 'active')
        .eq('service_catalog.department_id', 'design').eq('service_catalog.is_active', true)
        .order('activated_at')),
      dataOrThrow(supabase.from('design_workshop_sessions').select('*').eq('engagement_id', engagementId).order('created_at', { ascending: false })),
      invoke('list_experiment_reviewers'),
    ])
    const sessionIds = sessions.map(item => item.id)
    const externalEvents = await dataOrThrow(supabase.from('external_events').select('id, event_name, event_category, start_date, end_date')
      .eq('brand_id', engagement.brand_id).order('start_date').order('event_name'))
    const directionData = sessionIds.length ? await Promise.all([
      dataOrThrow(supabase.from('design_workshop_context_versions').select('*').in('session_id', sessionIds)),
      dataOrThrow(supabase.from('design_workshop_model_selections').select('*, design_model_registry(*)').in('session_id', sessionIds).order('position')),
      dataOrThrow(supabase.from('design_generation_runs').select('*').in('session_id', sessionIds).order('created_at')),
      dataOrThrow(supabase.from('design_directions').select('*').in('session_id', sessionIds).order('direction_slot')),
      dataOrThrow(supabase.from('design_direction_selections').select('*').in('session_id', sessionIds)),
      dataOrThrow(supabase.from('design_direction_releases').select('*').in('session_id', sessionIds)),
    ]) : [[], [], [], [], [], []]
    const directions = directionData[3]
    const [directionVersions, experimentalDirectionVersions] = directions.length
      ? await Promise.all([
          dataOrThrow(supabase.from('design_direction_versions').select('*').in('direction_id', directions.map(item => item.id)).eq('is_experimental', false).order('version_number')),
          dataOrThrow(supabase.from('design_direction_versions').select('*').in('direction_id', directions.map(item => item.id)).eq('is_experimental', true).order('version_number')),
        ])
      : [[], []]
    const visibleDirectionVersionIds = [...directionVersions, ...experimentalDirectionVersions].map(item => item.id)
    const [mediaAssets, pageDesigns] = visibleDirectionVersionIds.length
      ? await Promise.all([
          dataOrThrow(supabase.from('design_media_assets').select('*')
            .in('design_direction_version_id', visibleDirectionVersionIds).order('created_at', { ascending: false })),
          dataOrThrow(supabase.from('website_page_designs').select('*')
            .in('design_direction_version_id', visibleDirectionVersionIds).order('created_at', { ascending: false })),
        ])
      : [[], []]
    const wordpressExportJobs = pageDesigns.length
      ? await dataOrThrow(supabase.from('wordpress_export_jobs').select('*')
        .in('website_page_design_id', pageDesigns.map(item => item.id))
        .order('requested_at', { ascending: false }))
      : []
    const readyImageIds = mediaAssets.filter(item => item.media_type === 'image' && item.status === 'ready').map(item => item.id)
    const signedMedia = readyImageIds.length
      ? await invoke('sign_media_assets', { asset_ids: readyImageIds })
      : { signed_urls: {}, expires_in: 300 }
    const architectureArtifact = artifacts.find(item => item.artifact_type === 'website_architecture')
    const architectureVersion = versions.filter(item => item.artifact_id === architectureArtifact?.id)
      .sort((left, right) => right.version_number - left.version_number)[0]
    return {
      engagement, stages, artifacts, versions, approvals, models, designServices, sessions, externalEvents,
      contextVersions: directionData[0], modelSelections: directionData[1], runs: directionData[2],
      directions, selections: directionData[4], releases: directionData[5], directionVersions,
      experimentalDirectionVersions, experimentReviewers,
      mediaAssets: mediaAssets.map(item => ({ ...item, signed_url: signedMedia?.signed_urls?.[item.id] || null })),
      mediaUrlExpiresIn: signedMedia?.expires_in || 300,
      pageDesigns,
      wordpressExportJobs,
      architecturePages: Array.isArray(architectureVersion?.content?.pages) ? architectureVersion.content.pages : [],
    }
  },

  createSession: input => invoke('create_session', input),
  generateDirections: sessionId => invoke('generate_directions', { session_id: sessionId }),
  createDirectionRevision: (directionId, parentVersionId, content, experiment = {}) => invoke('create_direction_revision', {
    direction_id: directionId, parent_version_id: parentVersionId, content,
    is_experimental: experiment.isExperimental === true,
    experiment_visibility: experiment.reviewerIds || [],
  }),
  promoteDirectionExperiment: directionVersionId => invoke('promote_direction_experiment', {
    direction_version_id: directionVersionId,
  }),
  selectDirection: (sessionId, directionVersionId, notes = '') => invoke('select_direction', {
    session_id: sessionId, direction_version_id: directionVersionId, notes,
  }),
  releaseDirection: (sessionId, releaseNotes = '') => invoke('release_direction', { session_id: sessionId, release_notes: releaseNotes }),
  generateImage: (directionVersionId, modelRegistryId, prompt) => invoke('generate_image', {
    direction_version_id: directionVersionId, model_registry_id: modelRegistryId, prompt,
  }),
  createVideoPlaceholder: (directionVersionId, prompt) => invoke('create_video_placeholder', {
    direction_version_id: directionVersionId, prompt,
  }),
  generatePageDesign: (directionVersionId, slug, modelRegistryId) => invokePageDesigns('generate', {
    design_direction_version_id: directionVersionId, slug, model_registry_id: modelRegistryId,
  }),
  submitPageDesignReview: websitePageDesignId => invokePageDesigns('submit_review', {
    website_page_design_id: websitePageDesignId,
  }),
  approvePageDesign: websitePageDesignId => invokePageDesigns('approve', {
    website_page_design_id: websitePageDesignId,
  }),
  exportPageDesign: websitePageDesignId => invokeWordPressExport('export', {
    website_page_design_id: websitePageDesignId,
  }),
  getWordPressExportDownload: wordpressExportJobId => invokeWordPressExport('get_download', {
    wordpress_export_job_id: wordpressExportJobId,
  }),
})
