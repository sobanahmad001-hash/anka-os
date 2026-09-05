import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
const read = path => readFileSync(new URL('../../' + path, import.meta.url), 'utf8')
const sql = read('supabase/migrations/20260903195540_ret4_scheduled_recurrence.sql')
const handler = read('supabase/functions/recurring-scheduler/index.ts')

test('RET4 has exactly one approved private definer gate and no direct auth or registry-write grants', () => {
  assert.equal((sql.match(/security definer/gi) || []).length, 1)
  assert.match(sql, /private\.assert_recurring_scheduler\(p_actor uuid, p_org uuid\)\s*returns void language plpgsql security definer set search_path = ''/)
  assert.match(sql, /revoke all on function private\.assert_recurring_scheduler\(uuid,uuid\) from public,anon,authenticated,service_role;/)
  assert.match(sql, /grant execute on function private\.assert_recurring_scheduler\(uuid,uuid\) to service_role;/)
  assert.doesNotMatch(sql, /grant\s+[^;]*\bon\s+auth\.users/i)
  assert.doesNotMatch(sql, /grant\s+[^;]*update[^;]*recurring_scheduler_principals/i)
  for (const fn of ['admit_recurring_schedule', 'execute_recurring_schedule']) {
    assert.match(sql, new RegExp('function public\\.' + fn + '[\\s\\S]*?returns[^$]+security invoker'))
  }
})
test('RET4 consent is explicit and legacy rows are not backfilled or assigned a default schedule', () => {
  const validation = read('supabase/functions/recurring-plans/schedule.ts')
  assert.match(validation, /SUGGESTED_LOCAL_TIME = '09:00'/)
  assert.match(validation, /if \(!\('scheduler' in definition\)\) return definition/)
  assert.match(sql, /record_recurring_schedule_consent after insert/)
  assert.match(sql, /exists\(select 1 from public\.recurring_schedule_consents where plan_version_id=v_version.id\)/)
  assert.doesNotMatch(sql, /update public\.recurring_work_plan_versions/)
})
test('RET4 uses real server clock, immutable admissions, manual recovery and atomic rollback evidence', () => {
  assert.match(sql, /p_now >= p_due and p_now < p_due \+ interval '5 minutes'/)
  assert.match(sql, /p_approved < p_due and p_status_changed < p_due/)
  assert.match(sql, /p_admitted \+ interval '15 minutes'/)
  assert.match(sql, /private\.recurring_execution_open\(clock_timestamp\(\),a.retry_deadline/)
  assert.match(sql, /exception when others then/)
  assert.match(sql, /insert into public\.recurring_schedule_executions/)
  assert.match(sql, /create trigger protect_schedule_admissions before update or delete/)
})
test('RET4 preserves manual period serialization and explicit machine audit identity', () => {
  assert.match(sql, /pg_advisory_xact_lock\(hashtextextended/)
  assert.match(sql, /'execution_source','recurring_scheduler','scheduler_actor_id',p_actor_id/)
  assert.match(handler, /actorId: user.id/)
  assert.match(handler, /p_actor_id: ctx.actorId/)
  assert.doesNotMatch(handler, /body\.actorId|body\.admittedAt|body\.now/)
  assert.doesNotMatch(sql, /cron\.schedule|create extension|insert into auth\.users/i)
})
test('RET4 authenticated code and all new Edge tests are registered without automatic deployment', () => {
  const config = read('supabase/config.toml')
  assert.match(config, /\[functions\.recurring-scheduler\]\s*enabled = true\s*verify_jwt = true/)
  const ci = read('.github/workflows/ci.yml')
  assert.match(ci, /deno test[^\n]*recurring-scheduler\/index.test.ts/)
  assert.match(ci, /deno test[^\n]*recurring-plans\/schedule.test.ts/)
  assert.match(ci, /deno check[^\n]*recurring-scheduler\/index.ts/)
})
