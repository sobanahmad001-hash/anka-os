import { supabase } from '../lib/supabase.js'
import { invokeDesignFunction } from './designWorkshopRequest.js'

function requireOrganization(organizationId) {
  if (typeof organizationId !== 'string' || !organizationId.trim()) throw new TypeError('Active organization is required')
}

export function createDesignWorkshopScope(organizationId, { signal, client = supabase } = {}) {
  requireOrganization(organizationId)
  const scopedFrom = table => ({
    select(columns, options) {
      return client.from(table).select(columns, options).eq('organization_id', organizationId)
    },
  })
  async function dataOrThrow(query) {
    if (signal && typeof query.abortSignal === 'function') query = query.abortSignal(signal)
    const response = await query
    const { data, error } = response
    if (error) throw Object.assign(new Error(error.message || 'Design Workshop query failed'), { cause: error, status: response.status || error.status })
    const rows = Array.isArray(data) ? data : data ? [data] : []
    if (rows.some(row => row?.organization_id && row.organization_id !== organizationId)) {
      throw Object.assign(new Error('Design Workshop record does not belong to the active organization.'), { status: 403, membershipMismatch: true })
    }
    return data
  }
  async function invoke(action, input = {}) {
    return invokeDesignFunction(client, 'design-workshop', organizationId, action, input, { signal, fallbackMessage: 'Design Workshop function failed' })
  }
  async function invokePageDesigns(action, input = {}) {
    return invokeDesignFunction(client, 'website-page-designs', organizationId, action, input, { signal, fallbackMessage: 'Website page design function failed' })
  }
  async function invokeWordPressExport(action, input = {}) {
    return invokeDesignFunction(client, 'wordpress-export', organizationId, action, input, { signal, fallbackMessage: 'WordPress export function failed' })
  }

  return Object.freeze({
  async listEngagements() {
    return dataOrThrow(scopedFrom('engagements')
      .select('id, organization_id, project_id, name, brand_id, status, agency_clients(name), brands(name), projects(client_id), engagement_services!inner(id, status, service_catalog!inner(name, department_id, is_active))')
      .eq('engagement_services.status', 'active')
      .eq('engagement_services.service_catalog.department_id', 'design')
      .eq('engagement_services.service_catalog.is_active', true)
      .order('updated_at', { ascending: false }))
  },

  async load(engagementId, navigation = {}) {
    const recordQuery = navigation.workRecord?.kind === 'project_task'
      ? dataOrThrow(scopedFrom('tasks').select('id, organization_id, project_id').eq('id', navigation.workRecord.id).is('archived_at', null).maybeSingle())
      : navigation.workRecord?.kind === 'engagement_work_item'
        ? dataOrThrow(scopedFrom('work_items').select('id, organization_id, project_id, engagement_id').eq('id', navigation.workRecord.id).is('deleted_at', null).maybeSingle())
        : Promise.resolve(null)
    const [engagement, stages, artifacts, versions, approvals, models, designServices, sessions, pageFlows, experimentReviewers, navigationRecord] = await Promise.all([
      dataOrThrow(scopedFrom('engagements').select('*, agency_clients(name), brands(name), projects(client_id)').eq('id', engagementId).single()),
      dataOrThrow(scopedFrom('engagement_stage_instances').select('*').eq('engagement_id', engagementId).order('position')),
      dataOrThrow(scopedFrom('artifacts').select('*').eq('engagement_id', engagementId).order('created_at')),
      dataOrThrow(scopedFrom('artifact_versions').select('*, artifacts!inner(engagement_id)').eq('artifacts.engagement_id', engagementId).order('version_number')),
      dataOrThrow(scopedFrom('artifact_approvals').select('*').eq('engagement_id', engagementId).order('approved_at')),
      dataOrThrow(scopedFrom('design_model_registry').select('*').eq('is_active', true).order('display_name')),
      dataOrThrow(scopedFrom('engagement_services')
        .select('id, engagement_id, service_id, status, service_catalog!inner(id, name, slug, department_id, is_active)')
        .eq('engagement_id', engagementId).eq('status', 'active')
        .eq('service_catalog.department_id', 'design').eq('service_catalog.is_active', true)
        .order('activated_at')),
      dataOrThrow(scopedFrom('design_workshop_sessions').select('*').eq('engagement_id', engagementId).order('created_at', { ascending: false })),
      dataOrThrow(scopedFrom('design_page_flows').select('*').eq('engagement_id', engagementId).order('created_at', { ascending: false })),
      invoke('list_experiment_reviewers'),
      recordQuery,
    ])
    const sessionIds = sessions.map(item => item.id)
    const externalEvents = await dataOrThrow(scopedFrom('external_events').select('id, event_name, event_category, start_date, end_date')
      .eq('brand_id', engagement.brand_id).order('start_date').order('event_name'))
    const directionData = sessionIds.length ? await Promise.all([
      dataOrThrow(scopedFrom('design_workshop_context_versions').select('*').in('session_id', sessionIds)),
      dataOrThrow(scopedFrom('design_workshop_model_selections').select('*, design_model_registry(*)').in('session_id', sessionIds).order('position')),
      dataOrThrow(scopedFrom('design_generation_runs').select('*').in('session_id', sessionIds).order('created_at')),
      dataOrThrow(scopedFrom('design_directions').select('*').in('session_id', sessionIds).order('direction_slot')),
      dataOrThrow(scopedFrom('design_direction_selections').select('*').in('session_id', sessionIds)),
      dataOrThrow(scopedFrom('design_direction_releases').select('*').in('session_id', sessionIds)),
    ]) : [[], [], [], [], [], []]
    const directions = directionData[3]
    const releaseIds = directionData[5].map(item => item.id)
    const [directionVersions, experimentalDirectionVersions] = directions.length
      ? await Promise.all([
          dataOrThrow(scopedFrom('design_direction_versions').select('*').in('direction_id', directions.map(item => item.id)).eq('is_experimental', false).order('version_number')),
          dataOrThrow(scopedFrom('design_direction_versions').select('*').in('direction_id', directions.map(item => item.id)).eq('is_experimental', true).order('version_number')),
        ])
      : [[], []]
    const visibleDirectionVersionIds = [...directionVersions, ...experimentalDirectionVersions].map(item => item.id)
    const [mediaAssets, pageDesigns, variants] = visibleDirectionVersionIds.length
      ? await Promise.all([
          dataOrThrow(scopedFrom('design_media_assets').select('*')
            .in('design_direction_version_id', visibleDirectionVersionIds).order('created_at', { ascending: false })),
          dataOrThrow(scopedFrom('website_page_designs').select('*')
            .in('design_direction_version_id', visibleDirectionVersionIds).order('created_at', { ascending: false })),
          dataOrThrow(scopedFrom('design_direction_variants').select('*')
            .in('source_direction_version_id', visibleDirectionVersionIds).order('created_at', { ascending: false })),
        ])
      : [[], [], []]
    const wordpressExportJobs = pageDesigns.length
      ? await dataOrThrow(scopedFrom('wordpress_export_jobs').select('*')
        .in('website_page_design_id', pageDesigns.map(item => item.id))
        .order('requested_at', { ascending: false }))
      : []
    const handoffPackages = releaseIds.length
      ? await dataOrThrow(scopedFrom('production_handoff_packages').select([
        'id',
        'organization_id',
        'design_direction_release_id',
        'status',
        'included_asset_ids',
        'failure_reason',
        'requested_by',
        'created_at',
        'completed_at',
      ].join(','))
        .in('design_direction_release_id', releaseIds).order('created_at', { ascending: false }))
      : []
    const readyImageIds = mediaAssets.filter(item => item.media_type === 'image' && item.status === 'ready').map(item => item.id)
    const signedMedia = readyImageIds.length
      ? await invoke('sign_media_assets', { asset_ids: readyImageIds })
      : { signed_urls: {}, expires_in: 300 }
    const architectureArtifact = artifacts.find(item => item.artifact_type === 'website_architecture')
    const architectureVersion = versions.filter(item => item.artifact_id === architectureArtifact?.id)
      .sort((left, right) => right.version_number - left.version_number)[0]
    return {
      engagement, stages, artifacts, versions, approvals, models, designServices, sessions, externalEvents, pageFlows,
      contextVersions: directionData[0], modelSelections: directionData[1], runs: directionData[2],
      directions, selections: directionData[4], releases: directionData[5], directionVersions,
      experimentalDirectionVersions, experimentReviewers,
      navigationWorkRecord: navigationRecord ? {
        kind: navigation.workRecord.kind,
        id: navigationRecord.id,
        organizationId: navigationRecord.organization_id,
        projectId: navigationRecord.project_id,
        engagementId: navigationRecord.engagement_id,
      } : null,
      mediaAssets: mediaAssets.map(item => ({ ...item, signed_url: signedMedia?.signed_urls?.[item.id] || null })),
      variants,
      handoffPackages,
      mediaUrlExpiresIn: signedMedia?.expires_in || 300,
      pageDesigns,
      wordpressExportJobs,
      architecturePages: Array.isArray(architectureVersion?.content?.pages) ? architectureVersion.content.pages : [],
    }
  },

  createPageFlow: input => invoke('create_page_flow', input),
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
  generateVariants: (sourceDirectionVersionId, modelRegistryId, variantFormats) => invoke('generate_variants', {
    source_direction_version_id: sourceDirectionVersionId,
    model_registry_id: modelRegistryId,
    variant_formats: variantFormats,
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
}

export const designWorkshop = Object.freeze({ forOrganization: createDesignWorkshopScope })
