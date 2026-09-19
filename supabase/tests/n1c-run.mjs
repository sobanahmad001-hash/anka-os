import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
const [bin, port] = process.argv.slice(2)
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
  testFile('n1c_assignment.behavior.sql'),
].join('\n')
const result = spawnSync(join(bin, 'psql.exe'), ['-X','-h','127.0.0.1','-p',port,'-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1'],
  { input: sql, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024, timeout: 60000 })
process.stdout.write(result.stdout || '')
process.stderr.write(result.stderr || '')
if (result.error) throw result.error
process.exitCode = result.status || 0
