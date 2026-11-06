import {createChatDesignFixture,uuid} from './project-chat-design-fixture.js'
import {createProjectChatNativeBuildRepository} from '../src/data/projectChatNativeBuildRepository.js'
import {createProjectChatNativeStagingRepository} from '../src/data/projectChatNativeStagingRepository.js'
// All boundaries are synthetic; this fixture never contacts SQL, Edge or WordPress.
export async function createChatExecutionFixture(){
 const f=await createChatDesignFixture(),r=f.r,hash='a'.repeat(64),calls=[]
 r.selection={version:1,organization_id:r.organization_id,project_id:r.project_id,engagement_id:r.engagement_id,plan_id:uuid(60),group_id:uuid(61),phase:'website.content',partition:{kind:'website_page',id:r.output.page_id,architecture_version_id:f.c.architecture_version_id},context_sha256:'b'.repeat(64)}
 const state={builds:[],staging:[],loseBuild:false,loseStage:false,absent:false,expire:false,stageStatus:'staged',rollback:false,retained:false,never:false,release:null}
 const meta=(i,c,origin)=>({version:1,...i,engagement_id:r.engagement_id,actor_id:r.actor_id,context:c,origin_receipt:origin})
 const buildState=()=>({kind:'website_native_package',status:state.expire?'failed':'complete',original_status:state.expire?'processing':'complete',execution_window_expired:state.expire,artifact_sha256:state.expire?null:hash,source_sha256:state.expire?null:'d'.repeat(64),package_bytes:state.expire?null:120,source_bytes:state.expire?null:80,stale_sources:[],failure_reason:state.expire?'Execution window expired':null})
 const client={rpc:async(name,args)=>{
  calls.push({name,args:structuredClone(args)})
  if(name==='get_project_chat_native_build_review'){
   const i={organization_id:args.p_organization_id,project_id:args.p_project_id,conversation_id:args.p_conversation_id,source_message_id:args.p_source_message_id}
   return {data:{organization_id:r.organization_id,project_id:r.project_id,engagement_id:r.engagement_id,design_id:r.output.design_id,page_id:r.output.page_id,design_version:1,manifest:{scope:{...f.s.scope,page_key:'home'},content:{title:'Exact approved Home'},layout:{template:'home'},sources:{content:{version_id:uuid(70),checksum:hash}}},stale_sources:[],delivery_approved:false,staging:false,published:false,review_sha256:hash,chat_review_sha256:'c'.repeat(64),chat_context:meta(i,args.p_context,r)}}
  }
  const rows=name.includes('staging')?state.staging:state.builds
  if(name.startsWith('read_'))return {data:{items:rows.slice(args.p_offset,args.p_offset+args.p_limit),limit:args.p_limit,offset:args.p_offset,has_more:false}}
  if(name.startsWith('recover_')){const row=rows.find(x=>x.receipt.request_id===args.p_request_id);if(row&&name.includes('build'))row.state=buildState();return {data:row&&!state.absent?{status:'recorded',...row,must_not_submit:true}:{status:'not_recorded',must_not_submit:true}}}
  throw Error('Unexpected synthetic RPC '+name)
 },functions:{invoke:async(name,{body:b})=>{
  calls.push({name,body:structuredClone(b)})
  const {organization_id,project_id,conversation_id,source_message_id}=b,i={organization_id,project_id,conversation_id,source_message_id},c=b.context
  if(b.action==='dry-run-chat')return {data:{data:{...i,engagement_id:r.engagement_id,job_id:c.job_id,page_id:c.page_id,target_id:c.target_id,site_id:uuid(80),base_url:'https://staging.example.test',package_sha256:hash,environment:'staging',published:false,remote_head:null,title:'Home',page_key:'home',review_sha256:hash,chat_review_sha256:'e'.repeat(64),chat_context:meta(i,c,state.builds.find(x=>x.receipt.request_id===c.build_request_id).receipt)}}}
  if(b.action==='recover-chat'){const row=state.staging.find(x=>x.receipt.request_id===b.request_id);return {data:{data:{...row,replayed:true}}}}
  if(state.rollback)return {data:{error:'Source changed',rollback_verified:true,request_retained:state.retained,code:'40001'}}
  const stage=b.action==='deploy-chat',receipt={version:1,...i,request_id:b.request_id,engagement_id:r.engagement_id,actor_id:r.actor_id,selection:c.selection,status:'claimed',kind:stage?'stage_native_package':'build_native_package',origin_request_id:stage?c.build_request_id:c.design_request_id,output:stage?{kind:'website_private_staging',run_id:uuid(81),job_id:c.job_id,design_id:c.design_id,page_id:c.page_id,target_id:c.target_id,site_id:uuid(80),previous_run_id:c.previous_run_id,package_sha256:hash,base_url:'https://staging.example.test'}:{kind:'website_native_package',job_id:uuid(71),design_id:c.design_id,page_id:c.page_id}}
  const evidence=state.stageStatus==='staged'?{status:'staged',environment:'staging',published:false,request_id:b.request_id,site_id:uuid(80),package_sha256:hash,base_url:'https://staging.example.test',preview_verified:true,preview_url:'https://staging.example.test/?anka_staging_preview='+b.request_id}:null
  const result={receipt,state:stage?{kind:'website_private_staging',status:state.stageStatus,evidence}:buildState()};(stage?state.staging:state.builds).unshift(result)
  if(state.never)return new Promise(resolve=>{state.release=()=>resolve({data:{data:{...result,replayed:false}}})})
  if(stage?state.loseStage:state.loseBuild)throw Error('Synthetic response lost')
  return {data:{data:{...result,replayed:false}}}
 }}}
 const nativeBuild={workspace:async()=>({designs:[{design_id:r.output.design_id,page_key:'home',title:'Home',version_number:1}],jobs:state.builds.map(x=>({...x.state,id:x.receipt.output.job_id,page_id:r.output.page_id,request_id:x.receipt.request_id})),design_total:1,job_total:state.builds.length})}
 const nativeStage={workspace:async()=>({connections:[],targets:[{id:uuid(79),current:true,site_id:uuid(80),base_url:'https://staging.example.test',display_name:'Synthetic private staging',version_number:1}],jobs:state.builds.map(x=>({...x.state,id:x.receipt.output.job_id,page_id:r.output.page_id,page_key:'home',title:'Home'})),runs:[],issues:[],has_more:false})}
 const chatRepositories={build:createProjectChatNativeBuildRepository(client),staging:createProjectChatNativeStagingRepository(client),design:{recover:async()=>({status:'recorded',receipt:r})},stages:{readPartition:async(_s,input)=>{calls.push({name:'fresh-stage',input});return {state:'current',plan_id:input.planId,group_id:input.groupId,partition:input.partition,context_sha256:hash}}}}
 const props={workspace:{...f.props.workspace,activeServices:[{organization_id:r.organization_id,engagement_id:r.engagement_id,status:'active',service_catalog:{is_active:true,department_id:'development',slug:'staging_production_builds'}}]},messages:f.props.messages,actorId:r.actor_id,conversationId:r.conversation_id,owner:true,membership:{organizationId:r.organization_id,role:'operations_admin',status:'active'},readActor:async()=>r.actor_id,buildRepository:nativeBuild,stagingRepository:nativeStage,chatRepositories,request:{id:uuid(90),receipt:r}}
 return {props,state,calls,r,uuid,chatRepositories}
}
