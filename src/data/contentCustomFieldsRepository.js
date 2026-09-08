import { supabase } from '../lib/supabase.js'

async function dataOrThrow(query, { signal } = {}) {
  if (signal && typeof query.abortSignal === 'function') query = query.abortSignal(signal)
  const { data, error } = await query
  if (error) throw Object.assign(new Error(error.message || 'Content custom field query failed'), {
    status: error.status || error.statusCode,
  })
  return data
}

async function invoke(organizationId, action, input = {}, { signal } = {}) {
  const { data, error } = await supabase.functions.invoke('content-studio', {
    body: { ...input, action, organization_id: organizationId }, signal,
  })
  if (error) throw Object.assign(new Error(error.message || 'Content custom field function failed'), {
    status: error.status || error.statusCode || error.context?.status,
  })
  if (data?.error) throw new Error(data.error)
  return data?.data
}

export function createContentCustomFieldsScope(organizationId, { signal } = {}) {
  if (!organizationId) throw new TypeError('Active organization is required')
  const options = { signal }
  return Object.freeze({
  organizationId,
  listDefinitions: artifactType => dataOrThrow((artifactType
    ? supabase.from('artifact_custom_field_defs').select('*').eq('organization_id', organizationId).eq('artifact_type', artifactType)
    : supabase.from('artifact_custom_field_defs').select('*').eq('organization_id', organizationId))
    .order('artifact_type').order('created_at'), options),

  listValues: artifactVersionId => dataOrThrow(supabase.from('artifact_custom_field_values')
    .select('*').eq('organization_id', organizationId).eq('artifact_version_id', artifactVersionId), options),

  createDefinition: input => invoke(organizationId, 'create_custom_field_definition', input, options),

  saveValue: (artifactVersionId, fieldDefId, value) => invoke(organizationId, 'save_custom_field_value', {
    artifact_version_id: artifactVersionId, field_def_id: fieldDefId, value,
  }, options),
  })
}

export const contentCustomFields = Object.freeze({
  forOrganization: createContentCustomFieldsScope,
})
