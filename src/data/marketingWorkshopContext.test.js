import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import {
  marketingSelectionParams,
  privateMarketingParams,
  reportAuthorizedMarketingAction,
  resolveMarketingContext,
  resolveMarketingNavigationScope,
} from './marketingWorkshopContext.js'
import { createMarketingProposalTransport } from './marketingProposalTransport.js'
import { isOrganizationAccessError } from './organizationScope.js'
import { parseWorkshopNavigation, validateWorkshopNavigation, workspaceReturnTarget } from './workshopNavigation.js'

const engagement = {
  id: 'eng-1', organization_id: 'org-1', project_id: 'project-1', brand_id: 'brand-1', name: 'Launch',
  projects: { client_id: 'client-1' },
  engagement_services: [{ id: 'service-1', status: 'active', service_catalog: { department_id: 'marketing', is_active: true } }],
}

test('generic Marketing entry requires an explicit choice while legacy engagement links resolve', () => {
  assert.equal(resolveMarketingContext(parseWorkshopNavigation(''), [engagement], 'org-1').mode, 'choose')
  const legacy = resolveMarketingContext(parseWorkshopNavigation('engagement=eng-1&tab=analytics'), [engagement], 'org-1')
  assert.equal(legacy.mode, 'official')
  assert.equal(legacy.engagement.id, 'eng-1')
})

test('selection emits canonical P9 context and preserves typed work and safe return identity', () => {
  const navigation = parseWorkshopNavigation('ctxOrg=org-1&ctxProject=project-1&ctxOrigin=%2Fsphere%2Fworkspace%2Fprojects%2Fproject-1&ctxRecordKind=project_task&ctxRecordId=task-1')
  const selected = parseWorkshopNavigation(marketingSelectionParams(navigation, engagement, 'org-1'))
  assert.equal(selected.organizationId, 'org-1')
  assert.equal(selected.clientId, 'client-1')
  assert.equal(selected.engagementId, 'eng-1')
  assert.equal(selected.brandId, 'brand-1')
  assert.equal(selected.activeServiceId, 'service-1')
  assert.deepEqual(selected.workRecord, { kind: 'project_task', id: 'task-1' })
  assert.equal(selected.origin, '/sphere/workspace/projects/project-1')
})

test('private entry is explicit, organization-bounded, and carries no official target', () => {
  const params = privateMarketingParams(parseWorkshopNavigation(''), 'org-1')
  const selected = parseWorkshopNavigation(params)
  assert.equal(selected.organizationId, 'org-1')
  assert.equal(selected.engagementId, '')
  assert.equal(selected.projectId, '')
  assert.equal(params.get('mode'), 'private')
  assert.equal(resolveMarketingContext(selected, [engagement], 'org-1', true).mode, 'private')
})

test('cross-organization and mismatched canonical fields fail closed', () => {
  for (const query of [
    'ctxOrg=org-2&ctxEngagement=eng-1',
    'ctxOrg=org-1&ctxEngagement=eng-1&ctxProject=wrong',
    'ctxOrg=org-1&ctxEngagement=eng-1&ctxBrand=wrong',
    'ctxOrg=org-1&ctxEngagement=eng-1&ctxClient=wrong',
    'ctxOrg=org-1&ctxEngagement=eng-1&ctxService=wrong',
  ]) assert.equal(resolveMarketingContext(parseWorkshopNavigation(query), [engagement], 'org-1').mode, 'denied')
})

test('canonical scope validates exact typed work and rejects unavailable pointers', () => {
  const navigation = parseWorkshopNavigation('ctxOrg=org-1&ctxClient=client-1&ctxProject=project-1&ctxEngagement=eng-1&ctxBrand=brand-1&ctxService=service-1&ctxStage=stage-1&ctxOrigin=%2Fsphere%2Fworkspace%2Fprojects%2Fproject-1%3Ftab%3Dengagement-work&ctxOriginTab=engagement-work&ctxRecordKind=engagement_work_item&ctxRecordId=item-1')
  const workspace = {
    engagement,
    stages: [{ id: 'stage-1', engagement_id: 'eng-1' }],
    marketingServices: [{ id: 'service-1', engagement_id: 'eng-1' }],
    navigationWorkRecord: { kind: 'engagement_work_item', id: 'item-1', organizationId: 'org-1', projectId: 'project-1', engagementId: 'eng-1' },
  }
  const validated = validateWorkshopNavigation(navigation, resolveMarketingNavigationScope(navigation, workspace, 'org-1'))
  assert.equal(validated.status, 'ready')
  const returned = new URL(workspaceReturnTarget(validated), 'https://anka.invalid')
  assert.equal(returned.pathname, '/sphere/workspace/projects/project-1')
  assert.equal(returned.searchParams.get('tab'), 'engagement-work')
  assert.equal(returned.searchParams.get('ctxRecordKind'), 'engagement_work_item')
  assert.equal(returned.searchParams.get('ctxRecordId'), 'item-1')
  assert.equal(validateWorkshopNavigation(navigation, resolveMarketingNavigationScope(navigation, { ...workspace, navigationWorkRecord: null }, 'org-1')).reason, 'work_record_unavailable')
  assert.equal(validateWorkshopNavigation(navigation, resolveMarketingNavigationScope(navigation, { ...workspace, stages: [] }, 'org-1')).reason, 'context_mismatch')
})

