import test from 'node:test'
import assert from 'node:assert/strict'
import {planStageDefaults,inspectServicePlan} from './serviceDrivenPlan.js'
import {createProjectDeliveryPlanRepository} from './projectDeliveryPlanRepository.js'
const id=n=>`d0000000-0000-4000-8000-${String(n).padStart(12,'0')}`,scope={organizationId:id(1),projectId:id(2),engagementId:id(3)},row={organization_id:id(1),project_id:id(2),engagement_id:id(3)}
test('service stage suggestions retain batch limits and never infer completed-stage satisfaction',()=>{const group={contributions:[{service_id:id(4),status:'active'},{service_id:id(5),status:'completed'}],stages:[{key:'copy',service_id:id(4),selected_service:true,planned_quantity:100},{key:'review',service_id:id(5),selected_service:true,planned_quantity:2},{key:'upstream',service_id:id(6),selected_service:false,planned_quantity:null}]};assert.deepEqual(planStageDefaults(group,[{service_id:id(4),status:'active'},{service_id:id(5),status:'active'}]),{quantities:{},actions:{}});group.stages[0].planned_quantity=3;assert.deepEqual(planStageDefaults(group,[{service_id:id(4),status:'active'}]),{quantities:{copy:'3'},actions:{copy:'run'}})})
test('a reviewed Website leaf uses only its exact active engagement unit',()=>{
 const contribution={scope_id:id(8),scope_service_id:id(4),service_id:id(5),engagement_service_id:id(7),quantity:1,status:'active'}
 const group={kind:'website',pipeline_group_id:id(9),definition_publication_id:id(10),contributions:[contribution],
  stages:[{key:'goals',service_id:id(5),selected_service:true,planned_quantity:1}]}
 const parent={id:id(7),service_id:id(4),status:'active'}
 assert.deepEqual(planStageDefaults(group,[parent]),{quantities:{goals:'1'},actions:{goals:'run'}})
 for(const change of [{id:id(6)},{service_id:id(3)},{status:'planned'}])
  assert.deepEqual(planStageDefaults(group,[{...parent,...change}]).quantities,{})
 for(const change of [{kind:'marketing'},{pipeline_group_id:null},{definition_publication_id:null},{contributions:[{...contribution,quantity:2}]}])
  assert.deepEqual(planStageDefaults({...group,...change},[parent]).quantities,{})
})
test('binding submits the reviewed scope revision and original engagement service',async()=>{
 const calls=[]
 const repo=createProjectDeliveryPlanRepository({rpc:async(name,args)=>{calls.push({name,args});return {data:null}}})
 const option={scope_id:id(4),scope_revision:7,parent_service_id:id(5),engagement_service_id:id(6),leaf_id:id(7)}
 await repo.bindWebsiteScopes(scope,[option])
 assert.deepEqual(calls,[{name:'apply_website_scope_leaf_bindings',args:{p_organization_id:id(1),p_project_id:id(2),p_engagement_id:id(3),
  p_bindings:[{scope_id:id(4),revision:7,parent_service_id:id(5),engagement_service_id:id(6),leaf_id:id(7)}]}}])
 await assert.rejects(repo.bindWebsiteScopes(scope,[{...option,scope_revision:null}]))
 assert.equal(calls.length,1)
})
test('plan Apply needs current manager authority, a delta and exact group choices',()=>{const draft={can_manage:true,contributions:[{}],changes:[{}],groups:[],unmapped:[]};assert.equal(inspectServicePlan({draft}).canApply,true);for(const change of [{can_manage:false},{changes:[]},{groups:[{choose_group:true}]}])assert.equal(inspectServicePlan({draft:{...draft,...change}}).canApply,false)})
test('plan repository reads exact context and recovers an original request without calling a writer',async()=>{const calls=[],repo=createProjectDeliveryPlanRepository({rpc:async(name,args)=>{calls.push({name,args});return {data:{...row,history:[],latest:null,selected:{...row,snapshot:row}}}}});await repo.read(scope,{requestId:id(7)});assert.equal(calls.length,1);assert.equal(calls[0].name,'get_project_delivery_plan');assert.equal(calls[0].args.p_request_id,id(7));for(const foreign of [{...row,project_id:id(9)}, {...row,engagement_id:id(9)}]){const other=createProjectDeliveryPlanRepository({rpc:async()=>({data:{...foreign,history:[]}})});await assert.rejects(other.read(scope),/another exact context/)}})
test('plan write uses only reviewed hash and original request, never a client-built workflow',async()=>{const calls=[],repo=createProjectDeliveryPlanRepository({rpc:async(name,args)=>{calls.push({name,args});return {data:{...row,request_id:id(7),snapshot:row}}}});await repo.apply(scope,{requestId:id(7),reviewSha256:'a'.repeat(64),choices:{}});assert.equal(calls[0].name,'apply_project_delivery_plan');assert.equal(calls[0].args.p_review_sha256,'a'.repeat(64));assert.equal('snapshot' in calls[0].args,false);assert.equal('actor_id' in calls[0].args,false)})
test('known transaction conflicts and uncertain/mismatched outcomes remain distinct',async()=>{const repo=createProjectDeliveryPlanRepository({rpc:async()=>({error:{code:'40001',message:'Sources changed'}})});await assert.rejects(repo.apply(scope,{requestId:id(7),reviewSha256:'a'.repeat(64)}),e=>e.knownRollback===true);const other=createProjectDeliveryPlanRepository({rpc:async()=>({data:{...row,request_id:id(8),snapshot:row}})});await assert.rejects(other.apply(scope,{requestId:id(7),reviewSha256:'a'.repeat(64)}),e=>!e.knownRollback&&/recover/.test(e.message));const controller=new AbortController();controller.abort();await assert.rejects(other.read(scope,{signal:controller.signal}),/context changed/)})
