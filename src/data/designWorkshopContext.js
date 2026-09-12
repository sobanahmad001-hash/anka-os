import { appendWorkshopNavigation, WORKSHOP_DESTINATIONS } from './workshopNavigation.js'

const LEADER_ROLES = new Set(['system_owner', 'operations_admin', 'executive'])

function clean(value, max = 240) {
  return typeof value === 'string' ? value.trim().slice(0, max) : ''
}

function serviceCatalog(service) {
  return Array.isArray(service?.service_catalog) ? service.service_catalog[0] : service?.service_catalog
}

function projectRelation(engagement) {
  return Array.isArray(engagement?.projects) ? engagement.projects[0] : engagement?.projects
}

export function designServices(engagement) {
  return (engagement?.engagement_services || []).filter(item =>
    item.status === 'active' && serviceCatalog(item)?.department_id === 'design' &&
    serviceCatalog(item)?.is_active !== false)
}

export async function loadDesignEngagements(studio, { signal, isCurrent = () => true } = {}) {
  try {
    const items = await studio.listEngagements()
    if (signal?.aborted || !isCurrent()) return { status: 'stale', items: [] }
    return { status: 'ready', items }
  } catch (error) {
    if (signal?.aborted || !isCurrent()) return { status: 'stale', items: [] }
    return { status: 'error', items: [], error }
  }
}

export function resolveDesignContext(navigation, engagements = [], activeOrganizationId = '', requestedPrivate = false) {
  const activeOrganization = clean(activeOrganizationId)
  if (navigation.status === 'invalid' ||
      (navigation.organizationId && navigation.organizationId !== activeOrganization)) {
    return { mode: 'denied', officialReady: false, accessValid: false, engagement: null, service: null, services: [], missing: ['authorized context'], contextKey: 'denied' }
  }
  if (requestedPrivate && !navigation.engagementId) {
    return { mode: 'private', officialReady: false, accessValid: true, engagement: null, service: null, services: [], missing: [], contextKey: `private:${activeOrganization || 'owner'}` }
  }
  if (!navigation.engagementId) {
    return { mode: 'choose', officialReady: false, accessValid: true, engagement: null, service: null, services: [], missing: [], contextKey: 'choose' }
  }
  const engagement = engagements.find(item => item.id === navigation.engagementId) || null
  if (!engagement) {
    return { mode: 'denied', officialReady: false, accessValid: false, engagement: null, service: null, services: [], missing: ['authorized engagement'], contextKey: 'denied' }
  }
  const services = designServices(engagement)
  const service = navigation.activeServiceId
    ? services.find(item => item.id === navigation.activeServiceId) || null
    : services[0] || null
  const project = projectRelation(engagement)
  const clientId = clean(project?.client_id)
  const projectId = clean(engagement.project_id)
  const brandId = clean(engagement.brand_id)
  const organizationMatches = Boolean(activeOrganization && engagement.organization_id === activeOrganization)
  const missing = []
  if (!organizationMatches) missing.push('organization')
  if (!projectId || (navigation.projectId && navigation.projectId !== projectId)) missing.push('project')
  if (!brandId || (navigation.brandId && navigation.brandId !== brandId)) missing.push('brand')
  if (navigation.clientId && navigation.clientId !== clientId) missing.push('client')
  if (!service) missing.push('active Design service')
  return {
    mode: 'official',
    officialReady: missing.length === 0,
    accessValid: organizationMatches,
    engagement,
    service,
    services,
    clientId,
    projectId,
    brandId,
    missing: [...new Set(missing)],
    contextKey: `official:${activeOrganization}:${engagement.id}:${projectId}:${brandId}:${services.map(item => item.id).sort().join(',')}`,
  }
}

export function selectableDesignEngagements(navigation, engagements) {
  return engagements.filter(item =>
    (!navigation.projectId || item.project_id === navigation.projectId) &&
    (!navigation.organizationId || item.organization_id === navigation.organizationId))
}

export function designSelectionParams(navigation, engagement, activeOrganizationId) {
  if (!engagement?.id || engagement.organization_id !== activeOrganizationId) {
    throw new TypeError('An authorized Design engagement is required')
  }
  if (navigation.projectId && navigation.projectId !== engagement.project_id) {
    throw new TypeError('The selected engagement does not match the shared project context')
  }
  const availableServices = designServices(engagement)
  const activeServiceId = navigation.activeServiceId && availableServices.some(item => item.id === navigation.activeServiceId)
    ? navigation.activeServiceId : ''
  const href = appendWorkshopNavigation(WORKSHOP_DESTINATIONS.design, {
    organizationId: activeOrganizationId,
    clientId: clean(projectRelation(engagement)?.client_id),
    projectId: engagement.project_id,
    engagementId: engagement.id,
    brandId: engagement.brand_id,
    activeServiceId,
    stageId: navigation.stageId,
    origin: navigation.origin,
    originTab: navigation.originTab,
    workRecord: navigation.workRecord,
    workshopTab: navigation.workshopTab,
  })
  return new URL(href, 'https://anka.invalid').searchParams
}

