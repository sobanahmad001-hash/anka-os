import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { buildRetainerReview, createReviewLoader, reviewCanonicalStart, reviewLocalDate, reviewMonthDays } from './retainerReview.js'
import { createRetainerReviewRepository } from './retainerReviewRepository.js'

const scope = { organizationId: 'org', projectId: 'project', engagementId: 'eng', actorId: 'reader', revision: 1, month: '2026-09' }
const owned = { organization_id: 'org', project_id: 'project', engagement_id: 'eng' }
const occurrence = (id, start, version = 'v1') => ({ ...owned, id, plan_id: 'plan', plan_version_id: version, period_start: start })
const work = (id, occ, status) => ({ ...owned, id, title: id, status, created_via: 'recurring_plan', recurring_plan_id: 'plan', recurring_plan_version_id: 'v1', recurring_occurrence_id: occ, deleted_at: null })
function fixture() {
  return {
    project: { id: 'project', organization_id: 'org', engagement_type: 'retainer' },
    engagement: { ...owned, id: 'eng', status: 'active' },
    plans: [{ ...owned, id: 'plan', status: 'active', engagement_service_id: 'service' }],
    versions: [{ id: 'v1', organization_id: 'org', plan_id: 'plan', version_number: 1, effective_start: '2026-01-01', effective_end: null, frequency: 'monthly', timezone: 'Asia/Karachi', title: 'Commitment' }],
    approvals: [{ id: 'approval', organization_id: 'org', plan_id: 'plan', plan_version_id: 'v1' }],
    templateItems: [{ id: 'template', organization_id: 'org', plan_id: 'plan', plan_version_id: 'v1', title: 'Monthly work' }],
    occurrences: [occurrence('sep', '2026-09-01'), occurrence('aug', '2026-08-01')],
    workItems: [work('done-now', 'sep', 'done'), work('open-now', 'aug', 'in_progress'), work('old-done', 'aug', 'done')],
    dependencies: [],
    services: [{ id: 'service', organization_id: 'org', engagement_id: 'eng', status: 'active', catalog_active: true }],
  }
}
const now = new Date('2026-09-01T00:00:00Z')
test('RET5 completed and carryover use period provenance and current status without mutations', () => {
  const snapshot = fixture()
  snapshot.workItems[0].updated_at = '2026-10-01'
  snapshot.occurrences[0].generated_at = '2026-08-01'
  const before = JSON.stringify(snapshot)
  const result = buildRetainerReview(snapshot, scope, now)
  assert.deepEqual(result.cards[0].completed.map(row => row.id), ['done-now'])
  assert.deepEqual(result.cards[0].carryover.map(row => row.id), ['open-now'])
  assert.equal(JSON.stringify(snapshot), before)
  snapshot.workItems[0].status = 'in_progress'
  assert.equal(buildRetainerReview(snapshot, scope, now).summary.completed, 0)
})
test('RET5 excludes deleted, foreign, unmatched and nonrecurring work; deduplicates reads', () => {
  const snapshot = fixture()
  snapshot.workItems.push(snapshot.workItems[0], { ...work('foreign', 'sep', 'done'), organization_id: 'other' },
    { ...work('deleted', 'aug', 'blocked'), deleted_at: '2026-09-01' },
    { ...work('quick', 'sep', 'done'), created_via: 'quick_task_promotion' },
    work('orphan', 'missing', 'done'), { ...work('bad-version', 'sep', 'done'), recurring_plan_version_id: 'other' })
  assert.equal(buildRetainerReview(snapshot, scope, now).summary.completed, 1)
  assert.equal(buildRetainerReview(snapshot, scope, now).summary.carryover, 1)
  assert.throws(() => buildRetainerReview(snapshot, { ...scope, organizationId: 'other' }, now), /unavailable/)
})
test('RET5 current blockers require visible unfinished endpoints and exclude done targets', () => {
  const snapshot = fixture()
  snapshot.workItems.push({ ...work('blocked', 'sep', 'blocked') }, { ...work('target', 'sep', 'not_started'), created_via: 'manual' },
    { ...work('foreign', 'sep', 'blocked'), organization_id: 'other' })
  snapshot.dependencies.push(...['target', 'old-done', 'foreign', 'missing', 'target'].map(id => ({ organization_id: 'org', work_item_id: 'open-now', depends_on_work_item_id: id })))
  const blockers = buildRetainerReview(snapshot, scope, now).cards[0].blockers
  assert.deepEqual(blockers.map(row => row.work.id).sort(), ['blocked', 'open-now'])
  assert.deepEqual(blockers.find(row => row.work.id === 'open-now').dependencies.map(row => row.id), ['target'])
})
test('RET5 canonical dates match weekly anchors and short-month clamp without drift', () => {
  const monthly = { frequency: 'monthly', effective_start: '2024-01-31' }
  assert.equal(reviewCanonicalStart(monthly, '2024-02-29'), true)
  assert.equal(reviewCanonicalStart(monthly, '2024-03-31'), true)
  assert.equal(reviewCanonicalStart(monthly, '2024-03-29'), false)
  assert.equal(reviewCanonicalStart({ frequency: 'weekly', effective_start: '2026-08-31' }, '2026-09-07'), true)
  assert.equal(reviewCanonicalStart({ frequency: 'weekly', effective_start: '2026-08-31' }, '2026-09-08'), false)
  assert.equal(reviewMonthDays('2024-02').length, 29)
  assert.throws(() => reviewMonthDays('2026-13'), /valid/)
})
test('RET5 uses each version timezone for remaining starts across UTC and DST boundaries', () => {
  const instant = new Date('2026-09-01T02:00:00Z')
  assert.equal(reviewLocalDate(instant, 'America/Los_Angeles'), '2026-08-31')
  assert.equal(reviewLocalDate(instant, 'Asia/Karachi'), '2026-09-01')
  assert.equal(reviewLocalDate(new Date('2026-03-08T10:00:00Z'), 'America/Los_Angeles'), '2026-03-08')
  assert.equal(buildRetainerReview(fixture(), scope, new Date('2026-09-02T00:00:00Z')).summary.upcoming, 0)
})
test('RET5 historical and transition months select applicable approvals, excluding draft versions', () => {
  const snapshot = fixture()
  snapshot.versions.push({ ...snapshot.versions[0], id: 'v2', version_number: 2, effective_start: '2026-09-15', frequency: 'weekly' },
    { ...snapshot.versions[0], id: 'draft', version_number: 3, effective_start: '2026-09-01' })
  snapshot.approvals.push({ organization_id: 'org', plan_id: 'plan', plan_version_id: 'v2' })
  const result = buildRetainerReview(snapshot, scope, now).cards[0]
  assert.deepEqual(result.upcoming.map(row => row.period_start), ['2026-09-01', '2026-09-15', '2026-09-22', '2026-09-29'])
  assert.deepEqual(result.upcoming.map(row => row.version.id), ['v1', 'v2', 'v2', 'v2'])
  assert.deepEqual(buildRetainerReview(snapshot, { ...scope, month: '2026-08' }, new Date('2026-08-01')).cards[0].relevantVersions.map(row => row.id), ['v1'])
})
test('RET5 distinguishes generated from ungenerated and inactive commitments without generation eligibility', () => {
  const snapshot = fixture()
  let result = buildRetainerReview(snapshot, scope, now).cards[0].upcoming[0]
  assert.equal(result.occurrence.id, 'sep')
  assert.equal(result.templates.length, 0)
  snapshot.occurrences = []
  snapshot.plans[0].status = 'paused'
  result = buildRetainerReview(snapshot, scope, now).cards[0].upcoming[0]
  assert.equal(result.occurrence, null)
  assert.equal(result.active, false)
  assert.equal(result.templates[0].title, 'Monthly work')
  snapshot.approvals = []
  assert.equal(buildRetainerReview(snapshot, scope, now).summary.upcoming, 0)
})
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no }); return { promise, resolve, reject } }
test('RET5 recorded future occurrences survive anchor and frequency changes with original work identity', () => {
  for (const frequency of ['monthly', 'weekly']) {
    const snapshot = fixture()
    snapshot.occurrences[0].timezone = 'Asia/Karachi'
    snapshot.versions.push({ ...snapshot.versions[0], id: 'v2', version_number: 2, frequency, effective_start: '2026-08-15', timezone: 'America/Los_Angeles' })
    snapshot.approvals.push({ organization_id: 'org', plan_id: 'plan', plan_version_id: 'v2' })
    const before = JSON.stringify(snapshot)
    const card = buildRetainerReview(snapshot, scope, new Date('2026-08-31T00:00:00Z')).cards[0]
    const generated = card.upcoming.find(row => row.period_start === '2026-09-01')
    assert.equal(generated.occurrence.id, 'sep')
    assert.equal(generated.version.id, 'v1')
    assert.equal(generated.version.timezone, 'Asia/Karachi')
    assert.deepEqual(generated.templates, [])
    assert.ok(card.upcoming.some(row => !row.occurrence && row.version.id === 'v2'))
    assert.equal(card.completed[0].recurring_occurrence_id, 'sep')
    assert.equal(JSON.stringify(snapshot), before)
  }
})
test('RET5 same-date recorded occurrence wins projection and uses its frozen timezone for today', () => {
  const snapshot = fixture()
  snapshot.occurrences[0].timezone = 'America/Los_Angeles'
  snapshot.versions[0].timezone = 'America/Los_Angeles'
  snapshot.versions.push({ ...snapshot.versions[0], id: 'v2', version_number: 2, effective_start: '2026-08-01', timezone: 'Asia/Karachi' })
  snapshot.approvals.push({ organization_id: 'org', plan_id: 'plan', plan_version_id: 'v2' })
  let upcoming = buildRetainerReview(snapshot, scope, now).cards[0].upcoming
  assert.equal(upcoming.length, 1)
  assert.equal(upcoming[0].occurrence.id, 'sep')
  assert.equal(upcoming[0].version.id, 'v1')
  upcoming = buildRetainerReview(snapshot, scope, new Date('2026-09-02T02:00:00Z')).cards[0].upcoming
  assert.equal(upcoming.length, 1) // September 1 in recorded LA, September 2 in new Karachi.
  snapshot.occurrences[0].timezone = 'Asia/Karachi'
  snapshot.versions[1].timezone = 'America/Los_Angeles'
  assert.equal(buildRetainerReview(snapshot, scope, new Date('2026-09-02T02:00:00Z')).summary.upcoming, 0)
})
test('RET5 loader rejects delayed A responses, including A-B-A, actor/month/revision and unmount', async () => {
  for (const change of [{ organizationId: 'B' }, { actorId: 'B' }, { month: '2026-10' }, { revision: 2 }]) {
    const first = deferred(), second = deferred(), states = []
    let call = 0
    const loader = createReviewLoader(() => (++call === 1 ? first.promise : second.promise), state => states.push(state))
    const a = loader.load(scope)
    const b = loader.load({ ...scope, ...change })
    second.resolve({ marker: 'new' }); await b
    first.resolve({ marker: 'old' }); await a
    assert.equal(states.at(-1).snapshot.marker, 'new')
  }
  const request = deferred(), states = []
  const loader = createReviewLoader(() => request.promise, state => states.push(state))
  const pending = loader.load(scope); loader.cancel()
  request.resolve({}); await pending
  assert.equal(states.at(-1).status, 'loading')
})
test('RET5 loader surfaces initial/context failure and supports successful retry', async () => {
  const states = []; let fail = true
  const loader = createReviewLoader(async () => { if (fail) throw new Error('Read failed'); return fixture() }, state => states.push(state))
  await loader.load(scope)
  assert.equal(states.at(-1).status, 'error')
  await loader.load({ ...scope, engagementId: 'other' })
  assert.equal(states.at(-1).status, 'error')
  fail = false; await loader.load(scope)
  assert.equal(states.at(-1).status, 'ready')
})
function mockClient(tables, { cap = 500, failure = null } = {}) {
  const calls = []
  return { calls, from(table) {
    const filters = [], order = []
    const query = {
      select() { return query }, eq(key, value) { filters.push([key, value]); return query },
      order(key) { order.push(key); return query }, abortSignal() { return query },
      async range(from, to) {
        calls.push({ table, filters: [...filters], order, from, to })
        if (failure === table) return { error: { message: 'Access denied', code: '42501' }, status: 403 }
        const rows = (tables[table] || []).filter(row => filters.every(([key, value]) => row[key] === value))
        return { data: rows.slice(from, Math.min(to + 1, from + cap)), count: rows.length, error: null }
      },
    }
    return query
  } }
}
function tables() {
  const snapshot = fixture()
  return { projects: [snapshot.project], engagements: [snapshot.engagement], recurring_work_plans: snapshot.plans,
    recurring_work_plan_versions: snapshot.versions, recurring_work_plan_version_approvals: snapshot.approvals,
    recurring_work_plan_template_items: snapshot.templateItems, recurring_work_occurrences: snapshot.occurrences,
    work_items: snapshot.workItems, work_item_dependencies: [], engagement_services: [], service_catalog: [] }
}
test('RET5 repository scopes every query and reads beyond response caps without missing records', async () => {
  const data = tables()
  data.work_items = Array.from({ length: 1001 }, (_, i) => ({ ...owned, id: String(i), created_via: 'manual' }))
  const client = mockClient(data, { cap: 200 })
  const snapshot = await createRetainerReviewRepository(client).get(scope)
  assert.equal(snapshot.workItems.length, 1001)
  assert.ok(client.calls.every(call => call.filters.some(([key, value]) => key === 'organization_id' && value === 'org')))
  assert.equal(client.calls.filter(call => call.table === 'work_items').length, 6)
})
test('RET5 repository issues no query without selection and stops before foreign child reads', async () => {
  const client = mockClient(tables())
  const repo = createRetainerReviewRepository(client)
  await assert.rejects(repo.get({ ...scope, organizationId: null }), /Select/)
  assert.equal(client.calls.length, 0)
  await assert.rejects(repo.get({ ...scope, organizationId: 'other' }), /unavailable/)
  assert.deepEqual(client.calls.map(row => row.table), ['projects'])
})
test('RET5 repository retains access failure status and respects cancellation', async () => {
  const repo = createRetainerReviewRepository(mockClient(tables(), { failure: 'projects' }))
  await assert.rejects(repo.get(scope), error => error.status === 403 && error.code === '42501')
  const controller = new AbortController(); controller.abort()
  const client = mockClient(tables())
  await assert.rejects(createRetainerReviewRepository(client).get({ ...scope, signal: controller.signal }), /abort/i)
  assert.equal(client.calls.length, 0)
})
test('RET5 mounts within RET ownership and uses only read paths with explicit current-state labels', () => {
  const repository = readFileSync(new URL('./retainerReviewRepository.js', import.meta.url), 'utf8')
  const panel = readFileSync(new URL('../components/RetainerReviewPanel.jsx', import.meta.url), 'utf8')
  assert.doesNotMatch(repository, /\.(insert|update|delete|upsert|rpc|invoke)\(/)
  assert.match(panel, /Currently completed/)
  assert.match(panel, /Earlier-period work still open now/)
  assert.match(panel, /handleOrganizationAccessError/)
  assert.match(panel, /projectId === project.id/)
  assert.match(panel, /id=\{recordId\(item.id\)\}/)
})
