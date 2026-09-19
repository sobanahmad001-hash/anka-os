import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { join } from 'node:path'
const run = promisify(execFile)
const [bin, port] = process.argv.slice(2)
if (!/^\d+$/.test(port || '') || Number(port) < 1024) throw new Error('Local test port required')
const args = ['-X','-h','127.0.0.1','-p',port,'-U','postgres','-d','postgres','-At','-v','ON_ERROR_STOP=1','-v','VERBOSITY=verbose']
const query = async sql => (await run(join(bin,'psql.exe'),[...args,'-c',sql],{timeout:20000})).stdout.trim()
const id = name => `md5('${name}')::uuid`
await query(`insert into public.deliverable_versions(id,organization_id,project_id,deliverable_id,version_number,title,review_status,created_by,internal_reviewer_id,state_version)
 values(${id('version-race')},${id('org-a')},${id('verified')},${id('deliverable')},3,'Concurrent confirmation','ready_for_client_review',${id('bob')},${id('owner')},2);
 insert into public.project_manager_bindings(organization_id,user_id,project_id,status,source)
 values(${id('org-a')},${id('alice')},${id('verified')},'active','explicit');`)
const command = `set role authenticated; select set_config('request.jwt.claim.sub',${id('alice')}::text,false);
 select public.confirm_governed_deliverable_project_manager(${id('org-a')},${id('version-race')},2,${id('confirm-race')});`
let firstError
const first = query(`set application_name='n1e-first'; begin; ${command} select pg_sleep(4); commit;`).catch(error => {firstError=error})
let held = false
for(let attempt=0;attempt<60;attempt++) {
  if(firstError) throw firstError
  if(await query("select count(*) from pg_stat_activity where application_name='n1e-first' and wait_event='PgSleep';") === '1') {held=true;break}
  await new Promise(resolve => setTimeout(resolve,25))
}
assert.ok(held,'first confirmation transaction held before concurrent retry')
let secondDone = false
const secondPromise = query(`set application_name='n1e-second'; ${command}`).finally(() => {secondDone=true})
let overlapping = false
for(let attempt=0;attempt<60;attempt++) {
  if(secondDone) break
  if(await query("select count(*) from pg_stat_activity where application_name='n1e-first' and wait_event='PgSleep';") === '1'
    && await query("select count(*) from pg_stat_activity where application_name='n1e-second' and wait_event_type='Lock';") === '1') {
    overlapping=true;break
  }
  await new Promise(resolve => setTimeout(resolve,25))
}
assert.ok(overlapping,'second session waited on the first confirmation transaction')
const second = await secondPromise
await first
if(firstError) throw firstError
assert.match(second,/"idempotent_replay": true/)
assert.equal(await query(`select count(*) from public.deliverable_pm_confirmations where deliverable_version_id=${id('version-race')};`),'1')
await query(`update public.project_manager_bindings set status='revoked',revoked_at=clock_timestamp()
 where organization_id=${id('org-a')} and project_id=${id('verified')} and user_id=${id('alice')} and status='active';`)
await assert.rejects(query(command),error=>/42501/.test(error.stderr))
console.log('N1-E two-session confirmation passed: one row, exact replay, revoked PM denied.')
