import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { join } from 'node:path'
const run = promisify(execFile)
const [bin, port] = process.argv.slice(2)
if (!/^\d+$/.test(port || '') || Number(port) < 1024) throw new Error('Local unprivileged test port required')
const executable = join(bin, 'psql.exe')
const args = ['-X','-h','127.0.0.1','-p',port,'-U','postgres','-d','postgres','-At','-v','ON_ERROR_STOP=1','-v','VERBOSITY=verbose']
const query = async sql => (await run(executable,[...args,'-c',sql],{ timeout:15000 })).stdout.trim()
await query("set role authenticated; select set_config('request.jwt.claim.sub',md5('bob')::uuid::text,false); insert into public.tasks(id,project_id,user_id,created_by) values(md5('concurrent-task')::uuid,md5('verified')::uuid,md5('bob')::uuid,md5('bob')::uuid);")
const command = (actor, version, assignee) => "set role service_role; select public.update_p5_project_task(md5('org-a')::uuid,md5('concurrent-task')::uuid," + version + ",'backlog',md5('" + assignee + "')::uuid,null,'',md5('" + actor + "')::uuid);"
let firstFailure
const first = query("set application_name='n1c-first'; begin; " + command('alice',1,'bob') + 'select pg_sleep(2); commit;').catch(error => { firstFailure=error })
let observed=false
for (let index=0; index<60; index++) {
  if (firstFailure) throw firstFailure
  if (await query("select count(*) from pg_stat_activity where application_name='n1c-first' and wait_event='PgSleep';") === '1') { observed=true; break }
  await new Promise(resolve=>setTimeout(resolve,25))
}
assert.ok(observed,'first assignment transaction held before competing edit')
await assert.rejects(query(command('owner',1,'alice')),error=>/40001/.test(error.stderr))
await first
if(firstFailure) throw firstFailure
assert.equal(await query("select row_version||':'||(assigned_to=md5('bob')::uuid)::text from public.tasks where id=md5('concurrent-task')::uuid;"),'2:true')
assert.equal(await query("select count(*) from private.n1c_assignment_history where record_id=md5('concurrent-task')::uuid;"),'1')
await assert.rejects(query(command('alice',1,'bob')),error=>/40001/.test(error.stderr),'stale retry cannot duplicate assignment/history')
await query("update public.project_manager_bindings set status='revoked',revoked_at=clock_timestamp() where user_id=md5('alice')::uuid;")
await assert.rejects(query(command('alice',2,'alice')),error=>/42501/.test(error.stderr),'current PM revocation applies to the next command')
console.log('N1-C concurrent assignment passed: stale competitor/retry denied; single history event; revoked PM denied.')
