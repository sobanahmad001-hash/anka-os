import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { transform } from 'esbuild'
const {code}=await transform(await readFile(new URL('../../supabase/functions/department-chat/workshopExecutionGate.ts',import.meta.url),'utf8'),{loader:'ts',format:'esm'})
const {workshopExecutionEnabled,requireWorkshopExecution}=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'))
const scope={organizationId:'org',projectId:'project',engagementId:'engagement',departmentId:'content',actorId:'actor'}
const enabled={schema_version:1,enabled:true,organization_id:'org',project_id:'project',engagement_id:'engagement',department_id:'content'}
const env={get:()=> 'true'}
test('global flag alone grants nothing; off performs no RPC',async()=>{let calls=0;assert.equal(await workshopExecutionEnabled({rpc:async()=>{calls++;return {data:enabled}}},scope,{get:()=> 'false'}),false);assert.equal(calls,0)})
test('exact configured scope uses trusted actor and native scoped read',async()=>{let args;const admin={rpc:async(name,body)=>{args={name,body};return {data:enabled}}};assert.equal(await workshopExecutionEnabled(admin,scope,env),true);assert.equal(args.name,'get_workshop_execution_readiness');assert.equal(args.body.p_actor_id,'actor');assert.equal(args.body.p_project_id,'project')})
for(const [name,data] of Object.entries({missing:null,array:[],off:{...enabled,enabled:false},string:{...enabled,enabled:'true'},foreignProject:{...enabled,project_id:'other'},foreignOrg:{...enabled,organization_id:'other'},foreignEngagement:{...enabled,engagement_id:'other'},foreignDepartment:{...enabled,department_id:'design'},version:{...enabled,schema_version:2}}))test('rejects '+name,async()=>assert.equal(await workshopExecutionEnabled({rpc:async()=>({data})},scope,env),false))
test('transport and database errors fail closed with safe dispatch error',async()=>{for(const rpc of [async()=>{throw Error('raw credential')},async()=>({data:enabled,error:{message:'SQL'}})])await assert.rejects(requireWorkshopExecution({rpc},scope,env),e=>e.status===503&&!e.message.includes('credential')&&!e.message.includes('SQL'))})
