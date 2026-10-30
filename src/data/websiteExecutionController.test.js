import test from 'node:test'
import assert from 'node:assert/strict'
import {websiteExecutionAccess,websiteExecutionProgress,guardWebsiteExecutionRepositories} from './websiteExecutionController.js'
const scope={organizationId:'org',projectId:'project',engagementId:'engagement'},member={organizationId:'org',role:'operations_admin'},workspace={project:{id:'project',organization_id:'org'},engagement:{id:'engagement',organization_id:'org',project_id:'project'},activeServices:[{id:'service',organization_id:'org',engagement_id:'engagement',status:'active',service_catalog:{department_id:'development',slug:'staging_production_builds',is_active:true}}]}
test('website action eligibility requires same organization, explicit owner and actual supported active service',()=>{
 assert.equal(websiteExecutionAccess(workspace,member,true).canExecute,true)
 for(const [w,m,owner] of [[workspace,member,false],[workspace,{...member,member_kind:'client'},true],[workspace,{...member,status:'revoked'},true],[workspace,{...member,organizationId:'foreign'},true],[{...workspace,activeServices:[]},member,true],[{...workspace,activeServices:[{...workspace.activeServices[0],service_catalog:{department_id:'development',slug:'maintenance'}}]},member,true]])assert.equal(websiteExecutionAccess(w,m,owner).canExecute,false)
 assert.equal(websiteExecutionAccess(workspace,{...member,role:'department_manager',departmentId:'development'},true).canBind,false)
})
test('progress uses the exact selected package and current target; no latest or stale success substitution',()=>{
 const build={jobs:[{id:'newer',status:'complete'},{id:'selected',status:'complete',stale_sources:[]}]},staging={targets:[{id:'current',current:true},{id:'old',current:false}],runs:[{job_id:'newer',target_id:'current',status:'staged',evidence:{environment:'staging',published:false}},{job_id:'selected',target_id:'old',status:'staged',evidence:{environment:'staging',published:false}}]}
 assert.equal(websiteExecutionProgress(build,staging,'selected').next,'review_staging')
 assert.equal(websiteExecutionProgress(build,staging,'missing').next,'package_not_loaded')
 staging.runs.push({job_id:'selected',target_id:'current',status:'uncertain'})
 assert.equal(websiteExecutionProgress(build,staging,'selected').next,'recover')
})
test('controller never dispatches a new write during actor switch, revoked authority or late context change',async()=>{
 for(const reason of ['actor','revoked','context','disposed']){
  const calls=[],state={...scope,actorId:'actor',owner:true,canExecute:true,canBind:true,disabled:false},build={build:async()=>calls.push('build')}
  const repos=guardWebsiteExecutionRepositories({build,staging:{},getState:()=>state,actor:async()=>{if(reason==='actor')return 'other';if(reason==='revoked')state.canExecute=false;if(reason==='context')state.projectId='other';if(reason==='disposed')state.disabled=true;return 'actor'}})
  await assert.rejects(repos.build.build(scope,{}));assert.deepEqual(calls,[])
 }
})
test('original recovery remains read-only without gaining execution authority',async()=>{
 let writes=0,reads=0,auth=0
 const repos=guardWebsiteExecutionRepositories({build:{},staging:{recover:async(_s,id)=>{reads++;return {request_id:id}},deploy:async()=>writes++},getState:()=>({...scope,actorId:'actor',owner:false,canExecute:false}),actor:async()=>{auth++;return 'actor'}})
 assert.equal((await repos.staging.recover(scope,'original')).request_id,'original');assert.equal(reads,1);assert.equal(auth,0)
 await assert.rejects(repos.staging.deploy(scope,{}));assert.equal(writes,0)
})

test('current QA and project-link methods preserve original read-only recovery and recheck current write authority',async()=>{
 const state={...scope,actorId:'actor',owner:true,canExecute:true,canBind:true},calls=[]
 const staging=Object.fromEntries(['linkWorkspace','linkSave','linkRecover','qaReview','qaSave','qaRecover'].map(name=>[name,async(s,...args)=>{calls.push({name,s,args});return name}]))
 const repos=guardWebsiteExecutionRepositories({build:{},staging,getState:()=>state,actor:async()=>state.actorId})
 await repos.staging.linkSave({...scope,actorId:'actor'},{requestId:'original-link'})
 await repos.staging.qaSave({...scope,actorId:'actor'},{requestId:'original-qa'})
 state.canExecute=false;state.canBind=false
 await assert.rejects(repos.staging.linkSave(scope,{}));await assert.rejects(repos.staging.qaSave(scope,{}))
 assert.equal(await repos.staging.linkRecover(scope,'original-link'),'linkRecover');assert.equal(await repos.staging.qaRecover(scope,'original-qa'),'qaRecover')
 assert.deepEqual(calls.map(c=>c.name),['linkSave','qaSave','linkRecover','qaRecover']);assert.equal(calls[0].s.actorId,'actor')
})
test('retained revision draft blocks build dispatch while leaving original recovery available',async()=>{
 let writes=0;const state={...scope,actorId:'actor',owner:true,canExecute:true,draftDirty:true}
 const repos=guardWebsiteExecutionRepositories({build:{build:async()=>writes++},staging:{recover:async()=>({status:'staged'})},getState:()=>state,actor:async()=> 'actor'})
 await assert.rejects(repos.build.build(scope,{}),/revision note/);assert.equal(writes,0);assert.equal((await repos.staging.recover(scope,'original')).status,'staged')
})
