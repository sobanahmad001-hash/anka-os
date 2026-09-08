import test from 'node:test'
import assert from 'node:assert/strict'
import {
  WORK_RECORD_KINDS, WORKSHOP_DESTINATIONS, appendWorkshopNavigation,
  createWorkshopNavigationContext, navigationRecoveryMessage,
  parseWorkshopNavigation, validateWorkshopNavigation, workspaceReturnTarget,
} from './workshopNavigation.js'

const fullContext = {
  organization: { id: 'org-a' }, client: { id: 'client-a' }, project: { id: 'project-a' },
  engagement: { id: 'engagement-a' }, brand: { id: 'brand-a' },
  activeService: { id: 'service-a' }, stage: { id: 'stage-a' },
  workItem: { kind: 'engagement_work_item', id: 'item-a' },
  output: { kind: 'design_session', id: 'session-a', versionId: 'version-a' },
  draft: { kind: 'private_experiment', id: 'draft-a' },
  origin: '/sphere/workspace/projects/project-a?tab=work',
  originTab: 'work', workshopTab: 'directions',
  permissions: { view: true, release: false }, allowedActions: ['view', 'create_draft'],
}
const resolvedScope = {
  status: 'ready', activeOrganizationId: 'org-a', organizationId: 'org-a',
  clientId: 'client-a', projectId: 'project-a', engagementId: 'engagement-a',
  brandId: 'brand-a', activeServiceId: 'service-a', stageId: 'stage-a',
  workRecord: {
    kind: 'engagement_work_item', id: 'item-a', organizationId: 'org-a',
    projectId: 'project-a', engagementId: 'engagement-a',
  },
  output: { kind: 'design_session', id: 'session-a', versionId: 'version-a' },
  draft: { kind: 'private_experiment', id: 'draft-a' },
  permissions: { view: true, createDraft: true, release: false },
  allowedActions: ['view', 'create_draft'],
}

test('P9 round trip preserves exact shared context and legacy Design selectors', () => {
  const href = appendWorkshopNavigation(WORKSHOP_DESTINATIONS.design, fullContext, { retained: 'yes' })
  const url = new URL(href, 'https://anka.invalid')
  assert.equal(url.pathname, '/sphere/design/workshop')
  assert.equal(url.searchParams.get('retained'), 'yes')
  assert.equal(url.searchParams.get('engagement'), 'engagement-a')
  assert.equal(url.searchParams.get('brand'), 'brand-a')
  assert.equal(url.searchParams.get('session'), 'session-a')
  const parsed = parseWorkshopNavigation(url.searchParams)
  assert.equal(parsed.status, 'parsed')
  assert.deepEqual(parsed.workRecord, { kind: 'engagement_work_item', id: 'item-a' })
  assert.deepEqual(parsed.output, { kind: 'design_session', id: 'session-a', versionId: 'version-a' })
  assert.deepEqual(parsed.draft, { kind: 'private_experiment', id: 'draft-a' })
  assert.equal(parsed.activeServiceId, 'service-a')
  assert.equal(parsed.origin, '/sphere/workspace/projects/project-a?tab=work')
  const returned = new URL(workspaceReturnTarget(parsed), 'https://anka.invalid')
  assert.equal(returned.pathname, '/sphere/workspace/projects/project-a')
  assert.equal(returned.searchParams.get('tab'), 'work')
  for (const [key, expected] of [
    ['ctxOrg', 'org-a'], ['ctxClient', 'client-a'], ['ctxProject', 'project-a'],
    ['ctxEngagement', 'engagement-a'], ['ctxBrand', 'brand-a'],
    ['ctxService', 'service-a'], ['ctxStage', 'stage-a'],
    ['ctxRecordKind', 'engagement_work_item'], ['ctxRecordId', 'item-a'],
    ['ctxOutputId', 'session-a'], ['ctxVersionId', 'version-a'],
    ['ctxDraftId', 'draft-a'],
  ]) assert.equal(returned.searchParams.get(key), expected)
})