test('Marketing consumer imports P9 once and preserves approved feature tabs', () => {
  const ui = readFileSync(new URL('../apps/MarketingStudio.jsx', import.meta.url), 'utf8')
  const repository = readFileSync(new URL('./marketingStudioRepository.js', import.meta.url), 'utf8')
  assert.match(ui, /parseWorkshopNavigation/)
  assert.match(ui, /validateWorkshopNavigation/)
  assert.match(ui, /<WorkshopContextShell/)
  assert.match(ui, /Choose Marketing work/)
  assert.doesNotMatch(ui, /rows\?\.\[0\]/)
  assert.match(ui, /navigationLoadKey/)
  assert.match(ui, /SEO keyword history/)
  assert.match(ui, /Performance dashboard/)
  assert.match(ui, /Connections/)
  assert.match(repository, /from\('tasks'\)/)
  assert.match(repository, /from\('work_items'\)/)
})

test('Backlink Outreach is bound to the validated engagement brand and has no catalogue escape', () => {
  const ui = readFileSync(new URL('../apps/MarketingStudio.jsx', import.meta.url), 'utf8')
  const backlink = ui.slice(ui.indexOf('function BacklinkOutreach'), ui.indexOf('function Artifacts'))
  assert.match(ui, /brand=\{\{ id: workspace\.engagement\.brand_id/)
  assert.match(backlink, /listBacklinkTargets\(brand\.id\)/)
  assert.match(backlink, /createBacklinkTarget\(brand\.id, form\)/)
  assert.doesNotMatch(ui, /studio\.listBrands\(\)|backlinkBrandId|setBacklinkBrandId/)
  assert.doesNotMatch(backlink, /<select[^>]+value=\{brand\.id\}/)
})

test('stale Marketing report callbacks invoke neither mutation nor access recovery', async () => {
  let current = true
  let mutations = 0
  let accessRecoveries = 0
  const delayedSubmit = () => reportAuthorizedMarketingAction(
    { status: 'ready' },
    () => current,
    async () => { mutations += 1 },
    () => { accessRecoveries += 1 },
  )
  current = false
  await assert.rejects(delayedSubmit(), error => error.name === 'AbortError' && error.code === 'MARKETING_CONTEXT_STALE' && !isOrganizationAccessError(error))
  assert.equal(mutations, 0)
  assert.equal(accessRecoveries, 0)
})

test('local invalid Marketing context is not reported as a backend access denial', async () => {
  let accessRecoveries = 0
  await assert.rejects(
    reportAuthorizedMarketingAction({ status: 'invalid' }, () => true, async () => {}, () => { accessRecoveries += 1 }),
    error => error.code === 'MARKETING_CONTEXT_INVALID' && error.status === undefined && !isOrganizationAccessError(error),
  )
  assert.equal(accessRecoveries, 0)
})

test('both Marketing proposal paths preserve envelope-only 403 access denials', async () => {
  const calls = []
  const functionClient = {
    functions: {
      invoke: async (name, options) => {
        calls.push({ name, options })
        return { data: null, error: { message: 'denied', context: { status: 403 } } }
      },
    },
  }
  const proposals = createMarketingProposalTransport(functionClient, 'org-1')
  for (const propose of [proposals.proposeArtifact, proposals.proposeWorkItem]) {
    await assert.rejects(
      propose({ engagement_id: 'eng-1', engagement_stage_instance_id: 'stage-ignored' }),
      error => error.status === 403 && isOrganizationAccessError(error),
    )
  }
  assert.deepEqual(calls.map(call => call.name), ['department-chat', 'department-chat'])
  assert.deepEqual(calls.map(call => call.options.body.action), ['propose_artifact', 'propose_work_item'])
  assert.equal(calls.every(call => call.options.body.organization_id === 'org-1'), true)
  assert.equal(calls.every(call => !('engagement_stage_instance_id' in call.options.body)), true)
})

test('real Marketing proposal 403 reaches the access recovery handler', async () => {
  const proposals = createMarketingProposalTransport({
    functions: { invoke: async () => ({ data: null, error: { message: 'denied', context: { status: 403 } } }) },
  }, 'org-1')
  let accessRecoveries = 0
  await assert.rejects(
    reportAuthorizedMarketingAction({ status: 'ready' }, () => true, () => proposals.proposeArtifact({ engagement_id: 'eng-1' }), error => {
      if (isOrganizationAccessError(error)) accessRecoveries += 1
    }),
    error => error.status === 403 && isOrganizationAccessError(error),
  )
  assert.equal(accessRecoveries, 1)
})
