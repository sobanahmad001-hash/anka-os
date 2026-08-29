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

export const designWorkshop = Object.freeze({
  async listEngagements() {
    return dataOrThrow(supabase.from('engagements')
      .select('id, name, brand_id, status, agency_clients(name), brands(name), engagement_services(id, service_catalog(name, department_id))')
      .order('updated_at', { ascending: false }))
  },

  async load(engagementId) {
    const [engagement, stages, artifacts, versions, approvals, models, sessions, experimentReviewers] = await Promise.all([
      dataOrThrow(supabase.from('engagements').select('*, agency_clients(name), brands(name)').eq('id', engagementId).single()),
      dataOrThrow(supabase.from('engagement_stage_instances').select('*').eq('engagement_id', engagementId).order('position')),
      dataOrThrow(supabase.from('artifacts').select('*').eq('engagement_id', engagementId).order('created_at')),
      dataOrThrow(supabase.from('artifact_versions').select('*, artifacts!inner(engagement_id)').eq('artifacts.engagement_id', engagementId).order('version_number')),
      dataOrThrow(supabase.from('artifact_approvals').select('*').eq('engagement_id', engagementId).order('approved_at')),
      dataOrThrow(supabase.from('design_model_registry').select('*').eq('is_active', true).order('display_name')),
      dataOrThrow(supabase.from('design_workshop_sessions').select('*').eq('engagement_id', engagementId).order('created_at', { ascending: false })),
      invoke('list_experiment_reviewers'),
    ])
    const sessionIds = sessions.map(item => item.id)
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
    const mediaAssets = visibleDirectionVersionIds.length
      ? await dataOrThrow(supabase.from('design_media_assets').select('*')
          .in('design_direction_version_id', visibleDirectionVersionIds).order('created_at', { ascending: false }))
      : []
    const readyImageIds = mediaAssets.filter(item => item.media_type === 'image' && item.status === 'ready').map(item => item.id)
    const signedMedia = readyImageIds.length
      ? await invoke('sign_media_assets', { asset_ids: readyImageIds })
      : { signed_urls: {}, expires_in: 300 }
    return {
      engagement, stages, artifacts, versions, approvals, models, sessions,
      contextVersions: directionData[0], modelSelections: directionData[1], runs: directionData[2],
      directions, selections: directionData[4], releases: directionData[5], directionVersions,
      experimentalDirectionVersions, experimentReviewers,
      mediaAssets: mediaAssets.map(item => ({ ...item, signed_url: signedMedia?.signed_urls?.[item.id] || null })),
      mediaUrlExpiresIn: signedMedia?.expires_in || 300,
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
})