test('Project Tasks and Engagement Work Items retain distinct typed identities', () => {
  assert.deepEqual(WORK_RECORD_KINDS, ['project_task', 'engagement_work_item'])
  const task = parseWorkshopNavigation(
    'ctxOrg=org-a&ctxProject=project-a&ctxOrigin=%2Fsphere%2Fworkspace%2Fprojects%2Fproject-a&ctxRecordKind=project_task&ctxRecordId=same-id')
  const item = parseWorkshopNavigation(
    'ctxOrg=org-a&ctxProject=project-a&ctxEngagement=engagement-a&ctxOrigin=%2Fsphere%2Fworkspace%2Fprojects%2Fproject-a&ctxRecordKind=engagement_work_item&ctxRecordId=same-id')
  assert.notDeepEqual(task.workRecord, item.workRecord)
  assert.equal(workspaceReturnTarget(task).includes('ctxRecordKind=project_task'), true)
  assert.equal(workspaceReturnTarget(item).includes('ctxRecordKind=engagement_work_item'), true)
})

test('invalid kinds, incomplete pairs, unsafe origins, and legacy contradictions fail closed', () => {
  assert.equal(parseWorkshopNavigation('ctxRecordKind=task&ctxRecordId=1').reason,
    'invalid_work_record_kind')
  assert.equal(parseWorkshopNavigation('ctxRecordKind=project_task').reason, 'invalid_context')
  assert.equal(parseWorkshopNavigation('ctxOrigin=https%3A%2F%2Fevil.example').reason, 'unsafe_origin')
  assert.equal(parseWorkshopNavigation('ctxEngagement=a&engagement=b').reason,
    'contradictory_legacy_context')
  assert.equal(parseWorkshopNavigation('ctxOutputKind=event_link&session=session-a').reason,
    'contradictory_legacy_context')
  assert.equal(parseWorkshopNavigation('session=session-a&eventLink=event-a').reason,
    'contradictory_legacy_context')
  assert.throws(() => appendWorkshopNavigation(
    '/sphere/design/workshop?engagement=b',
    { organizationId: 'org-a', engagementId: 'a' }), /conflicting old and new context/)
})

test('ready validation requires canonical resolved IDs and exact output and draft pointers', () => {
  const parsed = parseWorkshopNavigation(
    new URL(appendWorkshopNavigation(WORKSHOP_DESTINATIONS.design, fullContext),
      'https://anka.invalid').searchParams)
  const missingResolved = validateWorkshopNavigation(parsed,
    { ...resolvedScope, activeServiceId: '' })
  assert.equal(missingResolved.reason, 'context_mismatch')
  assert.equal(missingResolved.field, 'activeServiceId')
  const staleVersion = validateWorkshopNavigation(parsed, {
    ...resolvedScope,
    output: { ...resolvedScope.output, versionId: 'version-b' },
  })
  assert.equal(staleVersion.reason, 'context_mismatch')
  assert.equal(staleVersion.field, 'output')
  const staleDraft = validateWorkshopNavigation(parsed, {
    ...resolvedScope, draft: { ...resolvedScope.draft, id: 'draft-b' },
  })
  assert.equal(staleDraft.reason, 'context_mismatch')
  assert.equal(staleDraft.field, 'draft')
})

test('cross-organization and canonical record mismatches reject without switching organization', () => {
  const href = appendWorkshopNavigation(WORKSHOP_DESTINATIONS.design, fullContext)
  const parsed = parseWorkshopNavigation(new URL(href, 'https://anka.invalid').searchParams)
  const crossOrg = validateWorkshopNavigation(parsed,
    { ...resolvedScope, activeOrganizationId: 'org-b', organizationId: 'org-b' })
  assert.deepEqual({
    status: crossOrg.status, reason: crossOrg.reason,
    context: crossOrg.context, rejected: crossOrg.rejected,
  }, { status: 'stale', reason: 'cross_organization', context: null, rejected: true })
  const wrongRecord = validateWorkshopNavigation(parsed,
    { ...resolvedScope, workRecord: { ...resolvedScope.workRecord, id: 'item-b' } })
  assert.equal(wrongRecord.reason, 'work_record_unavailable')
  assert.equal(workspaceReturnTarget(crossOrg, { fallbackProjectId: 'project-safe' }),
    '/sphere/workspace/projects/project-safe?tab=overview')
  const contradictoryResolvedOrg = validateWorkshopNavigation(parsed,
    { ...resolvedScope, organizationId: 'org-b' })
  assert.equal(contradictoryResolvedOrg.reason, 'cross_organization')
  const missingRecordTenant = validateWorkshopNavigation(parsed, {
    ...resolvedScope, workRecord: { ...resolvedScope.workRecord, organizationId: '' },
  })
  assert.equal(missingRecordTenant.reason, 'work_record_unavailable')
})

