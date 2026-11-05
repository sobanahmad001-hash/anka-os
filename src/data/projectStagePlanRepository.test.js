import test from 'node:test'
import assert from 'node:assert/strict'
import {createProjectStagePlanRepository,projectStageBindings} from './projectStagePlanRepository.js'
const id=n=>'de000000-0000-4000-8000-'+String(n).padStart(12,'0')
const scope={organizationId:id(1),projectId:id(2),engagementId:id(3)}
const row={organization_id:id(1),project_id:id(2),engagement_id:id(3)}
const binding={group_id:id(5),publication_id:id(6),step_key:'content',phase:'website.content'}
const partition={kind:'website_page',id:id(7),architecture_version_id:id(8)}
const unit={...row,plan_id:id(4),group_id:id(5),partition,state:'current',context_sha256:'a'.repeat(64),steps:[{phase:'website.content'}]}
const header={...row,state:'available',plan_id:id(4),plan_version:1,groups:[],bindings:[]}
function fixture(answer){const calls=[];return {calls,repo:createProjectStagePlanRepository({rpc(name,args){calls.push({name,args});return typeof answer==='function'?answer(name,args):Promise.resolve({data:structuredClone(answer)})}})}}
test('all reads are scoped and never invoke a writer or resend',async()=>{
 const f=fixture(header);await f.repo.read(scope)
 assert.equal(f.calls[0].name,'read_project_stage_plan');assert.deepEqual(f.calls[0].args,{p_organization_id:id(1),p_project_id:id(2),p_engagement_id:id(3)})
 const r=fixture({...row,status:'not_found',original_result:null,read_only:true});await r.repo.recoverBindings(scope,{requestId:id(9)})
 assert.equal(r.calls.length,1);assert.equal(r.calls[0].name,'recover_project_stage_bindings')
})
test('bounded reads settle timeout even if transport ignores cancellation',async()=>{
 const f=fixture(()=>new Promise(()=>{}))
 await assert.rejects(f.repo.read(scope,{timeoutMs:5}),e=>e.code==='PROJECT_STAGE_READ_TIMEOUT')
 assert.equal(f.calls.length,1)
})
test('aborted scope and late response cannot be consumed',async()=>{
 let complete;const f=fixture(()=>new Promise(resolve=>{complete=resolve})),controller=new AbortController()
 const pending=f.repo.read(scope,{signal:controller.signal});await Promise.resolve();controller.abort()
 await assert.rejects(pending,e=>e.name==='AbortError');complete({data:header});assert.equal(f.calls.length,1)
})
test('foreign response and mismatched exact page/version fail closed',async()=>{
 await assert.rejects(fixture({...header,project_id:id(99)}).repo.read(scope),/another exact scope/)
 for(const delta of [{plan_id:id(99)},{group_id:id(99)},{partition:{...partition,architecture_version_id:id(99)}}]){
  await assert.rejects(fixture({...unit,...delta}).repo.readPartition(scope,{planId:id(4),groupId:id(5),partition}))
 }
})
test('partition list remains bounded and validates exact loaded identities',async()=>{
 const response={...row,plan_id:id(4),group_id:id(5),kind:'website_page',offset:0,limit:25,total:70,has_more:true,items:[{title:'home',partition}]}
 const f=fixture(response);const data=await f.repo.listPartitions(scope,{planId:id(4),groupId:id(5),kind:'website_page'})
 assert.equal(data.total,70);assert.equal(data.items.length,1);assert.equal(f.calls[0].args.p_limit,25)
 await assert.rejects(f.repo.listPartitions(scope,{planId:id(4),groupId:id(5),kind:'website_page',limit:500}))
 await assert.rejects(fixture({...response,items:[response.items[0],response.items[0]]}).repo.listPartitions(scope,{planId:id(4),groupId:id(5),kind:'website_page'}),/paging response/)
})
test('fresh selected context rejects changed material without a second action',async()=>{
 const selected={...row,version:1,plan_id:id(4),group_id:id(5),phase:'website.content',partition,context_sha256:unit.context_sha256}
 const f=fixture(unit);assert.equal((await f.repo.refreshSelection(scope,selected)).state,'current');assert.equal(f.calls.length,1)
 await assert.rejects(fixture({...unit,context_sha256:'b'.repeat(64)}).repo.refreshSelection(scope,selected),/Selected stage changed/)
 await assert.rejects(fixture({...unit,state:'source_unavailable_or_changed'}).repo.refreshSelection(scope,selected),/Selected stage changed/)
})
test('phase binding input never accepts completion claims, duplicate steps or unknown phases',()=>{
 assert.deepEqual(projectStageBindings([binding]),[binding])
 for(const rows of [[binding,binding],[{...binding,done:true}],[{...binding,phase:'website.guessed'}],[{...binding,group_id:'foreign'}]])assert.throws(()=>projectStageBindings(rows))
})
test('review freezes exact normalized payload; apply requires explicit confirmation and one UUID',async()=>{
 const review={...row,parent_version_id:id(4),review_sha256:'c'.repeat(64),bindings:[binding],changed:true}
 const f=fixture(review),saved=await f.repo.reviewBindings(scope,{planId:id(4),bindings:[binding]})
 assert.ok(Object.isFrozen(saved.bindings[0]));assert.equal(f.calls[0].name,'review_project_stage_bindings')
 const result={...row,id:id(10),parent_version_id:id(4),request_id:id(9),snapshot:row}
 const apply=fixture(result)
 await assert.rejects(apply.repo.applyBindings(scope,{requestId:id(9),review:saved}),/Explicit/)
 assert.equal(apply.calls.length,0)
 await apply.repo.applyBindings(scope,{requestId:id(9),review:saved,confirmed:true})
 assert.equal(apply.calls.length,1);assert.equal(apply.calls[0].args.p_request_id,id(9))
})
test('unknown write outcome is not retried and exact recovery remains separate',async()=>{
 const f=fixture(()=>Promise.reject(new Error('transport disconnected'))),review={...row,parent_version_id:id(4),review_sha256:'c'.repeat(64),bindings:[binding],changed:true}
 await assert.rejects(f.repo.applyBindings(scope,{requestId:id(9),review,confirmed:true}),/disconnected/)
 assert.equal(f.calls.length,1);assert.equal(f.calls[0].name,'apply_project_stage_bindings')
})
test('original recovery cannot adopt another actor request or a foreign snapshot',async()=>{
 for(const original_result of [{...row,request_id:id(99),snapshot:row},{...row,request_id:id(9),snapshot:{...row,project_id:id(99)}}]){
  await assert.rejects(fixture({...row,status:'applied',original_result,read_only:true}).repo.recoverBindings(scope,{requestId:id(9)}),/Original stage/)
 }
})
