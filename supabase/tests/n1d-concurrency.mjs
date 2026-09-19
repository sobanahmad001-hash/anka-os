import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { join } from 'node:path'
const run=promisify(execFile)
const [bin,port]=process.argv.slice(2)
if(!/^\d+$/.test(port||'') || Number(port)<1024) throw new Error('Local test port required')
const args=['-X','-h','127.0.0.1','-p',port,'-U','postgres','-d','postgres','-At','-v','ON_ERROR_STOP=1','-v','VERBOSITY=verbose']
const query=async sql=>(await run(join(bin,'psql.exe'),[...args,'-c',sql],{timeout:15000})).stdout.trim()
const command=(actor,target,request)=>"set role authenticated; select set_config('request.jwt.claim.sub',md5('"+actor+"')::uuid::text,false); select public.deactivate_organization_member(md5('org-a')::uuid,md5('"+target+"')::uuid,md5('"+request+"')::uuid);"
let failure
const first=query("set application_name='n1d-first'; begin; "+command('owner','ops','first')+'select pg_sleep(2); commit;').catch(error=>{failure=error})
let observed=false
for(let i=0;i<60;i++){
 if(failure)throw failure
 if(await query("select count(*) from pg_stat_activity where application_name='n1d-first' and wait_event='PgSleep';")==='1'){observed=true;break}
 await new Promise(resolve=>setTimeout(resolve,25))
}
assert.ok(observed)
await assert.rejects(query(command('ops','owner','competing')),error=>/42501/.test(error.stderr))
await first;if(failure)throw failure
assert.equal(await query("select count(*) from public.organization_memberships where organization_id=md5('org-a')::uuid and member_kind='team' and status='active' and role in ('system_owner','operations_admin');"),'1')
await assert.rejects(query(command('owner','owner','self')),error=>/42501/.test(error.stderr))
await query(command('owner','ops','first'))
assert.equal(await query("select count(*) from private.n1d_deactivations;"),'1')
assert.equal(await query("select status from public.organization_memberships where organization_id=md5('org-b')::uuid and user_id=md5('other-owner')::uuid;"),'active')
console.log('N1-D competing admin deactivations passed: serialized reauthorization preserves final admin; self-removal denied; replay deduplicated; other organization retained.')
