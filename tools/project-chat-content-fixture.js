// Synthetic UI fixture only. No production records or provider calls.
import {createProjectChatActionRepository} from '../src/data/projectChatActionRepository.js'
export const actionId=n=>`ab000000-0000-4000-8000-${String(n).padStart(12,'0')}`
export function createContentActionFixture(options={}){
 const id=actionId,organizationId=options.organizationId||id(1),projectId=options.projectId||id(2),conversationId=options.conversationId||id(3),actorId=options.actorId||id(4),engagementId=options.engagementId||id(5)
 const source={id:id(6),row_version:1,organization_id:organizationId,project_id:projectId,engagement_id:engagementId,department_id:'content',status:'not_started',title:'Homepage Content',linked_artifact_version_id:null}
 const receiver={...source,id:id(7),department_id:'design',title:'Homepage Design'}
 const workspace={project:{id:projectId,organization_id:organizationId},engagement:{id:engagementId,organization_id:organizationId,project_id:projectId},engagementWorkItems:[source,receiver]}
 const messages=[{id:options.sourceMessageId||id(8),conversation_id:conversationId,author_id:actorId,role:'user',body:'Write the homepage copy.'},{id:id(18),conversation_id:conversationId,role:'assistant',status:'completed',in_reply_to_message_id:options.sourceMessageId||id(8),body:'  Exact editable homepage text.\nKeep these spaces.  '}]
 const selection={version:1,organization_id:organizationId,project_id:projectId,engagement_id:engagementId,plan_id:id(10),group_id:id(11),phase:'website.content',partition:{kind:'website_page',id:id(12),architecture_version_id:id(9)},context_sha256:'a'.repeat(64)}
 const structure={id:id(9),artifact_id:id(19),version_number:1,content:{pages:[{page_key:'home',title:'Homepage'}]}}
 const state={receipts:[],versions:[],approvals:[],calls:[],hash:'a'.repeat(64),lose:false,never:false,blocked:false,missing:false,recoverAbsent:false,release:null}
 const output=()=>({artifact_id:id(20),artifact_version_id:state.versions.at(-1).id,version_number:state.versions.length,content_checksum:'c'.repeat(64)})
 const client={rpc:async(name,args)=>{
  state.calls.push({name,args:structuredClone(args)})
  if(name==='read_project_chat_content_actions')return {data:{items:structuredClone(state.receipts.slice(args.p_offset,args.p_offset+args.p_limit)),limit:args.p_limit,offset:args.p_offset,has_more:state.receipts.length>args.p_offset+args.p_limit},error:null}
  if(name==='recover_project_chat_content_action'){const receipt=state.receipts.find(r=>r.request_id===args.p_request_id);return {data:receipt&&!state.recoverAbsent?{status:'recorded',receipt:structuredClone(receipt)}:{status:'not_recorded',must_not_submit:true},error:null}}
  if(name!=='apply_project_chat_content_action')throw Error('Unexpected fixture RPC')
  if(state.blocked)return {data:null,error:{code:'40001',message:'Stage or source Work changed; review again.'}}
  const action=args.p_action
  if(action.kind==='save_content'){
   const version={id:id(30+state.versions.length),artifact_id:id(20),version_number:state.versions.length+1,content:structuredClone(action.content),content_checksum:'c'.repeat(64),data_classification:action.data_classification,ai_use_allowed:action.ai_use_allowed}
   state.versions.push(version);source.row_version++;source.linked_artifact_id=id(20);source.linked_artifact_version_id=version.id;state.hash='b'.repeat(64)
  }
  const receipt={version:1,request_id:args.p_request_id,organization_id:organizationId,project_id:projectId,engagement_id:engagementId,conversation_id:conversationId,source_message_id:args.p_source_message_id,actor_id:actorId,kind:action.kind,status:action.kind==='save_content'?'content_saved':'handoff_recorded',source_work:{id:source.id,row_version:source.row_version},output:output(),handoff:action.kind==='save_content'?null:{request_id:id(50),approval_id:action.approval_id,receiving_service_id:action.receiving_service_id,receiving_workstream_id:action.receiving_workstream_id,receiving_work_item_id:receiver.id},review_required:action.kind==='save_content',selection:structuredClone(action.selection)}
  state.receipts.unshift(receipt)
  if(state.never)return new Promise(resolve=>{state.release=()=>resolve({data:receipt,error:null})})
  if(state.lose)throw Error('Synthetic response lost')
  return {data:structuredClone(receipt),error:null}
 }}
 const studio={
  load:async(_engagement,navigation={})=>({engagement:workspace.engagement,artifacts:[{id:id(19),artifact_type:'website_architecture'},{id:id(20),artifact_type:'content'}],versions:[structure,...state.versions],contentServices:[{id:id(13),organization_id:organizationId,engagement_id:engagementId,status:'active',service_catalog:{name:'Content writing',department_id:'content',is_active:true}}],navigationWorkRecord:navigation.workRecord?{...source}:null}),
  loadLibrary:async()=>({versions:state.missing?[]:structuredClone(state.versions),approvals:structuredClone(state.approvals),downstreamServices:[{id:id(14),organization_id:organizationId,engagement_id:engagementId,status:'active',service_catalog:{department_id:'design',name:'Website design',is_active:true}}],downstreamWorkstreams:[{id:id(15),organization_id:organizationId,project_id:projectId,department_id:'design',status:'active',name:'Design team'}]}),
  approveArtifact:async versionId=>{state.approvals=[{id:id(16),artifact_version_id:versionId}];state.hash='d'.repeat(64)},
 }
 const stages={read:async()=>({plan_id:selection.plan_id,groups:[{id:selection.group_id,steps:[{key:'copy',department_id:'content'}]}]}),readPartition:async()=>({state:'current',plan_id:selection.plan_id,group_id:selection.group_id,partition:structuredClone(selection.partition),page:{id:selection.partition.id,page_key:'home',architecture_artifact_id:id(19)},context_sha256:state.hash,steps:[{key:'copy',label:'Content',phase:selection.phase,action:'run',depends_on:[],items:[{instance:1,work_required:true,work_item_id:source.id,missing_work:false},{instance:2,work_required:true,work_item_id:null,missing_work:false}]}]})}
 const relations={read:async({subjectId})=>({subject:{id:subjectId,kind:'engagement_work_item',row_version:subjectId===source.id?source.row_version:receiver.row_version},assets:[{kind:'website_page',id:selection.partition.id}]})}
 const approvals={load:async()=>({request:null,signoffs:[],approvers:[]})}
 return {workspace,messages,selection,organizationId,projectId,engagementId,conversationId,actorId,source,receiver,state,studio,stages,relations,approvals,client,repository:createProjectChatActionRepository(client)}
}
