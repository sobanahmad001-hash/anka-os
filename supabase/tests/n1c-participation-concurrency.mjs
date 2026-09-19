import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { join } from 'node:path'
const run = promisify(execFile)
const [bin, port] = process.argv.slice(2)
if (!/^\d+$/.test(port || '') || Number(port) < 1024) throw new Error('Local test port required')
const args = ['-X','-h','127.0.0.1','-p',port,'-U','postgres','-d','postgres','-At','-v','ON_ERROR_STOP=1','-v','VERBOSITY=verbose']
const query = async sql => (await run(join(bin,'psql.exe'),[...args,'-c',sql],{timeout:15000})).stdout.trim()
const command = (department, request) => "set role authenticated; select set_config('request.jwt.claim.sub',md5('owner')::uuid::text,false); select public.change_project_department_participation(md5('org-a')::uuid,md5('verified')::uuid,'"+department+"',true,md5('[]'),md5('"+request+"')::uuid);"
let failure
const first = query("set application_name='n1c-participation-first'; begin; "+command('design','first')+'select pg_sleep(2); commit;').catch(error=>{failure=error})
let observed=false
for(let index=0;index<60;index++){
 if(failure) throw failure
 if(await query("select count(*) from pg_stat_activity where application_name='n1c-participation-first' and wait_event='PgSleep';")==='1'){observed=true;break}
 await new Promise(resolve=>setTimeout(resolve,25))
}
assert.ok(observed,'first participation edit held before competitor')
await assert.rejects(query(command('content','second')),error=>/40001/.test(error.stderr))
await first
if(failure) throw failure
assert.equal(await query("select count(*) from public.project_department_participation;"),'1')
await query(command('design','first'))
assert.equal(await query("select count(*) from public.project_department_participation;"),'1')
await query("update public.organization_memberships set status='revoked' where user_id=md5('owner')::uuid;")
await assert.rejects(query(command('design','first')),error=>/42501/.test(error.stderr))
console.log('N1-C participation concurrency passed: stale competitor rejected, replay deduplicated, revoked admin replay denied.')

