import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { buildPlanningWorkspace, effectivePlanningTimezone, planningRecord } from './planningModel.js'
import { createPlanningRepository } from './planningRepositoryFactory.js'

const workspace = {
  project: { id: 'p', client_id: 'c', engagement_type: 'project', planning_timezone: null },
  context: { client: { id: 'c', default_timezone: 'Asia/Karachi' } },
  projectTasks: [
    { id: 't-null', title: 'Undated', status: 'backlog', row_version: 2, due_date: null, created_at: '2026-01-01' },
    { id: 't-late', title: 'Late', status: 'ready', row_version: 1, due_date: '2026-03-10', created_at: '2026-01-01' },
    { id: 't-early', title: 'Early', status: 'blocked', row_version: 4, due_date: '2026-03-01', created_at: '2026-02-01' },
  ],
  engagementWorkItems: [
    { id: 'w-2', title: 'Second', status: 'in_progress', row_version: 3, position: 2000, assignee_id: 'u' },
    { id: 'w-1', title: 'First', status: 'not_started', row_version: 5, position: 1000, assignee_id: 'u' },
  ],
  taskDependencies: [{ task_id: 't-early', depends_on_task_id: 't-late' }],
  workItemDependencies: [{ work_item_id: 'w-2', depends_on_work_item_id: 'w-1' }],
}

test('P5 preserves two identities and deterministic native ordering', () => {
  const result = buildPlanningWorkspace(workspace)
  assert.deepEqual(result.projectTasks.map(row => row.id), ['t-early', 't-late', 't-null'])
  assert.deepEqual(result.engagementWorkItems.map(row => row.id), ['w-1', 'w-2'])
  assert.equal(result.projectTasks[0].canDrag, false)
  assert.equal(result.engagementWorkItems[0].canDrag, true)
  assert.deepEqual(result.records.map(row => row.key), ['project_task:t-early', 'project_task:t-late', 'project_task:t-null', 'engagement_work_item:w-1', 'engagement_work_item:w-2'])
  assert.equal(result.projectTasks[0].dependencies.length, 1)
  assert.equal(result.engagementWorkItems[1].dependencies.length, 1)
})

test('P5 keeps native lifecycles and workload categories separate', () => {
  const result = buildPlanningWorkspace(workspace)
  assert.equal(result.board.projectTasks.backlog.length, 1)
  assert.equal(result.board.projectTasks.ready.length, 1)
  assert.equal(result.board.engagementWorkItems.not_started.length, 1)
  assert.equal(result.workload.find(row => row.assigneeId === 'u').engagementWorkItems, 2)
  assert.equal(planningRecord('project_task', workspace.projectTasks[0]).position, null)
  assert.throws(() => planningRecord('combined', {}), /Unsupported/)
})

test('P5 timezone hierarchy is dynamic and internal projects never inherit clients', () => {
  assert.equal(effectivePlanningTimezone(workspace.project, workspace.context.client), 'Asia/Karachi')
  assert.equal(effectivePlanningTimezone({ ...workspace.project, planning_timezone: 'Europe/London' }, workspace.context.client), 'Europe/London')
  assert.equal(effectivePlanningTimezone({ ...workspace.project, engagement_type: 'internal' }, workspace.context.client), 'UTC')
  assert.equal(effectivePlanningTimezone({ ...workspace.project, client_id: null }, workspace.context.client), 'UTC')
})

function clientWith(result) {
  return { functions: { invoke: async (name, params) => ({ ...result, name, params }) } }
}

test('P5 mutations always carry organization and expected row version', async () => {
  const calls = []
  const repository = createPlanningRepository({ functions: { invoke: async (name, params) => { calls.push({ name, params }); return { data: { data: { id: params.body.taskId || params.body.workItemId } }, error: null } } } })
  await repository.updateProjectTask('org', { id: 'task', row_version: 7, status: 'ready', assigned_to: null, due_date: null }, { status: 'in_progress' })
  await repository.updateWorkItem('org', { id: 'item', row_version: 9, assignee_id: null, department_id: 'design' }, { dueDate: '2026-09-09' })
  await repository.moveWorkItem('org', { id: 'item', row_version: 10 }, 'done')
  assert.deepEqual(calls.map(call => call.params.body.expectedRowVersion), [7, 9, 10])
  assert.ok(calls.every(call => call.params.body.organizationId === 'org'))
  assert.ok(calls.every(call => call.name === 'work-items'))
})

test('P5 maps serialization failures to a typed 409 conflict', async () => {
  const repository = createPlanningRepository(clientWith({ data: { error: { code: 'stale_write', recordKind: 'engagement_work_item', recordId: 'item', expectedRowVersion: 1, currentRowVersion: 2 } }, error: null }))
  await assert.rejects(
    repository.moveWorkItem('org', { id: 'item', row_version: 1 }, 'done'),
    error => error.status === 409 && error.stale === true
  )
})

