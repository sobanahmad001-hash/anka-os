import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  beginContextChange, canRequestDesignExperimentPromotion, designCapabilities,
  designSelectionParams, finishContextChange, loadDesignEngagements, privateDesignParams,
  resolveDesignContext, resolveDesignNavigationScope, selectableDesignEngagements,
} from './designWorkshopContext.js'
import { appendWorkshopNavigation, parseWorkshopNavigation, validateWorkshopNavigation, workspaceReturnTarget } from './workshopNavigation.js'

const engagement = {
  id: 'engagement-1', organization_id: 'org-1', project_id: 'project-1', brand_id: 'brand-1', name: 'Launch',
  projects: { client_id: 'client-1' }, agency_clients: { name: 'Acme' }, brands: { name: 'Acme Brand' },
  engagement_services: [{ id: 'service-1', status: 'active', service_catalog: { department_id: 'design', is_active: true, name: 'Visual production' } }],
}

function withServices(count) {
  return {
    ...engagement,
    engagement_services: Array.from({ length: count }, (_, index) => ({
      id: `service-${index + 1}`,
      status: 'active',
      service_catalog: { department_id: 'design', is_active: true, name: `Design service ${index + 1}` },
    })),
  }
}

const p9 = (input = {}) => parseWorkshopNavigation(new URL(appendWorkshopNavigation('/sphere/design/workshop', {
  organizationId: 'org-1', clientId: 'client-1', projectId: 'project-1', engagementId: 'engagement-1', brandId: 'brand-1',
  origin: '/sphere/workspace/projects/project-1?tab=work', originTab: 'work',
  ...input,
}), 'https://anka.invalid').searchParams)

function workspace() {
  return {
    engagement: { ...engagement }, designServices: withServices(2).engagement_services.map(item => ({ ...item, engagement_id: 'engagement-1' })),
    stages: [{ id: 'stage-1', engagement_id: 'engagement-1' }],
    sessions: [{ id: 'session-1', engagement_id: 'engagement-1' }],
    directions: [{ id: 'direction-1', session_id: 'session-1' }],
    directionVersions: [{ id: 'version-1', direction_id: 'direction-1' }],
    experimentalDirectionVersions: [{ id: 'draft-1', direction_id: 'direction-1' }],
    navigationWorkRecord: { kind: 'project_task', id: 'task-1', organizationId: 'org-1', projectId: 'project-1', engagementId: undefined },
  }
}

test('generic Design entry remains Choose work and never infers the first engagement or private mode', () => {
  const navigation = parseWorkshopNavigation(new URLSearchParams())
  const context = resolveDesignContext(navigation, [engagement], 'org-1')
  assert.equal(context.mode, 'choose')
  assert.equal(context.engagement, null)
})

test('a rejected engagement load is explicit and a deliberate retry can succeed', async () => {
  let attempts = 0
  const studio = { async listEngagements() { attempts += 1; if (attempts === 1) throw new Error('private transport detail'); return [engagement] } }
  assert.equal((await loadDesignEngagements(studio)).status, 'error')
  assert.deepEqual((await loadDesignEngagements(studio)).items, [engagement])
  assert.equal(attempts, 2)
})

test('legacy Design selectors are consumed by P9 and resolve exact authorized work', () => {
  const navigation = parseWorkshopNavigation('engagement=engagement-1&session=session-1&tab=workshop')
  const context = resolveDesignContext(navigation, [engagement], 'org-1')
  assert.equal(context.officialReady, true)
  assert.deepEqual(navigation.output, { kind: 'design_session', id: 'session-1' })
  assert.equal(navigation.workshopTab, 'workshop')
})

test('zero, one, and multiple Design services stay honest while an exact P9 service is enforced', () => {
  const navigation = p9()
  assert.deepEqual(resolveDesignContext(navigation, [withServices(0)], 'org-1').missing, ['active Design service'])
  assert.equal(resolveDesignContext(navigation, [withServices(1)], 'org-1').officialReady, true)
  assert.equal(resolveDesignContext(navigation, [withServices(2)], 'org-1').services.length, 2)
  const exact = resolveDesignContext(p9({ activeServiceId: 'service-2' }), [withServices(2)], 'org-1')
  assert.equal(exact.service.id, 'service-2')
  assert.equal(resolveDesignContext(p9({ activeServiceId: 'service-missing' }), [withServices(2)], 'org-1').officialReady, false)
})

