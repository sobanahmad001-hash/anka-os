import { stableJson } from '../_shared/approvedArtifactContext.ts'

type Json = Record<string, unknown>
type Client = any

export const PACKAGE_DESTINATIONS = ['website', 'social'] as const

function clean(value: unknown, max = 4000) {
  return typeof value === 'string' ? value.trim().slice(0, max) : ''
}

function positiveInteger(value: unknown) {
  const number = Number(value)
  return Number.isInteger(number) && number > 0 ? number : 0
}

function ids(value: unknown) {
  return Array.isArray(value)
    ? [...new Set(value.map(item => clean(item, 80)).filter(Boolean))].slice(0, 50)
    : []
}

function related(value: unknown): Json | null {
  const candidate = Array.isArray(value) ? value[0] : value
  return candidate && typeof candidate === 'object' ? candidate as Json : null
}

export function normalizeDeliveryPackage(value: unknown): Json {
  const input = value && typeof value === 'object' && !Array.isArray(value) ? value as Json : {}
  const destinationType = clean(input.destination_type, 30)
  return {
    schema_version: 1,
    destination_type: destinationType,
    placement_label: clean(input.placement_label, 240),
    placement_description: clean(input.placement_description, 2000),
    website_page_section: destinationType === 'website' ? clean(input.website_page_section, 500) : '',
    social_platform: destinationType === 'social' ? clean(input.social_platform, 120) : '',
    width: positiveInteger(input.width),
    height: positiveInteger(input.height),
    usage_instructions: clean(input.usage_instructions, 4000),
    export_guidance: clean(input.export_guidance, 2000),
  }
}

export function validateDeliveryPackage(value: unknown, selectedVersionIds: unknown) {
  const content = normalizeDeliveryPackage(value)
  const selected = ids(selectedVersionIds)
  const missing: string[] = []
  if (!PACKAGE_DESTINATIONS.includes(content.destination_type as typeof PACKAGE_DESTINATIONS[number])) missing.push('destination type')
  if (!content.placement_label) missing.push('placement label')
  if (content.destination_type === 'website' && !content.website_page_section) missing.push('website page or section')
  if (content.destination_type === 'social' && !content.social_platform) missing.push('social platform or custom placement')
  if (!content.width || !content.height) missing.push('positive dimensions')
  if (!content.usage_instructions) missing.push('usage instructions')
  if (!selected.length) missing.push('at least one exact asset version')
  return { valid: missing.length === 0, missing, content, selected_version_ids: selected }
}

async function checksum(value: unknown) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(stableJson(value)))
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('')
}

function required(value: unknown, label: string) {
  const result = clean(value, 80)
  if (!result) throw new Error(`${label} is required`)
  return result
}

function expectedVersion(value: unknown) {
  const result = clean(value, 80)
  return result || null
}

function exactWork(body: Json) {
  const projectTaskId = clean(body.project_task_id, 80) || null
  const engagementWorkItemId = clean(body.engagement_work_item_id, 80) || null
  if ((projectTaskId ? 1 : 0) + (engagementWorkItemId ? 1 : 0) !== 1) {
    throw new Error('Select exactly one existing project task or engagement work item')
  }
  return { projectTaskId, engagementWorkItemId }
}

async function validateExistingWork(client: Client, organizationId: string, engagementId: string,
  brandId: string, work: { projectTaskId: string | null; engagementWorkItemId: string | null }) {
  const { data: engagement, error: engagementError } = await client.from('engagements')
    .select('id, project_id').eq('id', engagementId).eq('organization_id', organizationId)
    .eq('brand_id', brandId).eq('status', 'active').maybeSingle()
  if (engagementError || !engagement?.project_id) throw new Error('The active engagement work context is unavailable')
  const query = work.projectTaskId
    ? client.from('tasks').select('id').eq('id', work.projectTaskId).eq('organization_id', organizationId)
      .eq('project_id', engagement.project_id).is('archived_at', null)
    : client.from('work_items').select('id').eq('id', work.engagementWorkItemId).eq('organization_id', organizationId)
      .eq('project_id', engagement.project_id).eq('engagement_id', engagementId).is('deleted_at', null)
  const { data, error } = await query.maybeSingle()
  if (error || !data) throw new Error('The selected existing work record is unavailable or outside this engagement')
}

async function currentAssetVersions(client: Client, organizationId: string, engagementId: string,
  brandId: string, versionIds: string[]) {
  const { data, error } = await client.from('design_asset_versions')
    .select('id, organization_id, asset_id, version_number, storage_bucket, storage_path, mime_type, width, height, original_filename, design_assets!inner(engagement_id, brand_id, archived_at, name)')
    .eq('organization_id', organizationId).in('id', versionIds)
  if (error || data?.length !== versionIds.length) throw new Error('One or more exact Design asset versions are unavailable')
  const byId = new Map((data || []).map((row: Json) => [String(row.id), row]))
  const ordered = versionIds.map(id => byId.get(id)).filter(Boolean) as Json[]
  for (const version of ordered) {
    const asset = related(version.design_assets)
    if (!asset || asset.engagement_id !== engagementId || asset.brand_id !== brandId || asset.archived_at
      || version.storage_bucket !== 'design-generated-media' || !clean(version.storage_path, 1000)) {
      throw new Error('A selected Design version is missing, inactive, or outside this package context')
    }
  }
  return ordered
}

