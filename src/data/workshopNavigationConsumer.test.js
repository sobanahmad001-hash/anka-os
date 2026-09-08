import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import {
  appendWorkshopNavigation,
  parseWorkshopNavigation,
  validateWorkshopNavigation,
  workspaceReturnTarget,
} from './workshopNavigation.js'

const workspaceEntry = {
  organizationId: 'org-a',
  clientId: 'client-a',
  projectId: 'project-a',
  engagementId: 'engagement-a',
  brandId: 'brand-a',
  activeServiceId: 'service-a',
  stageId: 'stage-a',
  origin: '/sphere/workspace/projects/project-a?tab=project-tasks',
  originTab: 'project-tasks',
  workRecord: { kind: 'project_task', id: 'task-a' },
  workshopTab: 'tasks',
  permissions: { release: true },
  allowedActions: ['release'],
}

const resolved = {
  status: 'ready',
  activeOrganizationId: 'org-a',
  organizationId: 'org-a',
  clientId: 'client-a',
  projectId: 'project-a',
  engagementId: 'engagement-a',
  brandId: 'brand-a',
  activeServiceId: 'service-a',
  stageId: 'stage-a',
  workRecord: {
    kind: 'project_task',
    id: 'task-a',
    organizationId: 'org-a',
    projectId: 'project-a',
  },
  permissions: { viewDepartment: true },
  allowedActions: [],
}

test('P9 real Workspace entry validates canonically and returns to exact record focus', () => {
  const href = appendWorkshopNavigation('/sphere/design', workspaceEntry)
  const parsed = parseWorkshopNavigation(new URL(href, 'https://anka.invalid').searchParams)
  const validated = validateWorkshopNavigation(parsed, resolved)
  assert.equal(validated.status, 'ready')
  assert.deepEqual(validated.context.workRecord, { kind: 'project_task', id: 'task-a' })
  assert.deepEqual(validated.context.permissions, { viewDepartment: true })
  assert.deepEqual(validated.context.allowedActions, [])
  const returned = new URL(workspaceReturnTarget(validated), 'https://anka.invalid')
  assert.equal(returned.pathname, '/sphere/workspace/projects/project-a')
  assert.equal(returned.searchParams.get('tab'), 'project-tasks')
  assert.equal(returned.searchParams.get('ctxRecordKind'), 'project_task')
  assert.equal(returned.searchParams.get('ctxRecordId'), 'task-a')
})

test('P9 consumer rejects stale and cross-org records without implicit organization switching', () => {
  const parsed = parseWorkshopNavigation(new URL(
    appendWorkshopNavigation('/sphere/design', workspaceEntry),
    'https://anka.invalid',
  ).searchParams)
  const stale = validateWorkshopNavigation(parsed, { ...resolved, workRecord: null })
  assert.equal(stale.reason, 'work_record_unavailable')
  assert.equal(stale.context, null)
  const crossOrg = validateWorkshopNavigation(parsed, {
    ...resolved,
    activeOrganizationId: 'org-b',
    organizationId: 'org-b',
  })
  assert.equal(crossOrg.reason, 'cross_organization')
  assert.equal(crossOrg.context, null)
  assert.equal(workspaceReturnTarget(crossOrg), '/sphere/workspace')
})

test('P9 Department-to-specialist propagation preserves durable draft and session pointers only', () => {
  const departmentHref = appendWorkshopNavigation('/sphere/design', {
    ...workspaceEntry,
    output: { kind: 'design_session', id: 'session-a', versionId: 'version-a' },
    draft: { kind: 'private_experiment', id: 'draft-a' },
  })
  const departmentContext = parseWorkshopNavigation(
    new URL(departmentHref, 'https://anka.invalid').searchParams,
  )
  const specialistHref = appendWorkshopNavigation('/sphere/design/workshop', {
    ...departmentContext,
    workshopTab: '',
  })
  const specialistContext = parseWorkshopNavigation(
    new URL(specialistHref, 'https://anka.invalid').searchParams,
  )
  assert.deepEqual(specialistContext.output, {
    kind: 'design_session', id: 'session-a', versionId: 'version-a',
  })
  assert.deepEqual(specialistContext.draft, {
    kind: 'private_experiment', id: 'draft-a',
  })
  assert.equal(/permissions|allowedActions|release/i.test(specialistHref), false)
})

test('P9 legacy direct URLs remain valid while invalid typed kinds fail closed', () => {
  const legacy = parseWorkshopNavigation(
    new URL('/sphere/design?engagement=engagement-a&tab=services', 'https://anka.invalid').searchParams,
  )
  assert.equal(legacy.engagementId, 'engagement-a')
  assert.equal(legacy.workshopTab, 'services')
  assert.equal(legacy.status, 'empty')
  const invalid = parseWorkshopNavigation('ctxRecordKind=task&ctxRecordId=task-a')
  assert.equal(invalid.status, 'invalid')
  assert.equal(invalid.reason, 'invalid_work_record_kind')
})

test('P9 consumer source has a shared responsive keyboard shell and no organization switch path', () => {
  const department = readFileSync(new URL('../apps/DepartmentWorkshop.jsx', import.meta.url), 'utf8')
  const project = readFileSync(new URL('../apps/ProjectEngagementWorkspace.jsx', import.meta.url), 'utf8')
  const shell = readFileSync(new URL('../components/WorkshopContextShell.jsx', import.meta.url), 'utf8')
  assert.match(department, /<WorkshopContextShell/)
  assert.match(department, /validateWorkshopNavigation/)
  assert.match(department, /requestedEngagement/)
  assert.match(department, /aria-label="Department workspace sections"/)
  assert.doesNotMatch(department, /selectOrganization\s*\(/)
  assert.match(department, /navigationContext\.status === 'empty' \? navigationContext/)
  assert.match(project, /workRecord: \{ kind, id: item\.id \}/)
  assert.match(project, /project_task/)
  assert.match(project, /engagement_work_item/)
  assert.match(project, /tabIndex=\{-1\}/)
  assert.match(project, /\.focus\(\)/)
  assert.match(shell, /sm:flex-row/)
  assert.match(shell, /focus:ring-2/)
  assert.match(shell, /role="alert"/)
  assert.match(shell, />Back to work<\/Link>/)
})