export function privateDesignParams(navigation, activeOrganizationId) {
  const href = appendWorkshopNavigation(WORKSHOP_DESTINATIONS.design, {
    organizationId: activeOrganizationId,
    origin: navigation.origin,
    originTab: navigation.originTab,
    draft: navigation.draft,
  }, { mode: 'private' })
  return new URL(href, 'https://anka.invalid').searchParams
}

export function resolveDesignNavigationScope(navigation, workspace, activeOrganizationId, permissions = {}, allowedActions = []) {
  if (!workspace?.engagement) return { status: 'loading' }
  const engagement = workspace.engagement
  const project = projectRelation(engagement)
  const service = navigation.activeServiceId
    ? workspace.designServices.find(item => item.id === navigation.activeServiceId && item.engagement_id === engagement.id)
    : null
  const stage = navigation.stageId
    ? workspace.stages.find(item => item.id === navigation.stageId && item.engagement_id === engagement.id)
    : null
  const session = navigation.output?.kind === 'design_session'
    ? workspace.sessions.find(item => item.id === navigation.output.id && item.engagement_id === engagement.id)
    : null
  const pointedVersion = navigation.output?.versionId
    ? [...workspace.directionVersions, ...workspace.experimentalDirectionVersions].find(item => item.id === navigation.output.versionId)
    : null
  const pointedDirection = pointedVersion
    ? workspace.directions.find(item => item.id === pointedVersion.direction_id && item.session_id === session?.id)
    : null
  const output = session && (!navigation.output.versionId || pointedDirection)
    ? { kind: 'design_session', id: session.id, ...(pointedVersion ? { versionId: pointedVersion.id } : {}) }
    : null
  const draftVersion = navigation.draft?.kind === 'private_experiment'
    ? workspace.experimentalDirectionVersions.find(item => item.id === navigation.draft.id)
    : null
  return {
    status: 'ready',
    activeOrganizationId,
    organizationId: engagement.organization_id,
    clientId: clean(project?.client_id),
    projectId: engagement.project_id,
    engagementId: engagement.id,
    brandId: engagement.brand_id,
    activeServiceId: service?.id || '',
    stageId: stage?.id || '',
    workRecord: workspace.navigationWorkRecord,
    output,
    draft: draftVersion ? { kind: 'private_experiment', id: draftVersion.id } : null,
    permissions,
    allowedActions,
  }
}

export function designCapabilities(membership) {
  const role = clean(membership?.role)
  const department = clean(membership?.departmentId || membership?.department_id)
  const leader = LEADER_ROLES.has(role)
  const designContributor = department === 'design'
  return Object.freeze({
    view: Boolean(membership),
    createDraft: leader || designContributor,
    executeGeneration: leader || designContributor,
    selectDirection: leader || designContributor,
    promoteExperiment: Boolean(membership),
    release: leader || (designContributor && role === 'department_manager'),
    manageConnections: leader,
  })
}

export function designAllowedActions(capabilities) {
  return Object.freeze(Object.entries(capabilities).filter(([, allowed]) => allowed).map(([action]) => action))
}

export function canRequestDesignExperimentPromotion(membership, version, userId) {
  if (!membership || !userId || !version) return false
  return version.created_by === userId || (version.experiment_visibility || []).includes(userId)
}

export function beginContextChange({ dirty, accessValid }, nextContext) {
  return dirty
    ? { pendingContext: nextContext, dialogOpen: true, canSave: Boolean(accessValid) }
    : { pendingContext: null, dialogOpen: false, canSave: Boolean(accessValid), applyContext: nextContext }
}

export function finishContextChange(decision, pendingContext) {
  if (decision === 'stay') return { pendingContext: null, dialogOpen: false, applyContext: null, clearTransient: false }
  if (!pendingContext || !['save', 'discard'].includes(decision)) throw new TypeError('A pending context and explicit decision are required')
  return {
    pendingContext: null,
    dialogOpen: false,
    applyContext: pendingContext,
    clearTransient: true,
    clear: ['attachments', 'pendingProposals', 'confirmations'],
    saveCurrent: decision === 'save',
  }
}
