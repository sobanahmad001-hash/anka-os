import { supabase } from '../lib/supabase.js'

async function dataOrThrow(query) {
  const { data, error } = await query
  if (error) throw new Error(error.message || 'Artifact relation query failed')
  return data
}

async function invoke(action, input = {}) {
  const { data, error } = await supabase.functions.invoke('artifact-relations', {
    body: { action, ...input },
  })
  if (error) throw new Error(error.message || 'Artifact relation action failed')
  if (data?.error) throw new Error(data.error)
  return data?.data
}

const relationSelect = `
  id, organization_id, source_artifact_id, target_artifact_id, relation_type, created_by, created_at,
  source:artifacts!artifact_relations_source_artifact_fkey(id, title, artifact_type, engagement_id),
  target:artifacts!artifact_relations_target_artifact_fkey(id, title, artifact_type, engagement_id)
`

export const artifactRelations = Object.freeze({
  getArtifact: artifactId => dataOrThrow(supabase.from('artifacts')
    .select('id, organization_id, brand_id, engagement_id, engagement_stage_instance_id, artifact_type, title, created_by, created_at')
    .eq('id', artifactId).single()),

  list: artifactId => dataOrThrow(supabase.from('artifact_relations')
    .select(relationSelect)
    .or(`source_artifact_id.eq.${artifactId},target_artifact_id.eq.${artifactId}`)
    .order('created_at')),

  candidates: artifact => dataOrThrow(supabase.from('artifacts')
    .select('id, organization_id, title, artifact_type, engagement_id')
    .eq('organization_id', artifact.organization_id)
    .neq('id', artifact.id)
    .order('title')
    .limit(250)),

  create: (sourceArtifactId, targetArtifactId, relationType) => invoke('create_relation', {
    source_artifact_id: sourceArtifactId,
    target_artifact_id: targetArtifactId,
    relation_type: relationType,
  }),

  remove: relationId => invoke('delete_relation', { relation_id: relationId }),
})
