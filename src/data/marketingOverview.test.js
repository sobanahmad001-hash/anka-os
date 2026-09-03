import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { buildMarketingOverview, filterMarketingOverview, marketingOverviewCounts, marketingOverviewLoadFailure, marketingOverviewRowHref } from './marketingOverview.js'

const engagement = { id: 'eng-a', organization_id: 'org-a', project_id: 'project-a', brand_id: 'brand-a' }
const input = { organizationId: 'org-a', engagement, memberships: [{ organization_id: 'org-a', user_id: 'owner-a', member_kind: 'team', status: 'active' }], profiles: [{ id: 'owner-a', full_name: 'Ava Owner' }], tasks: [{ id: 'task-a', organization_id: 'org-a', project_id: 'project-a', department_id: 'marketing', assigned_to: 'owner-a', title: 'Launch plan', status: 'in_progress', due_date: '2026-09-06' }, { id: 'blocked', organization_id: 'org-a', project_id: 'project-a', department_id: 'marketing', title: 'Blocked plan', status: 'blocked', due_date: '2026-09-01' }, { id: 'cross-org', organization_id: 'org-b', project_id: 'project-a', department_id: 'marketing', title: 'Forged', status: 'blocked' }], workItems: [{ id: 'work-a', organization_id: 'org-a', engagement_id: 'eng-a', department_id: 'marketing', assignee_id: 'owner-a', title: 'Write brief', status: 'not_started', due_date: null }], approvalRequests: [{ id: 'review-a', organization_id: 'org-a', requested_by: 'owner-a', status: 'pending', artifact_versions: { id: 'version-a', version_number: 2, artifacts: { id: 'artifact-a', title: 'Launch brief', artifact_type: 'campaign_brief', engagement_id: 'eng-a' } } }], readiness: [{ id: 'ga', organizationId: 'org-a', brand: { id: 'brand-a' }, providerLabel: 'Google Analytics', accountLabel: 'Property', mappingLabel: 'Launch', connectionId: 'connection-a', state: 'healthy' }, { id: 'meta', organizationId: 'org-a', brand: { id: 'brand-a' }, providerLabel: 'Meta', accountLabel: 'Unavailable', mappingLabel: 'Brand', connectionId: null, state: 'not_configured' }] }

test('Marketing Overview keeps exact tenant and engagement scope with separate facets', () => { const overview = buildMarketingOverview(input); assert.equal(overview.records.some(item => item.title === 'Forged'), false); assert.deepEqual(marketingOverviewCounts(overview.records), { due_work: 3, blockers: 1, awaiting_review: 1, available_sources: 1 }) })
test('counts and drill-down use identical filters', () => { const overview = buildMarketingOverview(input); const filters = { owner: 'owner-a', status: 'in_progress', dueWindow: '7_days' }; const now = new Date('2026-09-04T12:00:00Z'); const counts = marketingOverviewCounts(overview.records, filters, now); const rows = filterMarketingOverview(overview.records, { ...filters, facet: 'due_work' }, now); assert.equal(counts.due_work, 1); assert.equal(rows.length, counts.due_work); assert.equal(rows[0].recordId, 'task-a') })
test('available-source count and drill-down use the identical availability predicate', () => { const overview = buildMarketingOverview(input); const rows = filterMarketingOverview(overview.records, { facet: 'available_sources' }); assert.equal(filterMarketingOverview(overview.records, { facet: 'due_work' }).length, 3); assert.equal(rows.length, marketingOverviewCounts(overview.records).available_sources); assert.equal(rows.length, 1); assert.equal(rows[0].available, true); assert.equal(overview.records.some(item => item.recordKind === 'source' && item.available === false), true) })
test('Marketing Overview rejects a mismatched organization', () => assert.throws(() => buildMarketingOverview({ ...input, organizationId: 'org-b' }), /organization mismatch/))

