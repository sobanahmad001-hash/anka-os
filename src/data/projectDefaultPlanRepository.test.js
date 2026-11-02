import test from 'node:test'
import assert from 'node:assert/strict'
import {createProjectDefaultPlanRepository} from './projectDefaultPlanRepository.js'
const id=n=>`e0000000-0000-4000-8000-${String(n).padStart(12,'0')}`
const scope={organizationId:id(1),projectId:id(2),engagementId:id(3)}
const source={organization_id:id(1),project_id:id(2),brand_id:id(4),artifact_id:id(5),version_id:id(6),approval_id:id(7),approved_by:id(8),checksum:'a'.repeat(64),approved_at:'2026-11-02T00:00:00Z',eligible_roles:['written']}
const packet={schema_version:1,organization_id:id(1),project_id:id(2),engagement_id:id(3),brand_id:id(4),source_page_token:'b'.repeat(64),approved_sources:[source],limit:25,offset:0,source_total:1,has_more:false}
test('context reader uses one exact paginated RPC and exposes no mutation or implied completeness',async()=>{
 const calls=[],repo=createProjectDefaultPlanRepository({rpc:(name,args)=>{calls.push({name,args});return Promise.resolve({data:structuredClone(packet)})}})
 assert.deepEqual(Object.keys(repo),['readContext']);assert.deepEqual(await repo.readContext(scope),packet)
 assert.equal(calls[0].name,'get_project_default_plan_context');assert.equal(calls[0].args.p_engagement_id,scope.engagementId);assert.equal(calls[0].args.p_limit,25)
})
test('foreign page/source, missing approval, raw bodies and misleading totals fail closed',async()=>{
 for(const change of [{project_id:id(99)},{engagement_id:id(99)},{offset:1},{source_total:2},{approved_sources:[{...source,brand_id:id(99)}]},{approved_sources:[{...source,approval_id:null}]},{approved_sources:[{...source,content:{private:'body'}}]}]){
  const repo=createProjectDefaultPlanRepository({rpc:()=>Promise.resolve({data:{...packet,...change}})})
  await assert.rejects(repo.readContext(scope))
 }
})
test('abort before or after the read cannot return stale project context',async()=>{
 const first=new AbortController();first.abort();let count=0
 const repo=createProjectDefaultPlanRepository({rpc:()=>{count++;return Promise.resolve({data:packet})}})
 await assert.rejects(repo.readContext(scope,{signal:first.signal}),/context changed/);assert.equal(count,0)
 const late=new AbortController(),other=createProjectDefaultPlanRepository({rpc:()=>{late.abort();return Promise.resolve({data:packet})}})
 await assert.rejects(other.readContext(scope,{signal:late.signal}),/context changed/)
})
