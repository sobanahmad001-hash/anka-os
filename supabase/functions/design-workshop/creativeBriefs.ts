import { stableJson } from '../_shared/approvedArtifactContext.ts'

type Json = Record<string, unknown>
type Client = any

export const CREATIVE_BRIEF_OUTPUTS = ['image', 'brand_identity', 'website', 'social'] as const

const REQUIRED: Record<string, string[]> = {
  image: ['title', 'purpose', 'audience', 'objective', 'placement_destination', 'requested_outputs'],
  brand_identity: ['title', 'purpose', 'audience', 'objective', 'requested_outputs', 'exclusions_constraints'],
  website: ['title', 'purpose', 'audience', 'objective', 'placement_destination', 'requested_outputs'],
  social: ['title', 'purpose', 'audience', 'objective', 'placement_destination', 'requested_outputs', 'rights_notes'],
}

function clean(value: unknown, max = 4000) {
  return typeof value === 'string' ? value.trim().slice(0, max) : ''
}

function stringList(value: unknown, maxItems = 20) {
  return Array.isArray(value) ? [...new Set(value.map(item => clean(item, 500)).filter(Boolean))].slice(0, maxItems) : []
}

export function normalizeCreativeBrief(value: unknown): Json {
  const input = value && typeof value === 'object' && !Array.isArray(value) ? value as Json : {}
  return {
    title: clean(input.title, 200), purpose: clean(input.purpose), output_type: clean(input.output_type, 80),
    audience: clean(input.audience), objective: clean(input.objective),
    placement_destination: clean(input.placement_destination), instructions: clean(input.instructions, 8000),
    exclusions_constraints: clean(input.exclusions_constraints, 8000), rights_notes: clean(input.rights_notes, 4000),
    requested_outputs: stringList(input.requested_outputs),
  }
}

export function validateCreativeBrief(value: unknown) {
  const content = normalizeCreativeBrief(value)
  const outputType = clean(content.output_type, 80)
  if (!CREATIVE_BRIEF_OUTPUTS.includes(outputType as typeof CREATIVE_BRIEF_OUTPUTS[number])) {
    return { valid: false, output_type: outputType, missing: ['supported output type'], unsupported: true }
  }
  const missing = REQUIRED[outputType].filter(field => Array.isArray(content[field])
    ? !(content[field] as unknown[]).length : !clean(content[field]))
  return { valid: missing.length === 0, output_type: outputType, missing, unsupported: false }
}

async function checksum(value: Json) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(stableJson(value)))
  return [...new Uint8Array(bytes)].map(byte => byte.toString(16).padStart(2, '0')).join('')
}

function id(value: unknown, label: string) {
  const result = clean(value, 80)
  if (!result) throw new Error(`${label} is required`)
  return result
}

function expectedRevision(value: unknown) {
  const revision = Number(value)
  if (!Number.isInteger(revision) || revision < 0) throw new Error('Expected revision must be a non-negative integer')
  return revision
}

function related(value: unknown): Json | null {
  if (Array.isArray(value)) return value[0] && typeof value[0] === 'object' ? value[0] as Json : null
  return value && typeof value === 'object' ? value as Json : null
}

export function validateIdentityReferenceRows(
  sourceRows: Json[], approvalRows: Json[], organizationId: string, brandId: string | null,
) {
  const identityRows = sourceRows.filter(row => related(row.artifacts)?.artifact_type === 'design_system')
  if (!identityRows.length) return []
  if (!brandId) throw new Error('Approved identity references require an official brand context')
  const approvedIds = new Set(approvalRows
    .filter(row => row.organization_id === organizationId)
    .map(row => String(row.artifact_version_id || '')))
  for (const row of identityRows) {
    const artifact = related(row.artifacts)
    if (row.organization_id !== organizationId || artifact?.organization_id !== organizationId
      || artifact?.brand_id !== brandId || !approvedIds.has(String(row.id))) {
      throw new Error('Identity references must be approved Design System versions from this brand')
    }
  }
  return identityRows.map(row => String(row.id))
}

