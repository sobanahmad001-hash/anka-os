import { supabase } from '../lib/supabase.js'

async function dataOrThrow(query, { signal } = {}) {
  if (signal && typeof query.abortSignal === 'function') query = query.abortSignal(signal)
  const { data, error } = await query
  if (error) throw Object.assign(new Error(error.message || 'Content request query failed'), {
    status: error.status || error.statusCode,
  })
  return data
}

async function invoke(organizationId, functionName, action, input = {}, { signal } = {}) {
  const { data, error } = await supabase.functions.invoke(functionName, {
    body: { ...input, action, organization_id: organizationId }, signal,
  })
  if (error) throw Object.assign(new Error(error.message || 'Content request action failed'), {
    status: error.status || error.statusCode || error.context?.status,
  })
  if (data?.error) throw new Error(data.error)
  return data?.data
}

export function createContentRequestsScope(organizationId, { signal } = {}) {
  if (!organizationId) throw new TypeError('Active organization is required')
  const options = { signal }
  return Object.freeze({
  organizationId,
  async loadGeneral() {
    // CP1's RLS policy limits both reads to the caller's active organization.
    const [requests, brands] = await Promise.all([
      dataOrThrow(supabase.from('content_requests')
        .select('id, organization_id, brand_id, mode, output_path, format, brief, status, created_at')
        .eq('organization_id', organizationId).eq('mode', 'general').order('created_at', { ascending: false }), options),
      dataOrThrow(supabase.from('brands')
        .select('id, organization_id, name, status').eq('organization_id', organizationId).eq('status', 'active').order('name'), options),
    ])
    const requestIds = requests.map(request => request.id)
    const handoffs = requestIds.length
      ? await dataOrThrow(supabase.from('content_request_assets')
          .select('id, content_request_id, figma_handoff_url, created_at')
          .eq('organization_id', organizationId).in('content_request_id', requestIds)
          .not('figma_handoff_url', 'is', null).order('created_at'), options)
      : []
    return { requests, brands, handoffs }
  },

  async loadProject(engagement) {
    if (!engagement?.id || !engagement?.brand_id || engagement.organization_id !== organizationId) {
      return { requests: [], assets: [], handoffs: [], events: [], models: [] }
    }
    const [requests, events, models] = await Promise.all([
      dataOrThrow(supabase.from('content_requests').select('*')
        .eq('organization_id', organizationId).eq('mode', 'project')
        .eq('engagement_id', engagement.id).order('created_at', { ascending: false }), options),
      dataOrThrow(supabase.from('external_events').select('*')
        .eq('organization_id', organizationId).eq('brand_id', engagement.brand_id).order('start_date'), options),
      dataOrThrow(supabase.from('design_model_registry').select('*')
        .eq('is_active', true).contains('supported_output_types', ['image']).order('display_name'), options),
    ])
    const requestIds = requests.map(request => request.id)
    const [scopedAssets, handoffs] = requestIds.length
      ? await Promise.all([
          dataOrThrow(supabase.from('design_media_assets').select('*')
            .eq('organization_id', organizationId).in('content_request_id', requestIds)
            .order('created_at', { ascending: false }), options),
          dataOrThrow(supabase.from('content_request_assets').select('id, content_request_id, figma_handoff_url, created_at')
            .eq('organization_id', organizationId).in('content_request_id', requestIds)
            .not('figma_handoff_url', 'is', null).order('created_at'), options),
        ])
      : [[], []]
    const readyIds = scopedAssets.filter(asset => asset.media_type === 'image' && asset.status === 'ready')
      .map(asset => asset.id)
    const signed = readyIds.length
      ? await invoke(organizationId, 'design-workshop', 'sign_media_assets', { asset_ids: readyIds }, options)
      : { signed_urls: {} }
    return {
      requests,
      events,
      models,
      handoffs,
      assets: scopedAssets.map(asset => ({
        ...asset,
        signed_url: signed?.signed_urls?.[asset.id] || null,
      })),
    }
  },

  create: input => invoke(organizationId, 'content-studio', 'create_content_request', input, options),
  ensureFigmaHandoff: contentRequestId => invoke(organizationId, 'content-studio', 'ensure_figma_handoff', {
    content_request_id: contentRequestId,
  }, options),
  generateImage: (contentRequestId, modelRegistryId, prompt) => invoke(
    organizationId, 'design-workshop', 'generate_content_request_image', {
      content_request_id: contentRequestId,
      model_registry_id: modelRegistryId,
      prompt,
    }, options),
  createVideoPlaceholder: (contentRequestId, prompt) => invoke(
    organizationId, 'design-workshop', 'create_content_request_video_placeholder', {
      content_request_id: contentRequestId,
      prompt,
    }, options),
  })
}

export const contentRequests = Object.freeze({
  forOrganization: createContentRequestsScope,
})