test('invalid, cross-organization, stale project, client, and brand entry fail closed', () => {
  assert.equal(resolveDesignContext(parseWorkshopNavigation('ctxRecordKind=task&ctxRecordId=x'), [engagement], 'org-1').mode, 'denied')
  assert.equal(resolveDesignContext(p9(), [engagement], 'org-2').mode, 'denied')
  assert.equal(resolveDesignContext(p9({ projectId: 'other-project' }), [engagement], 'org-1').officialReady, false)
  assert.equal(resolveDesignContext(p9({ clientId: 'other-client' }), [engagement], 'org-1').officialReady, false)
  assert.equal(resolveDesignContext(p9({ brandId: 'other-brand' }), [engagement], 'org-1').officialReady, false)
})

test('Design chooser preserves typed Project Task identity and exact Workspace return fields through P9', () => {
  const navigation = p9({ engagementId: '', brandId: '', workRecord: { kind: 'project_task', id: 'task-1' }, workshopTab: 'workshop' })
  const params = designSelectionParams(navigation, engagement, 'org-1')
  const selected = parseWorkshopNavigation(params)
  assert.deepEqual(selected.workRecord, { kind: 'project_task', id: 'task-1' })
  assert.equal(selected.engagementId, 'engagement-1')
  assert.equal(selected.clientId, 'client-1')
  assert.equal(selected.workshopTab, 'workshop')
  const back = new URL(workspaceReturnTarget(selected), 'https://anka.invalid')
  assert.equal(back.searchParams.get('tab'), 'work')
  assert.equal(back.searchParams.get('ctxRecordKind'), 'project_task')
})

test('chooser limits project-scoped work and rejects a contradictory selection', () => {
  const navigation = p9({ engagementId: '', brandId: '' })
  const other = { ...engagement, id: 'engagement-2', project_id: 'project-2' }
  assert.deepEqual(selectableDesignEngagements(navigation, [engagement, other]).map(item => item.id), ['engagement-1'])
  assert.throws(() => designSelectionParams(navigation, other, 'org-1'), /does not match/)
})

test('canonical Design scope validates typed work, exact output version, active service, stage, and durable draft', () => {
  const navigation = p9({
    activeServiceId: 'service-2', stageId: 'stage-1',
    workRecord: { kind: 'project_task', id: 'task-1' },
    output: { kind: 'design_session', id: 'session-1', versionId: 'version-1' },
    draft: { kind: 'private_experiment', id: 'draft-1' }, workshopTab: 'workshop',
  })
  const scope = resolveDesignNavigationScope(navigation, workspace(), 'org-1', { view: true }, ['view'])
  const validated = validateWorkshopNavigation(navigation, scope)
  assert.equal(validated.status, 'ready')
  assert.deepEqual(validated.context.output, { kind: 'design_session', id: 'session-1', versionId: 'version-1' })
  assert.deepEqual(validated.context.draft, { kind: 'private_experiment', id: 'draft-1' })
  assert.deepEqual(validated.context.workRecord, { kind: 'project_task', id: 'task-1' })
})

test('Engagement Work Item identity remains distinct and requires the exact engagement', () => {
  const navigation = p9({ workRecord: { kind: 'engagement_work_item', id: 'item-1' } })
  const exact = {
    ...workspace(),
    navigationWorkRecord: { kind: 'engagement_work_item', id: 'item-1', organizationId: 'org-1', projectId: 'project-1', engagementId: 'engagement-1' },
  }
  assert.equal(validateWorkshopNavigation(navigation, resolveDesignNavigationScope(navigation, exact, 'org-1')).status, 'ready')
  const wrongEngagement = { ...exact, navigationWorkRecord: { ...exact.navigationWorkRecord, engagementId: 'engagement-2' } }
  assert.equal(validateWorkshopNavigation(navigation, resolveDesignNavigationScope(navigation, wrongEngagement, 'org-1')).reason, 'work_record_unavailable')
})

test('stale typed records, output versions, drafts, and cross-org scopes are rejected without switching', () => {
  const navigation = p9({
    workRecord: { kind: 'project_task', id: 'task-1' },
    output: { kind: 'design_session', id: 'session-1', versionId: 'version-1' },
    draft: { kind: 'private_experiment', id: 'draft-1' },
  })
  const base = workspace()
  assert.equal(validateWorkshopNavigation(navigation, resolveDesignNavigationScope(navigation, { ...base, navigationWorkRecord: null }, 'org-1')).reason, 'work_record_unavailable')
  assert.equal(validateWorkshopNavigation(navigation, resolveDesignNavigationScope(navigation, { ...base, directionVersions: [] }, 'org-1')).field, 'output')
  assert.equal(validateWorkshopNavigation(navigation, resolveDesignNavigationScope(navigation, { ...base, experimentalDirectionVersions: [] }, 'org-1')).field, 'draft')
  assert.equal(validateWorkshopNavigation(navigation, resolveDesignNavigationScope(navigation, base, 'org-2')).reason, 'cross_organization')
})