test('permissions and allowed actions are resolved locally and never trusted from the URL', () => {
  const href = appendWorkshopNavigation(WORKSHOP_DESTINATIONS.design, fullContext)
  assert.equal(/permission|allowedAction|release/i.test(href), false)
  const injected = parseWorkshopNavigation(
    new URL(href, 'https://anka.invalid').search + '&allowedActions=release&permissions=admin')
  assert.deepEqual(injected.allowedActions, [])
  assert.deepEqual(injected.permissions, {})
  const validated = validateWorkshopNavigation(injected, resolvedScope)
  assert.deepEqual(validated.context.allowedActions, ['view', 'create_draft'])
  assert.deepEqual(validated.context.permissions,
    { view: true, createDraft: true, release: false })
})

test('loading, empty, denied, error, stale refresh, and context switch remain explicit', () => {
  const context = createWorkshopNavigationContext(fullContext)
  assert.equal(validateWorkshopNavigation(context, { status: 'loading' }).status, 'loading')
  assert.equal(validateWorkshopNavigation(context, { status: 'empty' }).status, 'empty')
  assert.equal(validateWorkshopNavigation(context, { status: 'denied' }).reason, 'access_denied')
  assert.equal(validateWorkshopNavigation(
    context, { status: 'error', error: new Error('offline') }).status, 'error')
  const stale = validateWorkshopNavigation(context, {
    status: 'error', error: new Error('offline'), lastGoodScope: resolvedScope,
  })
  assert.equal(stale.status, 'stale')
  assert.equal(stale.reason, 'refresh_failed')
  assert.equal(stale.context.organizationId, 'org-a')
  const switched = validateWorkshopNavigation(context, { status: 'context_switch' })
  assert.equal(switched.invalidatePendingConfirmations, true)
  assert.equal(switched.clearTransient, true)
  assert.deepEqual(switched.preserveDraft, { kind: 'private_experiment', id: 'draft-a' })
  assert.equal(switched.context, null)
})

test('private experiments preserve only a durable pointer and cannot invent promotion authority', () => {
  const context = createWorkshopNavigationContext({
    organizationId: 'org-a',
    draft: { kind: 'private_experiment', id: 'draft-private' },
    permissions: { promoteExperiment: true },
    allowedActions: ['promote_experiment'],
  })
  const href = appendWorkshopNavigation(WORKSHOP_DESTINATIONS.design, context)
  const parsed = parseWorkshopNavigation(new URL(href, 'https://anka.invalid').searchParams)
  assert.deepEqual(parsed.draft, { kind: 'private_experiment', id: 'draft-private' })
  assert.deepEqual(parsed.permissions, {})
  assert.deepEqual(parsed.allowedActions, [])
  assert.equal(href.includes('promote'), false)
})

test('existing specialist URLs stay valid and hrefs remain responsive keyboard-safe targets', () => {
  const existing = '/sphere/content/studio?engagement=engagement-a&brand=brand-a&eventLink=event-a&tab=calendar#proof'
  const parsed = parseWorkshopNavigation(new URL(existing, 'https://anka.invalid').searchParams)
  assert.equal(parsed.engagementId, 'engagement-a')
  assert.deepEqual(parsed.output, { kind: 'event_link', id: 'event-a' })
  const context = {
    organizationId: 'org-a', engagementId: 'engagement-a', brandId: 'brand-a',
    workshopTab: 'calendar', output: { kind: 'event_link', id: 'event-a' },
  }
  const mobileHref = appendWorkshopNavigation(existing, context)
  const desktopHref = appendWorkshopNavigation(existing, context)
  assert.equal(mobileHref, desktopHref)
  assert.match(mobileHref, /^\/sphere\//)
  assert.equal(mobileHref.endsWith('#proof'), true)
  assert.equal(/^javascript:/i.test(mobileHref), false)
})

test('safe fallback and recovery copy explain stale and invalid navigation', () => {
  assert.equal(workspaceReturnTarget({}, {}), '/sphere/workspace')
  assert.equal(workspaceReturnTarget({ projectId: 'project a' }),
    '/sphere/workspace/projects/project%20a?tab=overview')
  assert.match(navigationRecoveryMessage('cross_organization'),
    /active organization was not changed/i)
  assert.match(navigationRecoveryMessage('refresh_failed'), /shown as stale/i)
})