async function temporaryPreviews(admin: Client, versions: Json[]) {
  const paths = versions.map(version => String(version.storage_path))
  const { data, error } = await admin.storage.from('design-generated-media').createSignedUrls(paths, 300)
  if (error || data?.length !== paths.length || data.some((entry: Json) => !entry?.signedUrl || entry?.error)) {
    throw new Error('One or more selected Design objects are unavailable in private storage')
  }
  return versions.map((version, index) => ({
    id: version.id, asset_id: version.asset_id, version_number: version.version_number,
    mime_type: version.mime_type, width: version.width, height: version.height,
    original_filename: version.original_filename, preview_url: data[index].signedUrl,
  }))
}

async function validateDestinationService(admin: Client, organizationId: string, engagementId: string, body: Json) {
  const departmentId = clean(body.destination_department_id, 40) || null
  const serviceId = clean(body.destination_engagement_service_id, 80) || null
  if (!departmentId && !serviceId) return { departmentId: null, serviceId: null, blocked: true }
  if (!departmentId || !serviceId || !['content', 'marketing', 'development'].includes(departmentId)) {
    throw new Error('Downstream destination service selection is incomplete')
  }
  const { data, error } = await admin.from('engagement_services')
    .select('id, status, service_catalog!inner(department_id, is_active)')
    .eq('id', serviceId).eq('organization_id', organizationId).eq('engagement_id', engagementId)
    .eq('status', 'active').maybeSingle()
  const catalog = related(data?.service_catalog)
  if (error || !data || catalog?.department_id !== departmentId || catalog?.is_active !== true) {
    throw new Error('The selected downstream service is unavailable or inactive')
  }
  return { departmentId, serviceId, blocked: false }
}

export async function previewDeliveryPackage(admin: Client, userClient: Client, body: Json) {
  const organizationId = admin.organizationId
  const engagementId = required(body.engagement_id, 'Engagement')
  const brandId = required(body.brand_id, 'Brand')
  const work = exactWork(body)
  await validateExistingWork(userClient, organizationId, engagementId, brandId, work)
  const validation = validateDeliveryPackage(body.content, body.asset_version_ids)
  if (!validation.valid) throw new Error(`Package needs ${validation.missing.join(', ')}`)
  const versions = await currentAssetVersions(userClient, organizationId, engagementId, brandId, validation.selected_version_ids)
  const destination = await validateDestinationService(admin, organizationId, engagementId, body)
  return {
    content: validation.content,
    selected_versions: await temporaryPreviews(admin, versions),
    destination_status: destination.blocked ? 'planning_blocked' : 'active_existing_service',
    signed_url_expires_in: 300,
    effect: 'Preview only; no package, approval, release, publication, delivery, or work item was created.',
  }
}

export async function saveDeliveryPackage(admin: Client, userClient: Client, body: Json, actorId: string) {
  const organizationId = admin.organizationId
  const engagementId = required(body.engagement_id, 'Engagement')
  const brandId = required(body.brand_id, 'Brand')
  const sourceServiceId = required(body.source_engagement_service_id, 'Active Design service')
  const operationKey = required(body.operation_key, 'Stable operation key')
  const title = clean(body.title, 240)
  if (!title) throw new Error('Package title is required')
  const work = exactWork(body)
  await validateExistingWork(userClient, organizationId, engagementId, brandId, work)
  const validation = validateDeliveryPackage(body.content, body.asset_version_ids)
  if (!validation.valid) throw new Error(`Package needs ${validation.missing.join(', ')}`)
  const versions = await currentAssetVersions(userClient, organizationId, engagementId, brandId, validation.selected_version_ids)
  await temporaryPreviews(admin, versions)
  const destination = await validateDestinationService(admin, organizationId, engagementId, body)
  const request = {
    artifact_id: clean(body.artifact_id, 80) || null,
    expected_latest_version_id: expectedVersion(body.expected_latest_version_id),
    engagement_id: engagementId, brand_id: brandId, source_engagement_service_id: sourceServiceId,
    destination_department_id: destination.departmentId,
    destination_engagement_service_id: destination.serviceId,
    project_task_id: work.projectTaskId, engagement_work_item_id: work.engagementWorkItemId,
    title, content: validation.content, asset_version_ids: validation.selected_version_ids,
  }
  const { data, error } = await admin.rpc('save_design_delivery_package_version', {
    p_organization_id: organizationId, p_actor_id: actorId,
    p_artifact_id: request.artifact_id, p_engagement_id: engagementId, p_brand_id: brandId,
    p_source_engagement_service_id: sourceServiceId,
    p_destination_department_id: destination.departmentId,
    p_destination_engagement_service_id: destination.serviceId,
    p_project_task_id: work.projectTaskId, p_engagement_work_item_id: work.engagementWorkItemId,
    p_expected_latest_version_id: request.expected_latest_version_id,
    p_operation_key: operationKey, p_request_checksum: await checksum(request),
    p_title: title, p_content: validation.content, p_content_checksum: await checksum(validation.content),
    p_asset_version_ids: validation.selected_version_ids,
  })
  if (error) throw error
  return { ...data, destination_status: destination.blocked ? 'planning_blocked' : 'active_existing_service' }
}
