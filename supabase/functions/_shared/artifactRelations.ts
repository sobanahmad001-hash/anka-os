type Json = Record<string, unknown>
type SupabaseClient = { from: (table: string) => any }

export const ARTIFACT_RELATION_TYPES = new Set([
  'feeds_into', 'derived_from', 'referenced_by', 'targets_page',
])

function text(value: unknown, max = 240) {
  return typeof value === 'string' ? value.trim().slice(0, max) : ''
}

export function relationInput(input: Json) {
  const sourceArtifactId = text(input.source_artifact_id, 80)
  const targetArtifactId = text(input.target_artifact_id, 80)
  const relationType = text(input.relation_type, 40)
  if (!sourceArtifactId || !targetArtifactId) throw new Error('Select both relation artifacts')
  if (sourceArtifactId === targetArtifactId) throw new Error('An artifact cannot relate to itself')
  if (!ARTIFACT_RELATION_TYPES.has(relationType)) throw new Error('Unsupported relation type')
  return { sourceArtifactId, targetArtifactId, relationType }
}

export async function loadReadablePair(
  userClient: SupabaseClient,
  sourceArtifactId: string,
  targetArtifactId: string,
) {
  const { data, error } = await userClient.from('artifacts')
    .select('id, organization_id, title, artifact_type, engagement_id')
    .in('id', [sourceArtifactId, targetArtifactId])
  if (error) throw error
  const rows = data || []
  const source = rows.find((artifact: Json) => artifact.id === sourceArtifactId)
  const target = rows.find((artifact: Json) => artifact.id === targetArtifactId)
  if (!source || !target) {
    throw Object.assign(new Error('Both artifacts must be visible before they can be related'), { status: 404 })
  }
  if (source.organization_id !== target.organization_id) {
    throw Object.assign(new Error('Artifacts must belong to the same organization'), { status: 409 })
  }
  return { source, target, organizationId: String(source.organization_id) }
}

export async function requireRelationTeamMembership(
  admin: SupabaseClient,
  organizationId: string,
  userId: string,
) {
  const { data, error } = await admin.from('organization_memberships')
    .select('id')
    .eq('organization_id', organizationId)
    .eq('user_id', userId)
    .eq('member_kind', 'team')
    .eq('status', 'active')
    .maybeSingle()
  if (error || !data) throw Object.assign(new Error('Active team membership required'), { status: 403 })
}

export async function createArtifactRelation(
  userClient: SupabaseClient,
  admin: SupabaseClient,
  input: Json,
  actorId: string,
  options: { allowExisting?: boolean } = {},
) {
  const relation = relationInput(input)
  const pair = await loadReadablePair(userClient, relation.sourceArtifactId, relation.targetArtifactId)
  await requireRelationTeamMembership(admin, pair.organizationId, actorId)

  if (options.allowExisting) {
    const { data: existing, error: existingError } = await admin.from('artifact_relations')
      .select('*')
      .eq('source_artifact_id', relation.sourceArtifactId)
      .eq('target_artifact_id', relation.targetArtifactId)
      .eq('relation_type', relation.relationType)
      .maybeSingle()
    if (existingError) throw existingError
    if (existing) return existing
  }

  const { data, error } = await admin.from('artifact_relations').insert({
    organization_id: pair.organizationId,
    source_artifact_id: relation.sourceArtifactId,
    target_artifact_id: relation.targetArtifactId,
    relation_type: relation.relationType,
    created_by: actorId,
  }).select('*').single()
  if (error) throw error
  return data
}
