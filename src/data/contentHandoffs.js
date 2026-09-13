const clean = (value, max = 4000) => typeof value === 'string' ? value.trim().slice(0, max) : ''
const id = value => clean(typeof value === 'object' && value ? value.id : value, 240)

function catalogOf(service) {
  return Array.isArray(service?.service_catalog) ? service.service_catalog[0] : service?.service_catalog
}

export function contentHandoffDestinations(services = [], engagementId = '') {
  return services.flatMap(service => {
    const catalog = catalogOf(service)
    return service.engagement_id === engagementId && service.status === 'active'
      && catalog?.is_active === true && ['design', 'marketing'].includes(catalog.department_id)
      ? [{ id: service.id, engagementId: service.engagement_id, departmentId: catalog.department_id,
          label: `${catalog.name} · ${catalog.department_id}` }]
      : []
  })
}

export function contentHandoffWorkOptions({ tasks = [], workItems = [], destination, projectId = '', engagementId = '' } = {}) {
  if (!destination) return []
  const departmentId = destination.departmentId
  const projectOptions = tasks.filter(item => item.project_id === projectId
      && item.department_id === departmentId && !item.archived_at)
    .map(item => ({ kind: 'project_task', id: item.id, label: item.title, status: item.status }))
  const engagementOptions = workItems.filter(item => item.engagement_id === engagementId
      && item.department_id === departmentId && !item.deleted_at)
    .map(item => ({ kind: 'engagement_work_item', id: item.id, label: item.title, status: item.status }))
  return [...projectOptions, ...engagementOptions]
}

export function contentHandoffTargetKey({
  organizationId, artifact, version, approval, sourceReferences = [], destination, work, note = '', stale = false,
} = {}) {
  const sourceEvidence = sourceReferences.map(reference => ({
    id: id(reference?.id), path: clean(reference?.path, 500), accessible: reference?.accessible === true,
  })).sort((left, right) => `${left.path}:${left.id}`.localeCompare(`${right.path}:${right.id}`))
  return JSON.stringify({ organizationId: id(organizationId), artifactId: id(artifact), versionId: id(version),
    checksum: clean(version?.content_checksum, 240), destinationId: id(destination),
    destinationDepartment: clean(destination?.departmentId, 40), workKind: clean(work?.kind, 40),
    workId: id(work), note: clean(note),
    approval: approval ? { id: id(approval), approvedBy: id(approval?.approved_by), approvedAt: clean(approval?.approved_at, 100) } : null,
    sourceEvidence, stale: stale === true })
}

export function contentHandoffReadiness({ organizationId, artifact, version, destination, work, stale = false } = {}) {
  const missing = []
  if (stale) missing.push('fresh authorized library snapshot')
  if (!id(organizationId)) missing.push('authorized organization')
  if (!id(artifact)) missing.push('Content artifact root')
  if (!id(version) || version?.artifact_id !== artifact?.id) missing.push('selected exact Content version')
  if (!clean(version?.content_checksum, 240)) missing.push('exact version checksum')
  if (!id(destination) || !['design', 'marketing'].includes(destination?.departmentId)) missing.push('active Design or Marketing service')
  if (work && (!['project_task', 'engagement_work_item'].includes(work.kind) || !id(work))) missing.push('valid existing typed work reference')
  return { previewReady: missing.length === 0, officialActionAvailable: false, missing }
}

export function buildContentHandoffPreview({ organizationId, artifact, version, approval, sourceReferences = [], destination, work = null, note = '', stale = false } = {}) {
  const key = contentHandoffTargetKey({ organizationId, artifact, version, approval, sourceReferences, destination, work, note, stale })
  return Object.freeze({ key,
    source: { artifactId: id(artifact), title: clean(artifact?.title, 240), artifactType: clean(artifact?.artifact_type, 80),
      versionId: id(version), versionNumber: Number(version?.version_number) || 0,
      checksum: clean(version?.content_checksum, 240), content: version?.content || {} },
    review: approval ? { status: 'approved', approvalId: id(approval) } : { status: 'unapproved', approvalId: '' },
    sources: sourceReferences.map(reference => ({ id: id(reference?.id), path: clean(reference?.path, 500), accessible: reference?.accessible === true })),
    recipient: { serviceId: id(destination), departmentId: clean(destination?.departmentId, 40), label: clean(destination?.label, 240) },
    work: work ? { kind: clean(work.kind, 40), id: id(work), label: clean(work.label, 240), status: clean(work.status, 80) } : null,
    note: clean(note), effect: 'read_only_preview', officialActionAvailable: false })
}

export function isCurrentContentHandoffPreview(preview, currentTargetKey) {
  return Boolean(preview?.key) && preview.key === currentTargetKey
}
