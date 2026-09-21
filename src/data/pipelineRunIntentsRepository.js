function requiredId(value, label) {
  if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    throw new TypeError(`${label} must be a UUID`)
  }
  return value
}

async function dataOrThrow(query, signal) {
  if (signal && typeof query.abortSignal === 'function') query = query.abortSignal(signal)
  const { data, error } = await query
  if (error) throw new Error(error.message || 'Pipeline run request failed')
  return data
}

export function createPipelineRunIntentsRepository(supabase) {
  if (!supabase?.from || !supabase?.rpc) throw new TypeError('A Supabase-compatible client is required')
  return Object.freeze({
    list(organizationId, engagementId, { signal } = {}) {
      return dataOrThrow(supabase.from('pipeline_run_intents')
        .select('id, request_id, status, input_sha256, input_manifest, requested_at, requested_by')
        .eq('organization_id', requiredId(organizationId, 'Organization'))
        .eq('engagement_id', requiredId(engagementId, 'Engagement'))
        .order('requested_at', { ascending: false }).limit(20), signal)
    },
    start({ organizationId, engagementId, requestId, assetIds = [] }, { signal } = {}) {
      if (!Array.isArray(assetIds) || assetIds.length > 20 || new Set(assetIds).size !== assetIds.length) {
        throw new TypeError('Choose at most 20 unique assets')
      }
      return dataOrThrow(supabase.rpc('start_pipeline_run_intent', {
        p_organization_id: requiredId(organizationId, 'Organization'),
        p_engagement_id: requiredId(engagementId, 'Engagement'),
        p_request_id: requiredId(requestId, 'Request'),
        p_asset_ids: assetIds.map(id => requiredId(id, 'Asset')),
      }), signal)
    },
  })
}
