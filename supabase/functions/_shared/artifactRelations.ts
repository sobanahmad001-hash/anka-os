type Json = Record<string, unknown>
type SupabaseClient = { from: (table: string) => any }

type ResolvedPair = {
  source: Json
  target: Json | null
  targetKind: 'artifact' | 'content_request'
  organizationId: string
}

export const ARTIFACT_RELATION_TYPES = new Set([
  'feeds_into', 'derived_from', 'referenced_by', 'targets_page',
])

function text(value: unknown, max = 240) {
  return typeof value === 'string' ? value.trim().slice(0, max) : ''
}

export function relationInput(input: Json) {
  const sourceArtifactId = text(input.source_artifact_id, 80)
  const targetArtifactId = text(input.target_artifact_id, 80)
  const targetContentRequestId = text(input.target_content_request_id, 80)
  const relationType = text(input.relation_type, 40)
  if (!sourceArtifactId || (!targetArtifactId && !targetContentRequestId)) {
    throw new Error('Select a source artifact and a relation target')
  }
  if (targetArtifactId && targetContentRequestId) {
    throw new Error('Select either an artifact target or a content-request target')
  }
  if (sourceArtifactId === targetArtifactId) {
    throw new Error('An artifact cannot relate to itself')
  }
  if (!ARTIFACT_RELATION_TYPES.has(relationType)) throw new Error('Unsupported relation type')
  return {
    sourceArtifactId,
    targetArtifactId: targetArtifactId || null,
    targetContentRequestId: targetContentRequestId || null,
    relationType,
}

async function loadReadableArtifactPair(userClient: SupabaseClient, sourceArtifactId: string, targetArtifactId: string) {
  const { data, error } = await userClient.from('artifacts')
    .select('id, organization_id, title, artifact_type, engagement_id')
    .in('id', [sourceArtifactId, targetArtifactId])
  if (error) throw error
  const rows = data || []
  const source = rows.find((artifact: Json) => artifact.id === sourceArtifactId)
  const target = rows.find((artifact: Json) => artifact.id === targetArtifactId)
  return { source, target }
}

async function loadReadableRequestTarget(userClient: SupabaseClient, targetContentRequestId: string) {
  const { data, error } = await userClient.from('content_requests')
    .select('id, organization_id, status, format')
    .eq('id', targetContentRequestId).maybeSingle()
  if (error) throw error
  return data || null
}

export async function loadReadablePair(
  userClient: SupabaseClient,
  sourceArtifactId: string,
  targetArtifactId?: string,
  targetContentRequestId?: string,
): Promise<ResolvedPair> {
  const { data, error } = await userClient.from('artifacts')
    .select('id, organization_id, title, artifact_type, engagement_id')
    .eq('id', sourceArtifactId).maybeSingle()
  if (error || !data) {
    throw Object.assign(new Error('Source artifact is unavailable'), { status: 404 })
  }

  if (targetArtifactId && targetContentRequestId) {
    throw Object.assign(new Error('A relation can target only one object'), { status: 409 })
  }

  if (targetArtifactId) {
    const { source, target } = await loadReadableArtifactPair(userClient, sourceArtifactId, targetArtifactId)
    if (!source || !target) {
      throw Object.assign(new Error('Both artifacts must be visible before they can be related'), { status: 404 })
    }
    if (source.organization_id !== target.organization_id) {
      throw Object.assign(new Error('Artifacts must belong to the same organization'), { status: 409 })
    }
    return {
      source,
      target,
      targetKind: 'artifact',
      organizationId: String(source.organization_id),
    }
  }

  if (!targetContentRequestId) {
    throw Object.assign(new Error('Select a valid target artifact or request'), { status: 400 })
  }

  const target = await loadReadableRequestTarget(userClient, targetContentRequestId)
  if (!target || String(target.organization_id) !== String(data.organization_id)) {
    throw Object.assign(new Error('Content request is unavailable'), { status: 404 })
  }

  return {
    source: data,
    target,
    targetKind: 'content_request',
    organizationId: String(data.organization_id),
  }
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

export async function requireReleasedDesignSystemTarget(admin: SupabaseClient, target: Json) {
  if (target.artifact_type !== 'design_system') return
  const { data, error } = await admin.from('artifact_approvals')
    .select('id')
    .eq('artifact_id', target.id)
    .limit(1)
    .maybeSingle()
  if (error) throw error
  if (!data) throw Object.assign(new Error('Only a released Design System can be linked'), { status: 409 })
}

export async function createArtifactRelation(
  userClient: SupabaseClient,
  admin: SupabaseClient,
  input: Json,
  actorId: string,
  options: { allowExisting?: boolean } = {},
) {
  const relation = relationInput(input)
  const pair = await loadReadablePair(
    userClient,
    relation.sourceArtifactId,
    relation.targetArtifactId || undefined,
    relation.targetContentRequestId || undefined,
  )
  await requireRelationTeamMembership(admin, pair.organizationId, actorId)
  if (pair.targetKind === 'artifact') {
    await requireReleasedDesignSystemTarget(admin, pair.target)
  }

  if (options.allowExisting) {
    let query = admin.from('artifact_relations')
      .select('*')
      .eq('source_artifact_id', relation.sourceArtifactId)
      .eq('relation_type', relation.relationType)
    if (relation.targetArtifactId) {
      query = query.eq('target_artifact_id', relation.targetArtifactId)
    } else {
      query = query.eq('target_content_request_id', relation.targetContentRequestId)
    }
    const { data, error } = await query.maybeSingle()
    if (error) throw error
    if (data) return data
  }

  const { data, error } = await admin.from('artifact_relations').insert({
    organization_id: pair.organizationId,
    source_artifact_id: relation.sourceArtifactId,
    target_artifact_id: relation.targetArtifactId || null,
    target_content_request_id: relation.targetContentRequestId || null,
    relation_type: relation.relationType,
    created_by: actorId,
  }).select('*').single()
  if (error) throw error
  return data
}
