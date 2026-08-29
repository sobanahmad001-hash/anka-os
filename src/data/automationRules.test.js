import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import { AUTOMATION_ACTION_TYPES, AUTOMATION_TRIGGER_TYPES } from './workItems.js'

const migration = readFileSync(new URL('../../supabase/migrations/20260829092519_automation_rules.sql', import.meta.url), 'utf8')
const verification = readFileSync(new URL('../../supabase/verify_20260829092519_automation_rules.sql', import.meta.url), 'utf8')
const panel = readFileSync(new URL('../components/AutomationRulesPanel.jsx', import.meta.url), 'utf8')
const workPanel = readFileSync(new URL('../components/WorkItemsPanel.jsx', import.meta.url), 'utf8')
const repository = readFileSync(new URL('./workItemsRepository.js', import.meta.url), 'utf8')
const edgeFunction = readFileSync(new URL('../../supabase/functions/work-items/index.ts', import.meta.url), 'utf8')

test('W5 exposes exactly the four triggers and two actions in the closed library', () => {
  assert.deepEqual(AUTOMATION_TRIGGER_TYPES, [
    'work_item_status_changed', 'artifact_approved', 'design_direction_released', 'due_date_arrived',
  ])
  assert.deepEqual(AUTOMATION_ACTION_TYPES, ['move_status', 'notify_assignee'])
  assert.match(migration, /trigger_type in \([\s\S]*'work_item_status_changed'[\s\S]*'artifact_approved'[\s\S]*'design_direction_released'[\s\S]*'due_date_arrived'/)
  assert.match(migration, /action_type in \('move_status', 'notify_assignee'\)/)
})

test('W5 schema is tenant-scoped, least-privilege, and active-member authored', () => {
  assert.match(migration, /create table public\.automation_rules/)
  assert.match(migration, /organization_id uuid not null references public\.organizations/)
  assert.match(migration, /is_team_organization_member\(organization_id\)/)
  assert.match(migration, /created_by = \(select auth\.uid\(\)\)/)
  assert.match(migration, /grant update\(enabled\) on public\.automation_rules/)
  assert.doesNotMatch(migration, /grant (all|update) on public\.automation_rules to authenticated/)
})

test('event automation reuses save_work_item and marks its existing audit event', () => {
  assert.match(migration, /after insert on public\.engagement_events/)
  assert.match(migration, /perform public\.save_work_item\(/)
  assert.match(migration, /'triggered_by', v_triggered_by[\s\S]*'automation_rule_id', v_rule_id/)
  assert.match(migration, /new\.payload ->> 'triggered_by' = 'automation_rule'/)
  assert.doesNotMatch(migration, /update public\.(artifacts|artifact_approvals|design_direction_versions)/)
})

test('the built-in behavior is expressed as separate artifact and direction rules', () => {
  assert.match(migration, /Auto-advance approved artifact work'[\s\S]*'artifact_approved'/)
  assert.match(migration, /Auto-advance released design work'[\s\S]*'design_direction_released'/)
  assert.match(migration, /design_workshop_context_versions[\s\S]*context_version\.artifact_version_id = item\.linked_artifact_version_id/)
})

test('notify-assignee uses only work-item flags with both approved clear paths', () => {
  assert.match(migration, /automation_flagged_at timestamptz/)
  assert.match(migration, /automation_flagged_by_rule_id uuid/)
  assert.match(migration, /new\.status is distinct from old\.status[\s\S]*new\.automation_flagged_at := null/)
  assert.match(migration, /item\.assignee_id = p_actor_id[\s\S]*automation_flagged_at is not null/)
  assert.match(edgeFunction, /acknowledge_automation_flag[\s\S]*acknowledge_work_item_automation_flag/)
  assert.match(workPanel, /automation_flagged_at[\s\S]*acknowledgeAutomationFlag/)
})

test('rule UI is fixed-form, shows the due-date deferral, and creates due-date rules disabled', () => {
  assert.match(panel, /AUTOMATION_TRIGGER_TYPES/)
  assert.match(panel, /AUTOMATION_ACTION_TYPES/)
  assert.match(panel, /scheduled execution is deferred in W5/i)
  assert.doesNotMatch(panel, /drag|drop/i)
  assert.match(repository, /enabled: input\.triggerType !== 'due_date_arrived'/)
  assert.match(migration, /due_date_arrived remains stored but unscheduled in W5/i)
})

test('rollback verification proves auto-advance, audit attribution, and later manual movement', () => {
  assert.match(verification, /Artifact approval did not auto-advance/)
  assert.match(verification, /triggered_by' = 'automation_rule'/)
  assert.match(verification, /Manual status change after automation was blocked/)
  assert.match(verification, /rollback;/)
})
