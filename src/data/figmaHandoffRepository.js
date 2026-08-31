import { supabase } from '../lib/supabase.js'

async function dataOrThrow(query) {
  const { data, error } = await query
  if (error) throw new Error(error.message || 'Figma handoff query failed')
  return data
}

async function invoke(functionName, action, input = {}) {
  const { data, error } = await supabase.functions.invoke(functionName, { body: { action, ...input } })
  if (error) throw new Error(error.message || 'Figma handoff action failed')
  if (data?.error) throw new Error(data.error)
  return data?.data
}

export const figmaHandoff = Object.freeze({
  async load(requestId) {
    const request = await dataOrThrow(supabase.from('content_requests').select('*')
      .eq('id', requestId).eq('output_path', 'figma_handoff').single())
    const scope = query => query.eq('organization_id', request.organization_id)
    const [brand, event, recentRequests, currentAssets, handoffAsset] = await Promise.all([
      request.brand_id
        ? dataOrThrow(scope(supabase.from('brands').select('id, name, description, website_url, status'))
            .eq('id', request.brand_id).single())
        : Promise.resolve(null),
      request.linked_event_id
        ? dataOrThrow(scope(supabase.from('external_events').select('id, event_name, event_category, start_date, end_date, location, notes'))
            .eq('id', request.linked_event_id).maybeSingle())
        : Promise.resolve(null),
      request.brand_id
        ? dataOrThrow(scope(supabase.from('content_requests').select('id, engagement_id, brand_id, format, brief, output_path, status, created_at'))
            .eq('brand_id', request.brand_id).neq('id', request.id)
            .order('created_at', { ascending: false }).limit(6))
        : Promise.resolve([]),
      dataOrThrow(scope(supabase.from('design_media_assets').select('id, content_request_id, media_type, status, storage_path, failure_reason, created_at'))
        .eq('content_request_id', request.id).order('created_at', { ascending: false })),
      dataOrThrow(scope(supabase.from('content_request_assets').select('id, content_request_id, figma_handoff_url, created_at'))
        .eq('content_request_id', request.id).not('figma_handoff_url', 'is', null)
        .order('created_at').limit(1).maybeSingle()),
    ])
    const recentIds = recentRequests.map(item => item.id)
    const recentAssets = recentIds.length
      ? await dataOrThrow(scope(supabase.from('design_media_assets').select('id, content_request_id, media_type, status, storage_path, failure_reason, created_at'))
          .in('content_request_id', recentIds).order('created_at', { ascending: false }))
      : []
    const readyIds = [...currentAssets, ...recentAssets]
      .filter(asset => asset.media_type === 'image' && asset.status === 'ready')
      .map(asset => asset.id)
    const signed = readyIds.length
      ? await invoke('design-workshop', 'sign_media_assets', { asset_ids: readyIds })
      : { signed_urls: {} }
    const withUrls = assets => assets.map(asset => ({
      ...asset,
      signed_url: signed?.signed_urls?.[asset.id] || null,
    }))
    return {
      request,
      brand,
      event,
      recentRequests,
      currentAssets: withUrls(currentAssets),
      recentAssets: withUrls(recentAssets),
      handoffAsset,
    }
  },
})
