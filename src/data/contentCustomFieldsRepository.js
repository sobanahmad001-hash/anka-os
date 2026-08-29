import { supabase } from '../lib/supabase.js'

async function dataOrThrow(query) {
  const { data, error } = await query
  if (error) throw new Error(error.message || 'Content custom field query failed')
  return data
}

async function invoke(action, input = {}) {
  const { data, error } = await supabase.functions.invoke('content-studio', {
    body: { action, ...input },
  })
  if (error) throw new Error(error.message || 'Content custom field function failed')
  if (data?.error) throw new Error(data.error)
  return data?.data
}

export const contentCustomFields = Object.freeze({
  listDefinitions: artifactType => dataOrThrow((artifactType
    ? supabase.from('artifact_custom_field_defs').select('*').eq('artifact_type', artifactType)
    : supabase.from('artifact_custom_field_defs').select('*'))
    .order('artifact_type').order('created_at')),

  listValues: artifactVersionId => dataOrThrow(supabase.from('artifact_custom_field_values')
    .select('*').eq('artifact_version_id', artifactVersionId)),

  createDefinition: input => invoke('create_custom_field_definition', input),

  saveValue: (artifactVersionId, fieldDefId, value) => invoke('save_custom_field_value', {
    artifact_version_id: artifactVersionId, field_def_id: fieldDefId, value,
  }),
})
