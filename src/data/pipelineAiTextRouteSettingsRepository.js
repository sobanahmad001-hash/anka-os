function requiredId(value, label) {
  if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    throw new TypeError(`${label} must be a UUID`)
  }
  return value
}

async function dataOrThrow(query, signal) {
  if (signal && typeof query.abortSignal === 'function') query = query.abortSignal(signal)
  const { data, error } = await query
  if (error) throw new Error(error.message || 'Pipeline route settings failed')
  return data
}

export function createPipelineAiTextRouteSettingsRepository(supabase) {
  if (!supabase?.rpc) throw new TypeError('A Supabase-compatible client is required')
  return Object.freeze({
    list(organizationId, { signal } = {}) {
      return dataOrThrow(supabase.rpc('list_pipeline_ai_text_route_settings', {
        p_organization_id: requiredId(organizationId, 'Organization'),
      }), signal)
    },
    save({ organizationId, departmentId, requestId, modelConfigurationIds }, { signal } = {}) {
      if (!['content', 'design', 'marketing'].includes(departmentId)) throw new TypeError('Invalid department')
      if (!Array.isArray(modelConfigurationIds) || modelConfigurationIds.length > 3
        || new Set(modelConfigurationIds).size !== modelConfigurationIds.length) {
        throw new TypeError('Choose up to three unique models')
      }
      return dataOrThrow(supabase.rpc('configure_pipeline_ai_text_routes', {
        p_organization_id: requiredId(organizationId, 'Organization'),
        p_department_id: departmentId,
        p_request_id: requiredId(requestId, 'Request'),
        p_model_configuration_ids: modelConfigurationIds.map(id => requiredId(id, 'Model configuration')),
      }), signal)
    },
  })
}