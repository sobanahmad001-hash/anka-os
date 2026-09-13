export const DESIGN_PACKAGE_DESTINATIONS = Object.freeze(['website', 'social'])

const clean = (value, max = 4000) => typeof value === 'string' ? value.trim().slice(0, max) : ''
const id = value => clean(typeof value === 'object' && value ? value.id : value, 240)

export function emptyDesignPackageDraft() {
  return {
    title: '', destination_type: 'website', placement_label: '', placement_description: '',
    website_page_section: '', social_platform: '', width: '', height: '',
    usage_instructions: '', export_guidance: '', destination_engagement_service_id: '',
    selected_version_ids: [], source_work_kind: '', source_work_id: '',
  }
}

export function designPackageDraftWork(draft, context) {
  const retainedKind = clean(draft?.source_work_kind, 40)
  const retainedId = id(draft?.source_work_id)
  if (retainedId && ['project_task', 'engagement_work_item'].includes(retainedKind)) {
    return { kind: retainedKind, id: retainedId, retained: true }
  }
  const currentKind = clean(context?.workRecord?.kind, 40)
  const currentId = id(context?.workRecord?.id)
  return currentId && ['project_task', 'engagement_work_item'].includes(currentKind)
    ? { kind: currentKind, id: currentId, retained: false }
    : null
}

export function designPackageTargetKey(context, draft, latestVersionId = '') {
  const work = designPackageDraftWork(draft, context)
  return JSON.stringify({
    organizationId: id(context?.organizationId), engagementId: id(context?.engagementId),
    brandId: id(context?.brandId), serviceId: id(context?.activeServiceId),
    workKind: clean(work?.kind, 40), workId: id(work?.id),
    packageId: id(draft?.artifact_id), latestVersionId: id(latestVersionId),
    destination: clean(draft?.destination_type, 30), placement: clean(draft?.placement_label, 240),
    page: clean(draft?.website_page_section, 500), platform: clean(draft?.social_platform, 120),
    width: Number(draft?.width) || 0, height: Number(draft?.height) || 0,
    usage: clean(draft?.usage_instructions), exportGuidance: clean(draft?.export_guidance, 2000),
    destinationServiceId: id(draft?.destination_engagement_service_id),
    versions: [...new Set((draft?.selected_version_ids || []).map(id).filter(Boolean))],
  })
}

export function isCurrentPackageResponse(responseSequence, currentSequence, responseTargetKey, currentTargetKey) {
  return responseSequence === currentSequence && responseTargetKey === currentTargetKey
}

export function validateDesignPackageDraft(draft, context) {
  const missing = []
  if (!clean(draft?.title, 240)) missing.push('package title')
  if (!DESIGN_PACKAGE_DESTINATIONS.includes(draft?.destination_type)) missing.push('website or social destination')
  if (!clean(draft?.placement_label, 240)) missing.push('placement label')
  if (draft?.destination_type === 'website' && !clean(draft?.website_page_section, 500)) missing.push('website page or section')
  if (draft?.destination_type === 'social' && !clean(draft?.social_platform, 120)) missing.push('social platform or custom placement')
  if (!Number.isInteger(Number(draft?.width)) || Number(draft.width) <= 0
    || !Number.isInteger(Number(draft?.height)) || Number(draft.height) <= 0) missing.push('positive pixel dimensions')
  if (!clean(draft?.usage_instructions)) missing.push('usage instructions')
  if (!(draft?.selected_version_ids || []).length) missing.push('at least one exact asset version')
  if (!designPackageDraftWork(draft, context)) {
    missing.push('existing typed work destination')
  }
  return { valid: missing.length === 0, missing }
}

export function activePackageDestinations(services = []) {
  return services.flatMap(service => {
    const catalog = Array.isArray(service.service_catalog) ? service.service_catalog[0] : service.service_catalog
    return service.status === 'active' && catalog?.is_active === true
      && ['content', 'marketing', 'development'].includes(catalog.department_id)
      ? [{ id: service.id, departmentId: catalog.department_id, label: `${catalog.name} · ${catalog.department_id}` }]
      : []
  })
}

export function packageReadState({ loading = false, error = null, denied = false, rows = [] } = {}) {
  if (loading) return 'loading'
  if (denied) return 'denied'
  if (error) return 'error'
  return rows.length ? 'ready' : 'empty'
}

export function packageVersionStatus(version, approvals = [], contexts = []) {
  if (approvals.some(item => item.artifact_version_id === version?.id)) return 'approved'
  const context = contexts.find(item => item.artifact_version_id === version?.id)
  return context ? 'draft' : 'unavailable'
}

function serviceCatalog(service) {
  return Array.isArray(service?.service_catalog) ? service.service_catalog[0] : service?.service_catalog
}

export function designPackageReviewEntries(workspace = {}) {
  const artifacts = workspace.deliveryPackageArtifacts || []
  const versions = workspace.deliveryPackageVersions || []
  const contexts = workspace.deliveryPackageContexts || []
  const references = workspace.deliveryPackageAssetReferences || []
  const approvals = workspace.approvals || []
  return versions.flatMap(version => {
    const artifact = artifacts.find(item => item.id === version.artifact_id)
    if (!artifact) return []
    return [{
      artifact,
      version,
      context: contexts.find(item => item.artifact_version_id === version.id) || null,
      references: references.filter(item => item.artifact_version_id === version.id)
        .sort((left, right) => left.position - right.position),
      approval: approvals.find(item => item.artifact_version_id === version.id) || null,
    }]
  }).sort((left, right) => {
    const time = new Date(right.version.created_at || 0) - new Date(left.version.created_at || 0)
    return time || Number(right.version.version_number || 0) - Number(left.version.version_number || 0)
  })
}

export function designPackageReviewReadiness(entry, workspace = {}) {
  const missing = []
  if (!entry?.context) missing.push('stored package context')
  if (!entry?.references?.length) missing.push('at least one exact asset version')

  const assets = workspace.designAssets || []
  const versions = workspace.designAssetVersions || []
  for (const reference of entry?.references || []) {
    const asset = assets.find(item => item.id === reference.design_asset_id)
    const version = versions.find(item => item.id === reference.design_asset_version_id
      && item.asset_id === reference.design_asset_id)
    if (!asset || asset.archived_at) missing.push(`active asset ${String(reference.design_asset_id).slice(0, 8)}`)
    if (!version) missing.push(`exact asset version ${String(reference.design_asset_version_id).slice(0, 8)}`)
    else if (!version.signed_url) missing.push(`accessible object for version ${String(version.id).slice(0, 8)}`)
  }

  const sourceService = (workspace.designServices || []).find(service =>
    service.id === entry?.context?.source_engagement_service_id
    && service.status === 'active'
    && serviceCatalog(service)?.department_id === 'design'
    && serviceCatalog(service)?.is_active === true)
  if (entry?.context && !sourceService) missing.push('current active Design service')

  if (entry?.context?.destination_engagement_service_id) {
    const destination = (workspace.deliveryServices || []).find(service =>
      service.id === entry.context.destination_engagement_service_id
      && service.status === 'active'
      && serviceCatalog(service)?.department_id === entry.context.destination_department_id
      && serviceCatalog(service)?.is_active === true)
    if (!destination) missing.push('current active downstream service')
  }

  return { ready: missing.length === 0, missing: [...new Set(missing)] }
}
