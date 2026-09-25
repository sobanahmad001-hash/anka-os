import assert from 'node:assert/strict'
import test from 'node:test'
import { loadVisibleWorkSummary } from '../../supabase/functions/_shared/contextChatRecordSummary.js'

const org = '11111111-1111-4111-8111-111111111111'
const otherOrg = '99999999-9999-4999-8999-999999999999'
const projectId = '22222222-2222-4222-8222-222222222222'
const assigneeId = '33333333-3333-4333-8333-333333333333'

function client(tables, errors = {}) {
  const calls = []
  return {
    calls,
    from(table) {
      calls.push(table)
      const filters = []
      let limit = Infinity
      let order = null
      const query = {
        select(columns) { calls.push(table + ':' + columns); return query },
        eq(field, value) { filters.push(row => row[field] === value); return query },
        is(field, value) { filters.push(row => row[field] === value); return query },
        in(field, values) { filters.push(row => values.includes(row[field])); return query },
        order(field, options) { order = { field, descending: options.ascending === false }; return query },
        limit(value) { limit = value; return query },
        maybeSingle() { return Promise.resolve(result(true)) },
        then(resolve, reject) { return Promise.resolve(result(false)).then(resolve, reject) },
      }
      function result(single) {
        if (errors[table]) return { data: null, error: new Error('hidden database detail') }
        let rows = (tables[table] || []).filter(row => row.visible !== false && filters.every(match => match(row)))
        if (order) rows = [...rows].sort((a, b) => String(a[order.field] || '')
          .localeCompare(String(b[order.field] || '')) * (order.descending ? -1 : 1))
        rows = rows.slice(0, limit)
        return { data: single ? rows[0] || null : rows, error: null }
      }
      return query
    },
  }
}

const project = { id: projectId, organization_id: org, name: 'Website',
  status: 'active', health: 'at_risk', updated_at: '2026-09-25', archived_at: null }

test('selected project sends only RLS-visible capped task fields and separates canonical task models', async () => {
  const source = client({
    tasks: [
      { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', organization_id: org,
        project_id: projectId, title: 'Fix launch page for alice@example.com https://files.example/a +1 555 123 4567',
        description: 'private raw task notes', status: 'blocked', due_date: '2026-09-24',
        assigned_to: assigneeId, archived_at: null, updated_at: '2026-09-25' },
      { id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', organization_id: otherOrg,
        project_id: projectId, title: 'Other org secret', status: 'blocked',
        archived_at: null, updated_at: '2026-09-25' },
      { id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', organization_id: org,
        project_id: projectId, title: 'Hidden task', status: 'ready', visible: false,
        archived_at: null, updated_at: '2026-09-25' },
    ],
    engagements: [{ id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      organization_id: org, legacy_project_id: projectId }],
    work_items: [{ id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
      organization_id: org, engagement_id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      title: 'Review website build', status: 'in_progress', due_date: '2026-09-28',
      assignee_id: assigneeId, deleted_at: null, updated_at: '2026-09-25' }],
    deliverable_versions: [{ id: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
      organization_id: org, project_id: projectId,
      deliverable_id: '12121212-1212-4212-8212-121212121212',
      version_number: 2, review_status: 'ready_for_internal_review',
      withdrawn_at: null, created_at: '2026-09-25' }],
    profiles: [{ id: assigneeId, full_name: 'Jamie Example', email: 'never@send.test' }],
  })
  const result = await loadVisibleWorkSummary(source, org, project,
    'What is blocked on the website and under review?', '2026-09-25T00:00:00.000Z')
  const payload = JSON.stringify(result.summary)
  assert.equal(result.summary.scope, 'selected_project')
  assert.equal(result.summary.projects[0].project_tasks.length, 1)
  assert.equal(result.summary.projects[0].engagement_work_items.length, 1)
  assert.equal(result.summary.projects[0].project_tasks[0].assignee, 'Jamie Example')
  assert.equal(result.summary.projects[0].review_states_in_recent_visible_version_sample.ready_for_internal_review, 1)
  assert.equal(payload.includes('alice@example.com'), false)
  assert.equal(payload.includes('files.example'), false)
  assert.equal(payload.includes('555 123 4567'), false)
  assert.equal(payload.includes('never@send.test'), false)
  assert.equal(payload.includes('private raw'), false)
  assert.equal(payload.includes('Other org secret'), false)
  assert.equal(payload.includes('Hidden task'), false)
  assert.equal(payload.includes(projectId), false)
  assert.equal(payload.includes('aaaaaaaa-aaaa'), false)
  assert.deepEqual(result.manifest.project_ids, [projectId])
  assert.deepEqual(result.manifest.review_version_ids, ['ffffffff-ffff-4fff-8fff-ffffffffffff'])
  assert.equal(source.calls.includes('deliverable_versions:id,review_status,created_at'), true)
  assert.equal(source.calls.includes('profiles:id,full_name'), true)
})