const navigation = { organizationId: 'org-a', clientId: 'client-a', projectId: 'project-a', engagementId: 'eng-a', brandId: 'brand-a', serviceId: 'service-a', campaignId: 'campaign-a' }

test('row drilldowns preserve complete authorized context and exact record identity', () => {
  const overview = buildMarketingOverview(input)
  for (const kind of ['project_task', 'engagement_work_item']) {
    const item = overview.records.find(row => row.recordKind === kind)
    const url = new URL(marketingOverviewRowHref(item, navigation), 'https://anka.invalid')
    assert.equal(url.pathname, '/sphere/marketing/studio')
    assert.deepEqual(Object.fromEntries(['ctxOrg', 'ctxClient', 'ctxProject', 'ctxEngagement', 'ctxBrand', 'ctxService', 'campaign'].map(key => [key, url.searchParams.get(key)])), {
      ctxOrg: 'org-a', ctxClient: 'client-a', ctxProject: 'project-a', ctxEngagement: 'eng-a', ctxBrand: 'brand-a', ctxService: 'service-a', campaign: 'campaign-a',
    })
    assert.equal(url.searchParams.get('ctxRecordKind'), kind)
    assert.equal(url.searchParams.get('ctxRecordId'), item.recordId)
  }
  const review = overview.records.find(row => row.recordKind === 'artifact_review')
  const reviewUrl = new URL(marketingOverviewRowHref(review, navigation), 'https://anka.invalid')
  assert.equal(reviewUrl.searchParams.get('ctxOutputKind'), 'artifact')
  assert.equal(reviewUrl.searchParams.get('ctxOutputId'), 'artifact-a')
  assert.equal(reviewUrl.searchParams.get('ctxVersionId'), 'version-a')
  assert.equal(reviewUrl.searchParams.get('artifact'), 'campaign_brief')
  assert.equal(reviewUrl.searchParams.get('version'), 'version-a')
})

test('row drilldowns fail closed when any required context boundary is absent', () => {
  const item = buildMarketingOverview(input).records.find(row => row.recordKind === 'project_task')
  for (const field of ['organizationId', 'projectId', 'engagementId', 'brandId', 'serviceId']) {
    assert.throws(() => marketingOverviewRowHref(item, { ...navigation, [field]: '' }), /Complete authorized Marketing context/)
  }
})

test('overview load failures distinguish generic, access, abort, and stale responses', () => {
  assert.deepEqual(marketingOverviewLoadFailure({ requestGeneration: 2, currentGeneration: 2, error: new Error('offline'), hasWork: false }), { ignored: false, stale: false, access: false, message: 'offline' })
  for (const status of [401, 403]) {
    const failure = marketingOverviewLoadFailure({ requestGeneration: 2, currentGeneration: 2, error: Object.assign(new Error('denied'), { status }), hasWork: true })
    assert.equal(failure.access, true); assert.equal(failure.stale, true); assert.equal(failure.ignored, false)
  }
  assert.equal(marketingOverviewLoadFailure({ requestGeneration: 2, currentGeneration: 2, aborted: true, error: new Error('cancelled'), hasWork: true }).ignored, true)
  assert.equal(marketingOverviewLoadFailure({ requestGeneration: 1, currentGeneration: 2, error: new Error('late'), hasWork: true }).ignored, true)
})

test('Overview UI labels failed refresh data as stale and preserves partial-family disclosure', () => {
  const ui = readFileSync(new URL('../components/MarketingOverview.jsx', import.meta.url), 'utf8')
  const repository = readFileSync(new URL('./marketingOverviewRepository.js', import.meta.url), 'utf8')
  assert.match(ui, /role="alert"/)
  assert.match(ui, /Stale snapshot — refresh did not complete/)
  assert.match(ui, /No current Overview rows are available/)
  assert.match(ui, /generation\.current/)
  assert.match(ui, /signal\?\.aborted/)
  assert.match(repository, /Promise\.allSettled\(requests\)/)
  assert.match(repository, /sectionErrors/)
})
