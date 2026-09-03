import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { contentSelectionParams, resolveContentContext, resolveContentNavigationScope } from './contentWorkshopContext.js'
import { parseWorkshopNavigation, validateWorkshopNavigation } from './workshopNavigation.js'

const engagement = {
  id: 'eng-1', organization_id: 'org-1', project_id: 'project-1', brand_id: 'brand-1', name: 'Launch',
  projects: { client_id: 'client-1' },
  engagement_services: [{ id: 'service-1', status: 'active', service_catalog: { department_id: 'content', is_active: true } }],
}

test('generic Content entry requires an explicit work choice and legacy brand links still resolve', () => {
  assert.equal(resolveContentContext(parseWorkshopNavigation(''), [engagement], 'org-1').mode, 'choose')
  const legacy = resolveContentContext(parseWorkshopNavigation('brand=brand-1&eventLink=event-1&tab=calendar'), [engagement], 'org-1')
  assert.equal(legacy.mode, 'official')
  assert.equal(legacy.engagement.id, 'eng-1')
})

test('selection emits modern P9 context while preserving typed work identity and safe origin', () => {
  const navigation = parseWorkshopNavigation('ctxOrg=org-1&ctxProject=project-1&ctxOrigin=%2Fsphere%2Fworkspace%2Fprojects%2Fproject-1&ctxRecordKind=project_task&ctxRecordId=task-1')
  const selected = parseWorkshopNavigation(contentSelectionParams(navigation, engagement, 'org-1'))
  assert.equal(selected.organizationId, 'org-1')
  assert.equal(selected.clientId, 'client-1')
  assert.equal(selected.engagementId, 'eng-1')
  assert.equal(selected.activeServiceId, 'service-1')
  assert.deepEqual(selected.workRecord, { kind: 'project_task', id: 'task-1' })
  assert.equal(selected.origin, '/sphere/workspace/projects/project-1')
})

test('cross-organization and mismatched canonical fields fail closed', () => {
  for (const query of ['ctxOrg=org-2&ctxEngagement=eng-1', 'ctxOrg=org-1&ctxEngagement=eng-1&ctxProject=wrong', 'ctxOrg=org-1&ctxEngagement=eng-1&ctxBrand=wrong', 'ctxOrg=org-1&ctxEngagement=eng-1&ctxClient=wrong', 'ctxOrg=org-1&ctxEngagement=eng-1&ctxService=wrong']) {
    assert.equal(resolveContentContext(parseWorkshopNavigation(query), [engagement], 'org-1').mode, 'denied')
  }
})

test('canonical scope validates exact work record and event output and rejects unavailable pointers', () => {
  const navigation = parseWorkshopNavigation('ctxOrg=org-1&ctxClient=client-1&ctxProject=project-1&ctxEngagement=eng-1&ctxBrand=brand-1&ctxService=service-1&ctxRecordKind=engagement_work_item&ctxRecordId=item-1&ctxOutputKind=event_link&ctxOutputId=event-1')
  const workspace = {
    engagement, stages: [], contentServices: [{ id: 'service-1', engagement_id: 'eng-1' }],
    navigationWorkRecord: { kind: 'engagement_work_item', id: 'item-1', organizationId: 'org-1', projectId: 'project-1', engagementId: 'eng-1' },
    blogEventLinks: [{ id: 'event-1' }],
  }
  assert.equal(validateWorkshopNavigation(navigation, resolveContentNavigationScope(navigation, workspace, 'org-1')).status, 'ready')
  assert.equal(validateWorkshopNavigation(navigation, resolveContentNavigationScope(navigation, { ...workspace, navigationWorkRecord: null }, 'org-1')).reason, 'work_record_unavailable')
})

test('Content consumer imports P9 shell and scoped repository without duplicating the shared contract', () => {
  const ui = readFileSync(new URL('../apps/ContentStudio.jsx', import.meta.url), 'utf8')
  const repository = readFileSync(new URL('./contentStudioRepository.js', import.meta.url), 'utf8')
  assert.match(ui, /parseWorkshopNavigation/)
  assert.match(ui, /validateWorkshopNavigation/)
  assert.match(ui, /<WorkshopContextShell/)
  assert.match(ui, /Choose Content work/)
  assert.doesNotMatch(ui, /rows\?\.\[0\]/)
  assert.match(repository, /forOrganization: createContentStudioScope/)
  assert.match(repository, /from\('tasks'\)/)
  assert.match(repository, /from\('work_items'\)/)
})
