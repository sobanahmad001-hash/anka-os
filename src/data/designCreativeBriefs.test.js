import test from 'node:test'
import assert from 'node:assert/strict'
import { creativeBriefForContext, creativeBriefVersionsForDirectionContext, emptyCreativeBrief, latestBriefVersion, validateCreativeBrief, validateCreativeBriefVersionSelection, workingPreferenceForSession } from './designCreativeBriefs.js'

test('title-only creative briefs can be saved while validation remains computed and incomplete', () => {
  const brief = { ...emptyCreativeBrief(), title: 'Launch image' }
  assert.equal(validateCreativeBrief(brief).valid, false)
  assert.deepEqual(validateCreativeBrief(brief).missing, ['purpose', 'audience', 'objective', 'placement_destination', 'requested_outputs'])
})

test('output validation uses the approved image identity web and social matrices', () => {
  const common = { title: 'A', purpose: 'P', audience: 'A', objective: 'O', placement_destination: 'D', requested_outputs: ['One'], exclusions_constraints: 'No red', rights_notes: 'Licensed' }
  for (const output_type of ['image', 'brand_identity', 'website', 'social']) {
    assert.equal(validateCreativeBrief({ ...common, output_type }).valid, true)
  }
  assert.deepEqual(validateCreativeBrief({ ...common, output_type: 'video' }), {
    valid: false, output_type: 'video', missing: ['supported output type'], unsupported: true,
  })
})

test('latest version recovery and working direction lookup use exact IDs', () => {
  const brief = { id: 'brief-1' }
  assert.equal(latestBriefVersion(brief, [
    { id: 'v2', creative_brief_id: 'brief-1', version_number: 2 },
    { id: 'other', creative_brief_id: 'brief-2', version_number: 9 },
    { id: 'v1', creative_brief_id: 'brief-1', version_number: 1 },
  ]).id, 'v2')
  assert.equal(workingPreferenceForSession([{ session_id: 's1', direction_version_id: 'd1' }], 's1').direction_version_id, 'd1')
})

test('official briefs resolve only the exact service and typed work context', () => {
  const briefs = [
    { id: 'engagement', organization_id: 'org-1', engagement_id: 'eng-1', visibility: 'official', engagement_service_id: 'service-1', project_task_id: null, engagement_work_item_id: null },
    { id: 'task-a', organization_id: 'org-1', engagement_id: 'eng-1', visibility: 'official', engagement_service_id: 'service-1', project_task_id: 'task-a', engagement_work_item_id: null },
    { id: 'task-b', organization_id: 'org-1', engagement_id: 'eng-1', visibility: 'official', engagement_service_id: 'service-1', project_task_id: 'task-b', engagement_work_item_id: null },
    { id: 'item-a', organization_id: 'org-1', engagement_id: 'eng-1', visibility: 'official', engagement_service_id: 'service-1', project_task_id: null, engagement_work_item_id: 'item-a' },
    { id: 'item-b', organization_id: 'org-1', engagement_id: 'eng-1', visibility: 'official', engagement_service_id: 'service-1', project_task_id: null, engagement_work_item_id: 'item-b' },
    { id: 'other-service', organization_id: 'org-1', engagement_id: 'eng-1', visibility: 'official', engagement_service_id: 'service-2', project_task_id: 'task-a', engagement_work_item_id: null },
    { id: 'other-engagement', organization_id: 'org-1', engagement_id: 'eng-2', visibility: 'official', engagement_service_id: 'service-1', project_task_id: 'task-a', engagement_work_item_id: null },
  ]
  const resolve = record => creativeBriefForContext(briefs, 'org-1', 'eng-1', 'service-1', record)
  assert.equal(resolve(null).id, 'engagement')
  assert.equal(resolve({ kind: 'project_task', id: 'task-a' }).id, 'task-a')
  assert.equal(resolve({ kind: 'project_task', id: 'task-b' }).id, 'task-b')
  assert.equal(resolve({ kind: 'project_task', id: 'task-a' }).id, 'task-a')
  assert.equal(resolve({ kind: 'engagement_work_item', id: 'item-a' }).id, 'item-a')
  assert.equal(resolve({ kind: 'engagement_work_item', id: 'item-b' }).id, 'item-b')
  assert.equal(resolve({ kind: 'engagement_work_item', id: 'item-a' }).id, 'item-a')
  assert.equal(resolve({ kind: 'project_task', id: 'missing' }), null)
  assert.equal(resolve({ kind: 'engagement_work_item', id: 'missing' }), null)
  assert.equal(creativeBriefForContext(briefs, 'org-1', 'eng-1', 'service-2', null), null)
  assert.equal(creativeBriefForContext(briefs, 'org-1', 'eng-2', 'service-1', null), null)
  assert.equal(resolve({ kind: 'unknown', id: 'task-a' }), null)
  assert.equal(resolve({ kind: 'project_task', id: '' }), null)
  assert.equal(creativeBriefForContext([...briefs, { ...briefs[1], id: 'ambiguous-task-a' }], 'org-1', 'eng-1', 'service-1', { kind: 'project_task', id: 'task-a' }), null)
})

