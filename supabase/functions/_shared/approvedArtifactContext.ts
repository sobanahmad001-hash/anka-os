type Json = Record<string, unknown>
type AdminClient = { from: (table: string) => any }

export function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Json).sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(',')}}`
  }
  return JSON.stringify(value)
}

export async function compileApprovedArtifactContext(admin: AdminClient, input: {
  organizationId: string
  brandId: string
  artifactTypes: string[]
  engagementId?: string | null
  requireAiSafe?: boolean
}) {
  let artifactQuery = admin.from('artifacts').select('*')
    .eq('organization_id', input.organizationId)
    .eq('brand_id', input.brandId)
    .in('artifact_type', input.artifactTypes)
  if (input.engagementId) artifactQuery = artifactQuery.eq('engagement_id', input.engagementId)
  const { data: artifacts, error: artifactError } = await artifactQuery
  if (artifactError) throw artifactError

  const artifactIds = (artifacts || []).map((artifact: Json) => artifact.id)
  const { data: approvals, error: approvalError } = artifactIds.length
    ? await admin.from('artifact_approvals').select('*').in('artifact_id', artifactIds)
      .order('approved_at', { ascending: false })
    : { data: [], error: null }
  if (approvalError) throw approvalError

  const versionIds = (approvals || []).map((approval: Json) => approval.artifact_version_id)
  const { data: versions, error: versionError } = versionIds.length
    ? await admin.from('artifact_versions').select('*').in('id', versionIds)
    : { data: [], error: null }
  if (versionError) throw versionError

  const artifactById = new Map((artifacts || []).map((artifact: Json) => [artifact.id, artifact]))
  const versionById = new Map((versions || []).map((version: Json) => [version.id, version]))
  const selected: Array<{ artifact: Json; approval: Json; version: Json }> = []
  for (const artifactType of input.artifactTypes) {
    const approval = (approvals || []).find((candidate: Json) =>
      (artifactById.get(candidate.artifact_id) as Json | undefined)?.artifact_type === artifactType)
    const artifact = approval ? artifactById.get(approval.artifact_id) as Json | undefined : undefined
    const version = approval ? versionById.get(approval.artifact_version_id) as Json | undefined : undefined
    if (!artifact || !version) throw new Error(`Approved ${artifactType} context is required`)
    if (input.requireAiSafe && (!version.ai_use_allowed || version.data_classification === 'restricted')) {
      throw new Error(`Approved ${artifactType} context is not authorised for AI use`)
    }
    selected.push({ artifact, approval, version })
  }

  return {
    selected,
    manifest: {
      schema_version: 1,
      brand_id: input.brandId,
      ...(input.engagementId ? { engagement_id: input.engagementId } : {}),
      artifacts: Object.fromEntries(selected.map(({ artifact, approval, version }) => [artifact.artifact_type, {
        artifact_id: artifact.id,
        artifact_version_id: version.id,
        version_number: version.version_number,
        approval_id: approval.id,
        approved_at: approval.approved_at,
        content_checksum: version.content_checksum,
        content: version.content,
      }])),
    },
  }
}
