import assert from 'node:assert/strict'
import test from 'node:test'

import { getDepartmentWorkshopContext, getDepartmentWorkshopVisibleData, getReceivingWorkstreams } from './departmentWorkshopModel.js'

const baseWorkspace = {
  workstreams: [
    { id: 'ws-content', project_id: 'p-content', projects: { id: 'p-content', name: 'Project A' } },
    { id: 'ws-marketing', project_id: 'p-marketing', projects: { id: 'p-marketing', name: 'Project B' } },
  ],
  relatedWorkstreams: [
    { id: 'ws-delivery', project_id: 'p-content', name: 'Development Workstream' },
    { id: 'ws-other', project_id: 'p-marketing', name: 'Other Stream' },
  ],
  engagements: [
    { id: 'e-content', project_id: 'p-content', name: 'Engagement A' },
    { id: 'e-marketing', project_id: 'p-marketing', name: 'Engagement B' },
  ],
  tasks: [
    { id: 'task-1', workstream_id: 'ws-content' },
    { id: 'task-2', workstream_id: 'ws-marketing' },
  ],
  workItems: [
    { id: 'wi-1', project_id: 'p-content', engagement_id: 'e-content', status: 'in_progress' },
    { id: 'wi-2', project_id: 'p-marketing', engagement_id: 'e-marketing', status: 'in_progress' },
  ],
  services: [
    { id: 'svc-valid', engagement_id: 'e-content' },
    { id: 'svc-missing', engagement_id: null },
    { id: 'svc-other', engagement_id: 'e-marketing' },
  ],
  stages: [
    { id: 'stg-valid', engagement_id: 'e-content', name: 'Stage A' },
    { id: 'stg-missing', engagement_id: undefined, name: 'Unlinked Stage' },
  ],
  research: [{ id: 'r-1', workstream_id: null }, { id: 'r-2', workstream_id: 'ws-content' }],
  deliverables: [{ id: 'd-1', workstream_id: 'ws-content' }, { id: 'd-2', workstream_id: 'ws-marketing' }],
  requests: [{ id: 'req-1', requesting_workstream_id: 'ws-content', receiving_workstream_id: 'ws-other' }],
  milestones: [
    { id: 'm-1', project_id: 'p-content' },
    { id: 'm-2', project_id: 'p-marketing' },
  ],
}

test('department workshop: empty workspace stays safe and empty', () => {
  const workspace = {
    workstreams: [],
    engagements: [],
    relatedWorkstreams: [],
    tasks: [],
    workItems: [],
    services: [],
    stages: [],
    research: [],
    deliverables: [],
    requests: [],
    milestones: [],
  }

  const context = getDepartmentWorkshopContext(workspace, '')
  const visible = getDepartmentWorkshopVisibleData(workspace, '', context)

  assert.equal(context.selectedProjectId, null)
  assert.equal(context.hasContext, false)
  assert.deepEqual(context.engagementIds, [])
  assert.equal(visible.tasks.length, 0)
  assert.equal(visible.services.length, 0)
  assert.equal(visible.stages.length, 0)
})

test('department workshop: no selected engagement yields no service/stage joins', () => {
  const workspace = {
    ...baseWorkspace,
    engagements: [],
  }

  const context = getDepartmentWorkshopContext(workspace, 'ws-content')
  const visible = getDepartmentWorkshopVisibleData(workspace, 'ws-content', context)

  assert.equal(context.hasContext, false)
  assert.equal(context.selectedProjectId, 'p-content')
  assert.equal(context.engagementIds.length, 0)
  assert.equal(visible.services.length, 0)
  assert.equal(visible.stages.length, 0)
  assert.equal(visible.workItems.length, 0)
  assert.equal(visible.milestones.length, 0)
})

test('department workshop: missing service/stage values are ignored in exact matching', () => {
  const workspace = {
    ...baseWorkspace,
    services: [
      ...baseWorkspace.services,
      { id: 'svc-null-id', engagement_id: undefined },
    ],
    stages: [
      ...baseWorkspace.stages,
      { id: 'stg-invalid-workspace', engagement_id: null, name: 'Unknown' },
    ],
  }

  const context = getDepartmentWorkshopContext(workspace, 'ws-content')
  const visible = getDepartmentWorkshopVisibleData(workspace, 'ws-content', context)

  assert.equal(context.hasContext, true)
  assert.deepEqual(visible.services.map((item) => item.id).sort(), ['svc-valid'])
  assert.deepEqual(visible.stages.map((item) => item.id).sort(), ['stg-valid'])
})

test('department workshop: exact context includes only exact project engagement matches', () => {
  const context = getDepartmentWorkshopContext(baseWorkspace, 'ws-content')
  const visible = getDepartmentWorkshopVisibleData(baseWorkspace, 'ws-content', context)

  assert.equal(context.hasContext, true)
  assert.equal(context.selectedProjectId, 'p-content')
  assert.deepEqual(context.engagementIds, ['e-content'])
  assert.deepEqual(visible.services.map((item) => item.id), ['svc-valid'])
  assert.deepEqual(visible.stages.map((item) => item.id), ['stg-valid'])
  assert.deepEqual(visible.workItems.map((item) => item.id), ['wi-1'])

  const invalidContext = getDepartmentWorkshopContext(baseWorkspace, 'ws-marketing')
  const invalidVisible = getDepartmentWorkshopVisibleData(baseWorkspace, 'ws-marketing', invalidContext)

  assert.equal(invalidContext.selectedProjectId, 'p-marketing')
  assert.deepEqual(invalidContext.engagementIds, ['e-marketing'])
  assert.deepEqual(invalidVisible.services.map((item) => item.id), ['svc-other'])
  assert.deepEqual(invalidVisible.stages.map((item) => item.id), [])
  assert.deepEqual(invalidVisible.workItems.map((item) => item.id), ['wi-2'])
})

test('department workshop: related workstream matching only uses validated project context', () => {
  const receivingForContent = getReceivingWorkstreams(baseWorkspace, 'ws-content', 'p-content')
  const receivingForMissing = getReceivingWorkstreams(baseWorkspace, 'ws-content', null)

  assert.equal(receivingForContent.length, 1)
  assert.equal(receivingForContent[0].id, 'ws-delivery')
  assert.equal(receivingForMissing.length, 0)
})