export async function saveCreativeBrief(admin: Client, userClient: Client, body: Json, actorId: string) {
  const content = normalizeCreativeBrief(body.content)
  if (!clean(content.title, 200)) throw new Error('A title is required to save a creative brief')
  const visibility = clean(body.visibility, 20) || 'official'
  const engagementId = visibility === 'official' ? id(body.engagement_id, 'Engagement') : null
  const brandId = visibility === 'official' ? id(body.brand_id, 'Brand') : null
  const serviceId = visibility === 'official' ? id(body.engagement_service_id, 'Design service') : null
  const projectTaskId = clean(body.project_task_id, 80) || null
  const engagementWorkItemId = clean(body.engagement_work_item_id, 80) || null
  if (projectTaskId && engagementWorkItemId) throw new Error('A creative brief can target a task or work item, not both')
  if (visibility === 'official') {
    const { data: engagement } = await admin.from('engagements').select('id').eq('id', engagementId)
      .eq('organization_id', admin.organizationId).eq('brand_id', brandId).maybeSingle()
    const { data: service } = await admin.from('engagement_services')
      .select('id, service_catalog!inner(department_id, is_active)').eq('id', serviceId)
      .eq('organization_id', admin.organizationId).eq('engagement_id', engagementId).eq('status', 'active').maybeSingle()
    const catalog = Array.isArray(service?.service_catalog) ? service.service_catalog[0] : service?.service_catalog
    if (!engagement || !service || catalog?.department_id !== 'design' || catalog?.is_active === false) {
      throw new Error('Creative brief requires its active Design engagement, brand, and service')
    }
  } else if (visibility !== 'private') throw new Error('Unsupported creative brief visibility')
  const sourceIds = stringList(body.source_version_ids, 50)
  if (sourceIds.length) {
    const { data, error } = await userClient.from('artifact_versions')
      .select('id, organization_id, artifact_id, artifacts!inner(artifact_type, brand_id, organization_id)').in('id', sourceIds)
    if (error || data?.length !== sourceIds.length || data.some((row: Json) => row.organization_id !== admin.organizationId)) {
      throw new Error('One or more pinned source versions are unavailable')
    }
    const identityIds = (data as Json[]).filter(row => related(row.artifacts)?.artifact_type === 'design_system')
      .map(row => String(row.id))
    const approvals = identityIds.length
      ? await userClient.from('artifact_approvals').select('artifact_version_id, organization_id')
        .eq('organization_id', admin.organizationId).in('artifact_version_id', identityIds)
      : { data: [], error: null }
    if (approvals.error) throw new Error('Approved identity references could not be verified')
    validateIdentityReferenceRows(data as Json[], (approvals.data || []) as Json[], admin.organizationId, brandId)
  }
  const validation = validateCreativeBrief(content)
  const { data, error } = await admin.rpc('save_design_creative_brief_version', {
    p_organization_id: admin.organizationId, p_actor_id: actorId,
    p_creative_brief_id: clean(body.creative_brief_id, 80) || null,
    p_visibility: visibility, p_engagement_id: engagementId, p_brand_id: brandId,
    p_engagement_service_id: serviceId,
    p_project_task_id: projectTaskId,
    p_engagement_work_item_id: engagementWorkItemId,
    p_expected_revision: expectedRevision(body.expected_revision),
    p_operation_key: id(body.operation_key, 'Operation key'), p_content: content,
    p_content_checksum: await checksum(content), p_validation_snapshot: validation,
    p_source_version_ids: sourceIds,
  })
  if (error) throw error
  return data
}

export async function freezeCreativeBrief(admin: Client, body: Json, actorId: string) {
  const { data, error } = await admin.rpc('freeze_design_creative_brief_version', {
    p_organization_id: admin.organizationId, p_actor_id: actorId,
    p_creative_brief_id: id(body.creative_brief_id, 'Creative brief'),
    p_creative_brief_version_id: id(body.creative_brief_version_id, 'Creative brief version'),
    p_expected_revision: expectedRevision(body.expected_revision),
    p_operation_key: id(body.operation_key, 'Operation key'),
  })
  if (error) throw error
  return data
}

export async function setWorkingDirection(admin: Client, body: Json, actorId: string) {
  const { data, error } = await admin.rpc('set_design_working_direction_preference', {
    p_organization_id: admin.organizationId, p_actor_id: actorId,
    p_engagement_id: id(body.engagement_id, 'Engagement'),
    p_session_id: id(body.session_id, 'Session'),
    p_direction_version_id: id(body.direction_version_id, 'Direction version'),
    p_expected_revision: expectedRevision(body.expected_revision),
    p_operation_key: id(body.operation_key, 'Operation key'),
  })
  if (error) throw error
  return data
}