test('Refine options expose only versions from the direction session exact context', () => {
  const sessions = [
    { id: 's-task-a', organization_id: 'org-1', engagement_id: 'eng-1', engagement_service_id: 'service-1', project_task_id: 'task-a', engagement_work_item_id: null },
    { id: 's-item-a', organization_id: 'org-1', engagement_id: 'eng-1', engagement_service_id: 'service-1', project_task_id: null, engagement_work_item_id: 'item-a' },
    { id: 's-eng', organization_id: 'org-1', engagement_id: 'eng-1', engagement_service_id: 'service-1', project_task_id: null, engagement_work_item_id: null },
  ]
  const briefs = [
    ['task-a', 'org-1', 'eng-1', 'service-1', 'task-a', null],
    ['task-b', 'org-1', 'eng-1', 'service-1', 'task-b', null],
    ['item-a', 'org-1', 'eng-1', 'service-1', null, 'item-a'],
    ['item-b', 'org-1', 'eng-1', 'service-1', null, 'item-b'],
    ['eng', 'org-1', 'eng-1', 'service-1', null, null],
    ['other-service', 'org-1', 'eng-1', 'service-2', 'task-a', null],
    ['other-engagement', 'org-1', 'eng-2', 'service-1', 'task-a', null],
    ['other-org', 'org-2', 'eng-1', 'service-1', 'task-a', null],
  ].map(([id, organization_id, engagement_id, engagement_service_id, project_task_id, engagement_work_item_id]) => ({
    id, organization_id, engagement_id, engagement_service_id, project_task_id, engagement_work_item_id, visibility: 'official',
  }))
  const versions = briefs.flatMap(brief => [1, 2].map(version_number => ({
    id: `${brief.id}-v${version_number}`, organization_id: brief.organization_id,
    creative_brief_id: brief.id, version_number,
  })))
  const options = sessionId => creativeBriefVersionsForDirectionContext(
    { session_id: sessionId, organization_id: 'org-1' }, sessions, briefs, versions,
  ).map(item => item.id)
  assert.deepEqual(options('s-task-a'), ['task-a-v1', 'task-a-v2'])
  assert.deepEqual(options('s-item-a'), ['item-a-v1', 'item-a-v2'])
  assert.deepEqual(options('s-eng'), ['eng-v1', 'eng-v2'])
  assert.deepEqual(options('missing'), [])
  assert.deepEqual(creativeBriefVersionsForDirectionContext(
    { session_id: 's-task-a', organization_id: 'org-2' }, sessions, briefs, versions,
  ), [])
  assert.deepEqual(validateCreativeBriefVersionSelection('task-a-v2', creativeBriefVersionsForDirectionContext(
    { session_id: 's-task-a', organization_id: 'org-1' }, sessions, briefs, versions,
  )), { valid: true, error: '' })
  assert.equal(validateCreativeBriefVersionSelection('task-b-v1', creativeBriefVersionsForDirectionContext(
    { session_id: 's-task-a', organization_id: 'org-1' }, sessions, briefs, versions,
  )).valid, false)
})