test('organization mode marks omitted visible projects and never reads hidden or another organization', async () => {
  const projects = Array.from({ length: 6 }, (_, index) => ({
    id: String(index + 1), organization_id: org, name: 'Project ' + index,
    status: 'active', health: 'on_track', archived_at: null,
    updated_at: '2026-09-' + String(25 - index).padStart(2, '0'),
  }))
  const source = client({ projects: [
    ...projects, { id: 'hidden', organization_id: org, name: 'Hidden',
      archived_at: null, visible: false },
    { id: 'foreign', organization_id: otherOrg, name: 'Foreign', archived_at: null },
  ] })
  const result = await loadVisibleWorkSummary(source, org, null, 'project progress',
    '2026-09-25T00:00:00.000Z')
  assert.equal(result.summary.scope, 'current_organization_visible_project_sample')
  assert.equal(result.summary.coverage.visible_projects_scanned, 6)
  assert.equal(result.summary.coverage.projects_included, 4)
  assert.equal(result.summary.coverage.projects_omitted_from_bounded_summary, true)
  assert.equal(result.manifest.partial, true)
  assert.equal(JSON.stringify(result.summary).includes('Hidden'), false)
  assert.equal(JSON.stringify(result.summary).includes('Foreign'), false)
})

test('record lookup errors fail before constructing a provider summary', async () => {
  const source = client({}, { tasks: true })
  await assert.rejects(loadVisibleWorkSummary(source, org, project, 'what next'),
    /Authorized project tasks are unavailable/)
})

test('the audit manifest attributes all 50 sampled rows in each count and excludes withdrawn reviews', async () => {
  const rows = Array.from({ length: 51 }, (_, index) => ({
    id: 'row-' + index, organization_id: org, project_id: projectId,
    status: 'blocked', title: 'Task ' + index, archived_at: null,
    updated_at: '2026-09-25T' + String(59 - index).padStart(2, '0') + ':00:00Z',
  }))
  const source = client({
    tasks: rows,
    engagements: [{ id: 'engagement', organization_id: org, legacy_project_id: projectId }],
    work_items: rows.map(row => ({ ...row, id: 'work-' + row.id,
      engagement_id: 'engagement', status: 'in_progress', deleted_at: null })),
    deliverable_versions: [
      ...rows.map(row => ({ ...row, id: 'version-' + row.id,
        review_status: 'ready_for_internal_review', withdrawn_at: null,
        created_at: row.updated_at })),
      { id: 'withdrawn', organization_id: org, project_id: projectId,
        review_status: 'client_approved', withdrawn_at: '2026-09-25',
        created_at: '2026-09-26' },
    ],
  })
  const { summary, manifest } = await loadVisibleWorkSummary(source, org, project, 'status',
    '2026-09-25T00:00:00.000Z')
  const row = summary.projects[0]
  assert.equal(row.sample.project_tasks, 50)
  assert.equal(row.sample.engagement_work_items, 50)
  assert.equal(row.sample.project_task_statuses.blocked, 50)
  assert.equal(row.sample.engagement_work_item_statuses.in_progress, 50)
  assert.equal(row.review_states_in_recent_visible_version_sample.ready_for_internal_review, 50)
  assert.equal(row.review_states_in_recent_visible_version_sample.client_approved, undefined)
  assert.equal(row.sample.more_records_possible, true)
  assert.equal(manifest.project_task_ids.length, 50)
  assert.equal(manifest.engagement_work_item_ids.length, 50)
  assert.equal(manifest.review_version_ids.length, 50)
  assert.equal(manifest.review_version_ids.includes('withdrawn'), false)
  assert.equal(manifest.partial, true)
})

test('organization scan caps at 20 and profile read failure cannot expose contact data', async () => {
  const projects = Array.from({ length: 21 }, (_, index) => ({
    ...project, id: 'project-' + index, name: 'Project ' + index,
    updated_at: '2026-09-25T' + String(59 - index).padStart(2, '0') + ':00:00Z',
  }))
  const source = client({ projects })
  const orgResult = await loadVisibleWorkSummary(source, org, null, 'progress',
    '2026-09-25T00:00:00.000Z')
  assert.equal(orgResult.summary.coverage.visible_projects_scanned, 20)
  assert.equal(orgResult.summary.coverage.projects_included, 4)
  assert.equal(orgResult.summary.coverage.more_visible_projects_possible, true)
  assert.equal(orgResult.manifest.scanned_project_ids.length, 20)
  assert.equal(orgResult.manifest.project_ids.length, 4)
  assert.equal(JSON.stringify(orgResult.summary).includes('Project 20'), false)

  const assigned = client({ tasks: [{ id: 'task', organization_id: org,
    project_id: projectId, title: 'Review', status: 'ready', archived_at: null,
    assigned_to: assigneeId, updated_at: '2026-09-25' }] }, { profiles: true })
  const selected = await loadVisibleWorkSummary(assigned, org, project, 'review',
    '2026-09-25T00:00:00.000Z')
  assert.equal(selected.summary.coverage.assignee_labels_available, false)
  assert.equal(selected.summary.projects[0].project_tasks[0].assignee, 'Assigned teammate')
  assert.deepEqual(selected.manifest.project_ids, [projectId])
  assert.deepEqual(selected.manifest.scanned_project_ids, [projectId])
  assert.equal(assigned.calls.includes('projects'), false)
})
