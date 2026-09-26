import test from 'node:test'
import assert from 'node:assert/strict'
import { contentWorkshopActionTarget } from './contentWorkshopActions.js'
import { parseWorkshopNavigation } from './workshopNavigation.js'
const scope = () => ({ organizationId: 'org', projectId: 'project', engagement: { id: 'engagement', organization_id: 'org', project_id: 'project', brand_id: 'brand' }, services: [{ id: 'service', organization_id: 'org', engagement_id: 'engagement', status: 'active', service_catalog: { department_id: 'content' } }] })
test('Content handoffs allow only typed editor routes and exact scoped context without draft content', () => {
  for (const [action, tab] of [['prepare_content', 'writer'], ['prepare_request', 'requests']]) {
    const url = new URL(contentWorkshopActionTarget(action, scope()), 'https://anka.invalid')
    assert.equal(url.pathname, '/sphere/content/studio')
    const context = parseWorkshopNavigation(url.searchParams)
    assert.equal(context.organizationId, 'org'); assert.equal(context.projectId, 'project')
    assert.equal(context.engagementId, 'engagement'); assert.equal(context.activeServiceId, 'service')
    assert.equal(context.workshopTab, tab); assert.equal(context.draft, null); assert.equal(context.output, null)
  }
  assert.equal(contentWorkshopActionTarget('approve_artifact', scope()), null)
  assert.equal(contentWorkshopActionTarget('__proto__', scope()), null)
})
test('Content handoffs refuse missing, stale, foreign or planned service context', () => {
  for (const mutation of [s => { s.unavailable = true }, s => { s.projectId = 'foreign' }, s => { s.organizationId = 'foreign' },
    s => { s.engagement = null }, s => { s.engagement.brand_id = '' }, s => { s.services[0].organization_id = 'foreign' },
    s => { s.services[0].engagement_id = 'foreign' }, s => { s.services[0].status = 'planned' }, s => { s.services[0].service_catalog.department_id = 'design' }]) {
    const input = scope(); mutation(input)
    assert.equal(contentWorkshopActionTarget('prepare_content', input), null)
  }
})
