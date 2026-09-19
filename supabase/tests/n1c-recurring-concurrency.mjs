import assert from 'node:assert/strict'
import { execFile, spawnSync } from 'node:child_process'
import { promisify } from 'node:util'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
const run=promisify(execFile)
const [bin,port]=process.argv.slice(2)
if(!/^\d+$/.test(port||'') || Number(port)<1024) throw new Error('Local test port required')
const exe=join(bin,'psql.exe')
const args=['-X','-h','127.0.0.1','-p',port,'-U','postgres','-d','postgres','-At','-v','ON_ERROR_STOP=1','-v','VERBOSITY=verbose']
const query=async sql=>(await run(exe,[...args,'-c',sql],{timeout:15000})).stdout.trim()
const id=name=>"md5('"+name+"')::uuid"
const org=id('org-a'), project=id('verified'),version=id('version'),plan=id('plan'),machine=id('machine')
const seed=readFileSync(new URL('n1c_recurring.behavior.sql',import.meta.url),'utf8').split('create function pg_temp.delegate')[0]
 .replaceAll(/pg_temp\.id\('([^']+)'\)/g,(_,name)=>id(name))+'commit;'
const seeded=spawnSync(exe,args,{input:seed,encoding:'utf8',timeout:15000})
assert.equal(seeded.status,0,seeded.stderr)
const admin="set role authenticated; select set_config('request.jwt.claim.sub',"+id('alice')+"::text,false);"
const change=(enabled,key)=>admin+"select public.change_recurring_assignment_delegation("+org+","+project+","+version+","+enabled+",public.get_recurring_assignment_delegation("+org+","+project+","+version+")->>'token',"+id(key)+");"
await query(change(true,'concurrent-approval'))
await query("set role service_role; select public.admit_recurring_schedule("+plan+",(clock_timestamp() at time zone 'UTC')::date,"+machine+");")
const execute="set role service_role; select public.execute_recurring_schedule((select id from public.recurring_schedule_admissions where plan_id="+plan+"),"+machine+")->>'outcome';"
async function held(sql,name){
 let failure
 const promise=query("set application_name='"+name+"'; begin; "+sql+" select pg_sleep(2); commit;").catch(error=>{failure=error})
 let observed=false
 for(let i=0;i<60;i++){
  if(failure) throw failure
  if(await query("select count(*) from pg_stat_activity where application_name='"+name+"' and wait_event='PgSleep';")==='1'){observed=true;break}
  await new Promise(resolve=>setTimeout(resolve,25))
 }
 assert.ok(observed,'transaction barrier observed')
 return {promise,check(){if(failure) throw failure}}
}
const first=await held(execute,'n1c-recurring-first')
assert.match(await query(execute),/replayed/)
await first.promise;first.check()
assert.equal(await query("select count(*) from public.recurring_work_occurrences;"),'1')
assert.equal(await query("select count(*) from public.work_items;"),'2')
assert.equal(await query("select count(*) from private.n1c_assignment_history where delegation_id is not null;"),'2')
assert.equal(await query("select count(*) from public.recurring_work_generation_attempts;"),'1')
const withdrawn=await held(change(false,'concurrent-withdrawal'),'n1c-recurring-withdraw')
assert.match(await query(execute),/manual_review/)
await withdrawn.promise;withdrawn.check()
assert.equal(await query("select count(*) from public.work_items;"),'2')
console.log('N1-C recurring concurrency passed: one occurrence/request, two exact assignments, concurrent retry replayed, committed withdrawal rechecked.')
