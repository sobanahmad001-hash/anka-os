import {websiteNativeFixture} from './website-native-fixture.js'
import {websiteNativeLayout} from '../supabase/functions/_shared/websiteNativeDraft.js'
import {createProjectChatNativeDesignRepository} from '../src/data/projectChatNativeDesignRepository.js'
export const uuid=n=>`a0000000-0000-4000-8000-${String(n).padStart(12,'0')}`
async function baseFixture(parent = null) {
  const f = await websiteNativeFixture()
  const i = { organization_id: f.scope.organization_id, project_id: f.scope.project_id, conversation_id: uuid(20), source_message_id: uuid(21), request_id: uuid(22) }
  const c = { engagement_id: f.scope.engagement_id, selection: null, handoff_request_id: uuid(23), source_work: { id: uuid(24), row_version: 3 }, receiving_work: { id: uuid(25), row_version: 4 }, page_id: f.scope.page_id, architecture_version_id: f.sources.architecture.version_id, brief_version_id: f.sources.brief.version_id, site_version_id: f.sources.site_system.version_id, direction_version_id: null, expected_parent_design_id: parent }
  const s = { scope: f.scope, architecture: { artifact_version_id: c.architecture_version_id, approval_id: uuid(26), content_checksum: f.sources.architecture.checksum }, page: { title: 'Home' }, content_version: { id: f.sources.content.version_id, content_checksum: f.sources.content.checksum }, brief_version: { id: c.brief_version_id, content_checksum: f.sources.brief.checksum }, site_version: { id: c.site_version_id, request_sha256: f.sources.site_system.checksum, site: { ...f.site, navigation: [{ label: 'Home', path: '/home' }] } }, content_page: { source_format: 'writer_v2', page_brief: 'Context objective', draft_copy: 'Exact approved copy.', meta_title: 'Home', meta_description: '', primary_cta: null }, design_head: parent, review_sha256: 'a'.repeat(64), chat_review_sha256: 'b'.repeat(64) }
  const r = { version: 1, kind: 'save_native_design', status: 'design_draft_saved', ...i, engagement_id: c.engagement_id, actor_id: uuid(27), selection: null, handoff_request_id: c.handoff_request_id, source_work: c.source_work, receiving_work: c.receiving_work, output: { kind: 'website_native_design', design_id: uuid(28), page_id: c.page_id, parent_design_id: parent, version_number: parent ? 2 : 1, request_sha256: 'c'.repeat(64) }, review_required: true }
  const output = { artifact_id: uuid(30), artifact_version_id: s.content_version.id, version_number: 2, content_checksum: s.content_version.content_checksum }
  s.chat_context = { version: 1, organization_id: i.organization_id, project_id: i.project_id, engagement_id: c.engagement_id, conversation_id: i.conversation_id, source_message_id: i.source_message_id, actor_id: r.actor_id, context: structuredClone(c), source_work: structuredClone(c.source_work), receiving_work: structuredClone(c.receiving_work), content_approval: { artifact_id: output.artifact_id, artifact_version_id: output.artifact_version_id, content_checksum: output.content_checksum, approval_id: uuid(31) }, handoff_receipt: { version: 1, organization_id: i.organization_id, project_id: i.project_id, engagement_id: c.engagement_id, conversation_id: i.conversation_id, source_message_id: uuid(32), actor_id: r.actor_id, request_id: c.handoff_request_id, kind: 'handoff_design', status: 'handoff_recorded', selection: null, source_work: { id: c.source_work.id, row_version: 1 }, output, handoff: { request_id: c.handoff_request_id, approval_id: uuid(31), receiving_service_id: uuid(33), receiving_workstream_id: uuid(34), receiving_work_item_id: c.receiving_work.id }, review_required: false } }
  return { i, c, s, r, layout: websiteNativeLayout(s) }
}
// Synthetic UI boundaries only; no live reads, provider calls or deployed claims.
export async function createChatDesignFixture(options={}){
 let f=await baseFixture()
 const replacements=new Map([[f.i.organization_id,options.organizationId],[f.i.project_id,options.projectId],[f.i.conversation_id,options.conversationId],[f.i.source_message_id,options.sourceMessageId],[f.c.engagement_id,options.engagementId],[f.r.actor_id,options.actorId]].filter(([,v])=>v))
 f=JSON.parse(JSON.stringify(f,(_,value)=>typeof value==='string'&&replacements.has(value)?replacements.get(value):value))
 const {i,c,s,r}=f,h=s.chat_context.handoff_receipt
 h.source_message_id=i.source_message_id
 const state={calls:[],receipts:[],designs:[],lose:false,never:false,absent:false,blocked:false,release:null}
 const client={rpc:async(name,args)=>{
  state.calls.push({name,args:structuredClone(args)})
  if(name==='read_project_chat_native_design_actions')return {data:{items:state.receipts.slice(args.p_offset,args.p_offset+args.p_limit),limit:args.p_limit,offset:args.p_offset,has_more:false}}
  if(name==='get_project_chat_native_design_source'){
   if(state.blocked)throw Error('The exact source approval changed.')
   return {data:{...s,design_head:state.designs.at(-1)?.design_id||null,chat_context:{...s.chat_context,source_message_id:args.p_source_message_id,context:args.p_context,source_work:args.p_context.source_work,receiving_work:args.p_context.receiving_work}}}
  }
  if(name==='recover_project_chat_native_design_action'){const saved=state.receipts.find(v=>v.request_id===args.p_request_id);return {data:saved&&!state.absent?{status:'recorded',receipt:saved}:{status:'not_recorded',must_not_submit:true}}}
  if(name==='get_website_native_design')return {data:state.designs.find(v=>v.design_id===args.p_design_id)}
  throw Error('Unexpected fixture RPC: '+name)
 },functions:{invoke:async(name,{body})=>{
  state.calls.push({name,args:structuredClone(body)})
  if(state.blocked)return {data:{error:'Work changed',code:'40001',rollback_verified:true}}
  const output={...r.output,design_id:uuid(100+state.designs.length),parent_design_id:body.context.expected_parent_design_id,version_number:state.designs.length+1}
  const receipt={...r,request_id:body.request_id,source_message_id:body.source_message_id,selection:body.context.selection,source_work:body.context.source_work,receiving_work:body.context.receiving_work,output}
  state.receipts.unshift(receipt);state.designs.push({organization_id:i.organization_id,project_id:i.project_id,engagement_id:c.engagement_id,...output,manifest:body.manifest,html_content:'<html><body>Exact saved Design</body></html>'})
  if(state.never)return new Promise(resolve=>{state.release=()=>resolve({data:{data:receipt}})})
  if(state.lose)throw Error('Response lost')
  return {data:{data:receipt}}
 }}}
 const engagement={id:c.engagement_id,organization_id:i.organization_id,project_id:i.project_id,brand_id:uuid(40)}
 const data={engagement,versions:[{id:h.output.artifact_version_id,artifact_id:h.output.artifact_id,content_checksum:h.output.content_checksum,content:{schema_version:2,source_architecture_version_id:c.architecture_version_id,target_page_key:'home',body:s.content_page.draft_copy}}],creativeBriefs:[{id:uuid(41),organization_id:i.organization_id,engagement_id:c.engagement_id,visibility:'official',engagement_service_id:h.handoff.receiving_service_id,engagement_work_item_id:c.receiving_work.id,current_version_id:c.brief_version_id,frozen_version_id:c.brief_version_id}],creativeBriefVersions:[{id:c.brief_version_id,creative_brief_id:uuid(41),version_number:1,validation_snapshot:{valid:true},content:{output_type:'website',title:'Home brief'}}]}
 const site={...s.site_version,organization_id:i.organization_id,project_id:i.project_id,engagement_id:c.engagement_id,version_number:1}
 const props={workspace:{project:{id:i.project_id,organization_id:i.organization_id},engagement},actorId:r.actor_id,conversationId:i.conversation_id,messages:[{id:i.source_message_id,conversation_id:i.conversation_id,author_id:r.actor_id,role:'user',body:'Design this approved page.'}],canSave:true,repository:createProjectChatNativeDesignRepository(client),studio:{load:async()=>data},native:{workspace:async()=>({sites:[site],designs:state.designs})},pages:{list:async()=>({pages:[{page_id:c.page_id,source:{page_key:'home',title:'Home',path:'home'}}],counts:{filtered_total:1}})},relations:{read:async({subjectId})=>({subject:subjectId===c.source_work.id?c.source_work:c.receiving_work})},contentRepository:{recover:async()=>({status:'recorded',receipt:h})},request:{id:uuid(50),receipt:h}}
 return {...f,h,state,props,data,site}
}