test('P5 migration and verifier enforce the approved database boundary', () => {
  const migration = readFileSync(new URL('../../supabase/migrations/20260904120000_p5_unified_planning.sql', import.meta.url), 'utf8')
  const verifier = readFileSync(new URL('../../supabase/verify_20260904120000_p5_unified_planning.sql', import.meta.url), 'utf8')
  assert.match(migration, /clients add column default_timezone text/)
  assert.match(migration, /projects add column planning_timezone text/)
  assert.match(migration, /tasks add column row_version bigint not null default 1/)
  assert.match(migration, /work_items add column row_version bigint not null default 1/)
  assert.match(migration, /pg_catalog\.pg_timezone_names/)
  assert.match(migration, /membership\.role in \('system_owner', 'operations_admin'\)/)
  assert.match(migration, /'code', 'stale_write'[\s\S]*'expectedRowVersion'[\s\S]*'currentRowVersion'/)
  assert.match(migration, /order by item\.id\s+for update/)
  assert.match(migration, /projects_client_organization_fkey/)
  assert.match(migration, /tasks_project_organization_fkey/)
  assert.match(migration, /on delete set null \(client_id\)/)
  assert.match(migration, /security invoker/g)
  assert.doesNotMatch(migration, /security definer|create policy|alter table .* disable row level security/i)
  assert.match(verifier, /invalid_timezone_sqlstate/)
  assert.match(verifier, /stale_task_exact_typed_payload/)
  assert.match(verifier, /stale_work_item_exact_typed_payload/)
  assert.match(verifier, /atomic_move_returns_all_changed_rows/)
  assert.match(verifier, /rollback;\s*$/)
})

test('P5 is wired into Project Workspace without cross-type drag or browser date conversion', () => {
  const workspaceSource = readFileSync(new URL('../apps/ProjectEngagementWorkspace.jsx', import.meta.url), 'utf8')
  const planningSource = readFileSync(new URL('../components/ProjectPlanningPanel.jsx', import.meta.url), 'utf8')
  const repositorySource = readFileSync(new URL('./projectEngagementWorkspaceRepository.js', import.meta.url), 'utf8')
  const workItemsSource = readFileSync(new URL('../components/WorkItemsPanel.jsx', import.meta.url), 'utf8')
  const myWorkSource = readFileSync(new URL('../apps/MyWork.jsx', import.meta.url), 'utf8')
  const deliverySource = readFileSync(new URL('./deliveryRepository.js', import.meta.url), 'utf8')

  assert.match(workspaceSource, /\['planning', 'Planning'\]/)
  assert.match(workspaceSource, /<ProjectPlanningPanel[\s\S]*organizationId=\{activeOrganizationId\}[\s\S]*membership=\{activeMembership\}/)
  assert.match(planningSource, /Project Tasks are not draggable/)
  assert.match(planningSource, /WORK_ITEM_STATUSES\.map\(status/)
  assert.match(planningSource, /title="Timeline"/)
  assert.doesNotMatch(planningSource, /new Date\(|Date\.parse|toLocaleDateString/)
  assert.match(planningSource, /if \(cause\.status === 409\) await onRefresh\(\)/)
  assert.match(repositorySource, /from\('task_dependencies'\)[\s\S]*\.eq\('organization_id', organizationId\)[\s\S]*\.eq\('project_id', projectId\)/)
  assert.match(repositorySource, /from\('work_item_dependencies'\)[\s\S]*\.eq\('organization_id', organizationId\)[\s\S]*\.in\('work_item_id', workItemIds\)/)
  assert.doesNotMatch(workItemsSource, /planWorkItemBoardMove/)
  assert.match(workItemsSource, /workItems\.remove\(workspace\.engagement\.organization_id, editor\.id, editor\.row_version\)/)
  assert.match(workItemsSource, /workItems\.addDependency\(workspace\.engagement\.organization_id, editor\.id, dependencyCandidate, editor\.row_version\)/)
  assert.match(workItemsSource, /workItems\.removeDependency\(workspace\.engagement\.organization_id, workItemId, dependsOnWorkItemId, source\?\.row_version\)/)
  assert.match(workItemsSource, /workItems\.acknowledgeAutomationFlag\(workspace\.engagement\.organization_id, item\.id, item\.row_version\)/)
  assert.match(workItemsSource, /workItems\.move\(workspace\.engagement\.organization_id, item\.id, item\.row_version, targetStatus, beforeWorkItemId\)/)
  assert.match(myWorkSource, /transitionTask\(task\.id, status, task\.completion_evidence \|\| '', task\.row_version, activeOrganizationId\)/)
  assert.match(deliverySource, /action: 'transition_task'[\s\S]*expectedRowVersion: Number\(expectedRowVersion\)/)
})
