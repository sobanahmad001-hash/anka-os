import { appendWorkshopNavigation, WORKSHOP_DESTINATIONS } from './workshopNavigation.js'
const ACTIONS = Object.freeze({ prepare_content: 'writer', prepare_request: 'requests' })
export function contentWorkshopActionTarget(action, { organizationId, projectId, engagement, services = [], unavailable = false } = {}) {
  if (!Object.hasOwn(ACTIONS, action) || unavailable || !organizationId || !projectId || !engagement?.id
    || engagement.organization_id !== organizationId || engagement.project_id !== projectId || !engagement.brand_id) return null
  const service = services.find(row => row.organization_id === organizationId && row.engagement_id === engagement.id
    && row.status === 'active' && (Array.isArray(row.service_catalog) ? row.service_catalog[0] : row.service_catalog)?.department_id === 'content')
  if (!service?.id) return null
  return appendWorkshopNavigation(WORKSHOP_DESTINATIONS.content, {
    organizationId, projectId, engagementId: engagement.id, brandId: engagement.brand_id, activeServiceId: service.id,
    workshopTab: ACTIONS[action], origin: `/sphere/workspace/projects/${encodeURIComponent(projectId)}?tab=discussion`,
  })
}
