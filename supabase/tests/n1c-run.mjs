import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
const [bin, port, mode] = process.argv.slice(2)
if (!/^\d+$/.test(port || '') || Number(port) < 1024) throw new Error('Unprivileged local test port required')
const source = file => readFileSync(new URL('../migrations/' + file, import.meta.url), 'utf8')
const testFile = file => readFileSync(new URL(file, import.meta.url), 'utf8')
function actualFunction(file, name) {
  const text = source(file)
  const marker = name.replaceAll('.', '\\.')
  const matches = [...text.matchAll(new RegExp('create(?: or replace)? function ' + marker + '\\([\\s\\S]*?\\$\\$;', 'gi'))]
  if (matches.length !== 1) throw new Error('Expected exact source function: ' + name)
  return matches[0][0]
}
function actualTable(file, name) {
  const sourceText = source(file)
  const marker = name.replaceAll('.', '\\.')
  const matches = [...sourceText.matchAll(new RegExp('create table ' + marker + '\\s*\\([\\s\\S]*?\\n\\);', 'gi'))]
  if (matches.length !== 1) throw new Error('Expected exact source table: ' + name)
  return matches[0][0]
}
const sql = [
  testFile('n1_authority_compatibility.fixture.sql'),
  source('20260919135700_n1_authority_compatibility.sql'),
  testFile('n1b_authority_administration.fixture.sql'),
  source('20260919142833_n1b_authority_administration.sql'),
  testFile('n1c_assignment.fixture.sql'),
  actualFunction('20260902000000_uw3_work_item_chat_proposals.sql', 'public.save_work_item'),
  ...['private.p5_require_active_actor', 'private.p5_raise_stale_write', 'private.p5_advance_row_version',
    'public.update_p5_project_task', 'public.transition_p5_project_task', 'public.save_p5_work_item', 'public.move_p5_work_item']
    .map(name => actualFunction('20260904120000_p5_unified_planning.sql', name)),
  actualFunction('20260903050747_canonical_ownership_convergence.sql', 'private.derive_engagement_project_ownership'),
  actualFunction('20260825040000_canonical_delivery_core.sql', 'private.enforce_task_status_transition'),
  actualFunction('20260829092519_automation_rules.sql', 'private.mark_automation_work_item_event'),
  actualFunction('20260829092519_automation_rules.sql', 'private.apply_automation_rules_from_event'),
  `create trigger trg_oaf2_derive_work_item_project before insert or update of engagement_id,project_id,organization_id on public.work_items
      for each row execute function private.derive_engagement_project_ownership();
   create trigger trg_p5_advance_task_row_version before update on public.tasks for each row execute function private.p5_advance_row_version();
   create trigger trg_p5_advance_work_item_row_version before update on public.work_items for each row execute function private.p5_advance_row_version();
   create trigger trg_enforce_task_status_transition before update on public.tasks for each row execute function private.enforce_task_status_transition();
   create trigger trg_engagement_events_mark_automation before insert on public.engagement_events for each row execute function private.mark_automation_work_item_event();
   create trigger trg_engagement_events_apply_automation after insert on public.engagement_events for each row execute function private.apply_automation_rules_from_event();
   grant execute on function public.save_work_item(uuid,uuid,text,text,text,text,text,uuid,text,uuid,uuid,uuid,date,date,integer,uuid,uuid,text),
     public.update_p5_project_task(uuid,uuid,bigint,text,uuid,date,text,uuid),
     public.transition_p5_project_task(uuid,uuid,bigint,text,text,uuid),
     public.save_p5_work_item(uuid,uuid,uuid,text,text,text,text,text,uuid,text,uuid,uuid,uuid,date,date,integer,uuid,uuid,bigint,text),
     public.move_p5_work_item(uuid,uuid,bigint,text,uuid,uuid),
     private.p5_require_active_actor(uuid,uuid),private.p5_raise_stale_write(text,uuid,bigint,bigint) to service_role;`,
  source('20260919145156_n1c_assignment_enforcement.sql'),
  ...(['recurring','deprovisioning'].includes(mode) ? [source('20260919151214_n1c_project_department_participation.sql'),
    testFile('n1c_recurring.fixture.sql'),source('20260903071706_ret1_recurring_plan_foundation.sql'),
    source('20260903123259_ret2_manual_period_generation.sql'),source('20260903195540_ret4_scheduled_recurrence.sql'),
    source('20260919154909_n1c_recurring_assignment_delegation.sql'),
    ...(mode === 'deprovisioning' ? [testFile('n1d_deprovisioning.fixture.sql'),source('20260919162508_n1d_scoped_deprovisioning.sql'),testFile('n1d_deprovisioning.behavior.sql')]
      : [testFile('n1c_recurring.behavior.sql')])] : mode === 'participation' ? [source('20260919151214_n1c_project_department_participation.sql'),
    testFile('n1c_participation.behavior.sql')] : mode === 'n1e' ? [
      source('20260919151214_n1c_project_department_participation.sql'),
      testFile('n1e_governed_approval.fixture.sql'),
      actualFunction('20260825010000_organization_access_foundation.sql', 'public.is_team_organization_member'),
      ...['public.deliverable_review_assignments','public.deliverable_lifecycle_events','public.deliverable_action_requests']
        .map(name => actualTable('20260904130000_p7_governed_deliverable_release.sql', name)),
      ...['public.artifact_approval_requests','public.artifact_approval_signoffs']
        .map(name => actualTable('20260829095245_multi_approver_policies.sql', name)),
      ...['private.p7_reject_history_mutation','private.p7_team','private.p7_replay','private.p7_record',
        'public.release_governed_deliverable_version']
        .map(name => actualFunction('20260904130000_p7_governed_deliverable_release.sql', name)),
      source('20260919171000_n1e_governed_approval_separation.sql'),
      `grant execute on function public.release_governed_deliverable_version(uuid,uuid,bigint,boolean,text,uuid) to authenticated;
       grant all on public.artifacts,public.artifact_versions,public.artifact_approvals,
         public.artifact_approval_requests,public.artifact_approval_signoffs,
         public.artifact_version_comments,public.engagement_events to service_role;`,
      testFile('n1e_governed_approval.behavior.sql'),
    ] : [testFile('n1c_assignment.behavior.sql')]),
].join('\n')
const result = spawnSync(join(bin, 'psql.exe'), ['-X','-h','127.0.0.1','-p',port,'-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1'],
  { input: sql, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024, timeout: 60000 })
process.stdout.write(result.stdout || '')
process.stderr.write(result.stderr || '')
if (result.error) throw result.error
process.exitCode = result.status || 0
