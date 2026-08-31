import { supabase } from '../lib/supabase.js'

async function dataOrThrow(query) {
  const { data, error } = await query
  if (error) throw new Error(error.message || 'Content request query failed')
  return data
}

async function invoke(functionName, action, input = {}) {
  const { data, error } = await supabase.functions.invoke(functionName, { body: { action, ...input } })
  if (error) throw new Error(error.message || 'Content request action failed')
  if (data?.error) throw new Error(data.error)
  return data?.data
}

export const contentRequests = Object.freeze({
  async loadGeneral() {
    // CP1's RLS policy limits both reads to the caller's active organization.
    const [requests, brands] = await Promise.all([
      dataOrThrow(supabase.from('content_requests')
        .select('id, organization_id, brand_id, mode, output_path, format, brief, status, created_at')
        .eq('mode', 'general').order('created_at', { ascending: false })),
      dataOrThrow(supabase.from('brands')
        .select('id, organization_id, name, status').eq('status', 'active').order('name')),
    ])
    return { requests, brands }
  },

  async loadProject(engagement) {
    if (!engagement?.id || !engagement?.brand_id) return { requests: [], assets: [], events: [], models: [] }
    const [requests, events, models] = await Promise.all([
      dataOrThrow(supabase.from('content_requests').select('*')
        .eq('mode', 'project').eq('engagement_id', engagement.id).order('created_at', { ascending: false })),
      dataOrThrow(supabase.from('external_events').select('*')
        .eq('brand_id', engagement.brand_id).order('start_date')),
      dataOrThrow(supabase.from('design_model_registry').select('*')
        .eq('is_active', true).contains('supported_output_types', ['image']).order('display_name')),
    ])
    const requestIds = requests.map(request => request.id)
    const scopedAssets = requestIds.length
      ? await dataOrThrow(supabase.from('design_media_assets').select('*')
          .in('content_request_id', requestIds).order('created_at', { ascending: false }))
      : []
    const readyIds = scopedAssets.filter(asset => asset.media_type === 'image' && asset.status === 'ready')
      .map(asset => asset.id)
    const signed = readyIds.length
      ? await invoke('design-workshop', 'sign_media_assets', { asset_ids: readyIds })
      : { signed_urls: {} }
    return {
      requests,
      events,
      models,
      assets: scopedAssets.map(asset => ({
        ...asset,
        signed_url: signed?.signed_urls?.[asset.id] || null,
      })),
    }
  },

  create: input => invoke('content-studio', 'create_content_request', input),
  generateImage: (contentRequestId, modelRegistryId, prompt) => invoke(
    'design-workshop', 'generate_content_request_image', {
      content_request_id: contentRequestId,
      model_registry_id: modelRegistryId,
      prompt,
    }),
  createVideoPlaceholder: (contentRequestId, prompt) => invoke(
    'design-workshop', 'create_content_request_video_placeholder', {
      content_request_id: contentRequestId,
      prompt,
    }),
})
