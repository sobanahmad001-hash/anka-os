import test from 'node:test'
import assert from 'node:assert/strict'

import {
  buildClientProjectProjection,
  buildInternalProjectProjection,
  projectProjectionToMarkdown,
} from './livingProjectRecord.js'

function workspace() {
  return {
    project: {
      id: 'project-1',
      name: 'North Star',
      engagement_type: 'project',
      status: 'active',
      health: 'on_track',
      priority: 'high',
      client_summary: 'The approved public progress summary.',
      description: 'Internal delivery description.',
      scope_statement: 'Confidential scope.',
      exclusions: 'Confidential exclusions.',
      owner_id: 'owner-1',
      client_id: 'client-1',
      due_date: '2026-09-30',
    },
    livingRecord: { id: 'record-1', source_version: 7 },
    workstreams: [
      { id: 'ws-1', name: 'Design', department_id: 'design', status: 'active', client_visible: true, owner_id: 'owner-1' },
      { id: 'ws-2', name: 'Content', department_id: 'content', status: 'active', client_visible: false, owner_id: 'owner-2' },
    ],
    tasks: [{ id: 'task-1', title: 'Internal task', status: 'in_progress', acceptance_criteria: 'Private test', assigned_to: 'user-1' }],
    dependencies: [{ id: 'dependency-1', task_id: 'task-1' }],
    milestones: [
      { id: 'milestone-1', name: 'Visible launch', status: 'planned', visibility: 'client_visible' },
      { id: 'milestone-2', name: 'Internal QA', status: 'planned', visibility: 'internal_only' },
    ],
    research: [{ id: 'research-1', title: 'Competitor research', findings: 'Private findings', status: 'draft' }],
    deliverables: [{
      id: 'deliverable-1',
      title: 'Homepage',
      status: 'client_reviewing',
      deliverable_versions: [
        { id: 'version-1', title: 'Homepage v1', version_number: 1, review_status: 'client_reviewing' },
        { id: 'version-2', title: 'Unreleased draft', version_number: 2, review_status: 'in_production' },
      ],
    }],
    requests: [
      { id: 'request-1', title: 'Client revision', status: 'open', visibility: 'client_visible', requested_output: 'Change hero' },
      { id: 'request-2', title: 'Internal request', status: 'open', visibility: 'internal_only', requested_output: 'Private' },
    ],
    activities: [
      { id: 'activity-1', event_type: 'release', summary: 'Homepage released', visibility: 'client_visible', occurred_at: '2026-08-25T10:00:00Z' },
      { id: 'activity-2', event_type: 'note', summary: 'Private note', visibility: 'internal_only', occurred_at: '2026-08-25T09:00:00Z' },
    ],
    portalItems: [{ source_type: 'deliverable_version', source_id: 'version-1', released_at: '2026-08-25T10:00:00Z' }],
  }
}

test('internal living record preserves operational detail', () => {
  const projection = buildInternalProjectProjection(workspace(), '2026-08-25T12:00:00Z')
  assert.equal(projection.source_version, 7)
  assert.equal(projection.tasks[0].acceptance_criteria, 'Private test')
  assert.equal(projection.research[0].findings, 'Private findings')
  assert.equal(projection.project.scope_statement, 'Confidential scope.')
})

test('client living record includes released and explicitly visible information only', () => {
  const projection = buildClientProjectProjection(workspace(), '2026-08-25T12:00:00Z')
  assert.equal(projection.project.summary, 'The approved public progress summary.')
  assert.deepEqual(projection.workstreams.map((item) => item.name), ['Design'])
  assert.deepEqual(projection.milestones.map((item) => item.name), ['Visible launch'])
  assert.deepEqual(projection.deliverables[0].versions.map((item) => item.id), ['version-1'])
  assert.deepEqual(projection.requests.map((item) => item.id), ['request-1'])
  assert.deepEqual(projection.recent_activity.map((item) => item.summary), ['Homepage released'])
})

test('client projection recursively excludes sensitive operational keys and values', () => {
  const serialized = JSON.stringify(buildClientProjectProjection(workspace())).toLowerCase()
  for (const forbidden of [
    'scope_statement',
    'confidential scope',
    'exclusions',
    'internal delivery description',
    'acceptance_criteria',
    'assigned_to',
    'private findings',
    'internal task',
    'unreleased draft',
    'private note',
    'provider',
    'prompt',
    'cost',
  ]) {
    assert.equal(serialized.includes(forbidden), false, `client projection leaked ${forbidden}`)
  }
})

test('markdown export is readable and contains projection identity', () => {
  const markdown = projectProjectionToMarkdown(buildClientProjectProjection(workspace(), '2026-08-25T12:00:00Z'))
  assert.match(markdown, /^# North Star — Client Progress Report/m)
  assert.match(markdown, /## Milestones/)
  assert.match(markdown, /Homepage/)
})