test('private entry preserves only an explicit durable draft and safe return pointer', () => {
  const navigation = p9({
    workRecord: { kind: 'project_task', id: 'task-1' },
    output: { kind: 'design_session', id: 'session-1' },
    draft: { kind: 'private_experiment', id: 'draft-1' },
  })
  const params = privateDesignParams(navigation, 'org-1')
  const privateNavigation = parseWorkshopNavigation(params)
  assert.equal(params.get('mode'), 'private')
  assert.equal(privateNavigation.workRecord, null)
  assert.equal(privateNavigation.output, null)
  assert.deepEqual(privateNavigation.draft, { kind: 'private_experiment', id: 'draft-1' })
  assert.equal(workspaceReturnTarget(privateNavigation).includes('tab=work'), true)
})

test('unsaved context changes require a decision and disable save after access loss', () => {
  assert.deepEqual(beginContextChange({ dirty: true, accessValid: false }, 'next'), { pendingContext: 'next', dialogOpen: true, canSave: false })
  assert.equal(finishContextChange('stay', 'next').applyContext, null)
  assert.deepEqual(finishContextChange('discard', 'next'), { pendingContext: null, dialogOpen: false, applyContext: 'next', clearTransient: true, clear: ['attachments', 'pendingProposals', 'confirmations'], saveCurrent: false })
})

test('capabilities mirror server roles and invited reviewers retain promotion only for visible experiments', () => {
  const membership = { role: 'reviewer', department_id: 'content' }
  const experiment = { created_by: 'designer-1', experiment_visibility: ['reviewer-1'] }
  assert.equal(designCapabilities({ role: 'contributor', department_id: 'design' }).executeGeneration, true)
  assert.equal(designCapabilities({ role: 'department_manager', department_id: 'design' }).release, true)
  assert.equal(designCapabilities(membership).promoteExperiment, true)
  assert.equal(canRequestDesignExperimentPromotion(membership, experiment, 'reviewer-1'), true)
  assert.equal(canRequestDesignExperimentPromotion(membership, experiment, 'reviewer-2'), false)
})

test('B01 screen uses the shared P9 consumer and keeps organization-scoped requests and explicit recovery', () => {
  const ui = readFileSync(new URL('../apps/DesignWorkshop.jsx', import.meta.url), 'utf8')
  const repository = readFileSync(new URL('./designWorkshopRepository.js', import.meta.url), 'utf8')
  const request = readFileSync(new URL('./designWorkshopRequest.js', import.meta.url), 'utf8')
  assert.match(ui, /parseWorkshopNavigation/)
  assert.match(ui, /validateWorkshopNavigation/)
  assert.match(ui, /<WorkshopContextShell/)
  assert.match(ui, />Back to work<\/Link>/)
  assert.match(ui, /Choose work/)
  assert.match(ui, /Private experiment/)
  assert.match(ui, /Change work/)
  assert.match(ui, /Save to current context/)
  assert.match(ui, />Discard</)
  assert.match(ui, /Design work could not be loaded/)
  assert.match(ui, /setEngagementRetry\(value => value \+ 1\)/)
  assert.match(ui, /active Design services/)
  assert.match(ui, /focusedVersionId/)
  assert.match(ui, /focusedDraftId/)
  assert.match(ui, /canPromoteExperiment=\{version => canRequestDesignExperimentPromotion/)
  assert.match(ui, /'promoteExperiment'/)
  assert.match(ui, /Video not configured/)
  assert.doesNotMatch(ui, />Generate video</)
  assert.doesNotMatch(ui, /readDesignEntry/)
  assert.match(repository, /forOrganization: createDesignWorkshopScope/)
  assert.match(repository, /scopedFrom\('tasks'\)/)
  assert.match(repository, /scopedFrom\('work_items'\)/)
  assert.match(repository, /\.eq\('organization_id', organizationId\)/)
  assert.match(request, /organization_id: organizationId/)
  assert.match(request, /error\.status \|\| error\.statusCode \|\| error\.context\?\.status/)
})
