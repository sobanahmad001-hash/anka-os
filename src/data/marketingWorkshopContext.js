import { appendWorkshopNavigation, WORKSHOP_DESTINATIONS } from './workshopNavigation.js'

const clean = value => typeof value === 'string' ? value.trim() : ''
const relation = value => Array.isArray(value) ? value[0] : value

export function marketingServices(engagement) {
  return (engagement?.engagement_services || []).filter(item => {
    const catalog = relation(item.service_catalog)
    return item.status === 'active' && catalog?.department_id === 'marketing' && catalog?.is_active !== false
  })
}

export function resolveMarketingContext(navigation, engagements = [], activeOrganizationId = '', requestedPrivate = false) {
  if (navigation.status === 'invalid' || (navigation.organizationId && navigation.organizationId !== activeOrganizationId)) {
    return { mode: 'denied', engagement: null, service: null, missing: ['authorized context'] }
  }
  if (requestedPrivate && !navigation.engagementId && !navigation.brandId) {
    return { mode: 'private', engagement: null, service: null, missing: [] }
  }
  const engagement = navigation.engagementId
    ? engagements.find(item => item.id === navigation.engagementId)
    : navigation.brandId
      ? engagements.find(item => item.brand_id === navigation.brandId)
      : null
  if (!navigation.engagementId && !navigation.brandId) return { mode: 'choose', engagement: null, service: null, missing: [] }
  if (!engagement || engagement.organization_id !== activeOrganizationId) {
    return { mode: 'denied', engagement: null, service: null, missing: ['authorized engagement'] }
  }
  const services = marketingServices(engagement)
  const service = navigation.activeServiceId
    ? services.find(item => item.id === navigation.activeServiceId) || null
    : services[0] || null
  const project = relation(engagement.projects)
  const missing = []
  if (!engagement.project_id || (navigation.projectId && navigation.projectId !== engagement.project_id)) missing.push('project')
  if (!engagement.brand_id || (navigation.brandId && navigation.brandId !== engagement.brand_id)) missing.push('brand')
  if (navigation.clientId && navigation.clientId !== clean(project?.client_id)) missing.push('client')
  if (!service) missing.push('active Marketing service')
  return { mode: missing.length ? 'denied' : 'official', engagement, service, services, missing }
}

export function selectableMarketingEngagements(navigation, engagements = []) {
  return engagements.filter(item =>
    (!navigation.organizationId || item.organization_id === navigation.organizationId) &&
    (!navigation.projectId || item.project_id === navigation.projectId) &&
    (!navigation.brandId || item.brand_id === navigation.brandId))
}

export function marketingSelectionParams(navigation, engagement, activeOrganizationId, overrides = {}) {
  if (!engagement?.id || engagement.organization_id !== activeOrganizationId) {
    throw new TypeError('An authorized Marketing engagement is required')
  }
  if (navigation.projectId && navigation.projectId !== engagement.project_id) {
    throw new TypeError('The selected engagement does not match the shared project context')
  }
  const services = marketingServices(engagement)
  const serviceId = navigation.activeServiceId && services.some(item => item.id === navigation.activeServiceId)
    ? navigation.activeServiceId : services[0]?.id || ''
  const project = relation(engagement.projects)
  const context = {
    organizationId: activeOrganizationId,
    clientId: clean(project?.client_id),
    projectId: engagement.project_id,
    engagementId: engagement.id,
    brandId: engagement.brand_id,
    activeServiceId: serviceId,
    stageId: navigation.stageId,
    origin: navigation.origin,
    originTab: navigation.originTab,
    workRecord: navigation.workRecord,
    output: navigation.output,
    draft: navigation.draft,
    workshopTab: overrides.workshopTab === undefined ? navigation.workshopTab : overrides.workshopTab,
  }
  return new URL(appendWorkshopNavigation(WORKSHOP_DESTINATIONS.marketing, context), 'https://anka.invalid').searchParams
}

export function privateMarketingParams(navigation, activeOrganizationId) {
  const href = appendWorkshopNavigation(WORKSHOP_DESTINATIONS.marketing, {
    organizationId: activeOrganizationId,
    origin: navigation.origin,
    originTab: navigation.originTab,
    draft: navigation.draft,
  }, { mode: 'private' })
  return new URL(href, 'https://anka.invalid').searchParams
}

export function resolveMarketingNavigationScope(navigation, workspace, activeOrganizationId) {
  if (!workspace?.engagement) return { status: 'loading' }
  const engagement = workspace.engagement
  const project = relation(engagement.projects)
  const service = navigation.activeServiceId
    ? workspace.marketingServices.find(item => item.id === navigation.activeServiceId && item.engagement_id === engagement.id)
    : null
  const stage = navigation.stageId
    ? workspace.stages.find(item => item.id === navigation.stageId && item.engagement_id === engagement.id)
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
    output: null,
    draft: null,
    permissions: {},
    allowedActions: [],
  }
}

export async function runAuthorizedMarketingAction(validation, isCurrent, action) {
  if (validation?.status !== 'ready' || !isCurrent()) {
    throw Object.assign(new Error('Official Marketing changes require a current authorized work context.'), { status: 403 })
  }
  return action()
}
