import test from 'node:test'
import assert from 'node:assert/strict'
import {act,createElement} from 'react'
import {createRoot} from 'react-dom/client'
import {createServer} from 'vite'
import {mountedEnvironment} from './testSupport/n1bMountedDom.js'
import {createContentActionFixture,actionId} from '../../tools/project-chat-content-fixture.js'
import {readFileSync} from 'node:fs'
import {createHash} from 'node:crypto'
import {createProjectChatActionRepository,prepareProjectChatContentAction} from './projectChatActionRepository.js'
// Native SQL action/receipt bytes are preserved. Workspace, read and approval UI
// boundaries below are synthetic; this is not signed-in or live acceptance.
const nativeBytes=readFileSync(new URL('./testSupport/chatContentNativeReceipts.json',import.meta.url))
assert.equal(createHash('sha256').update(nativeBytes).digest('hex'),'c4563325420a1cc0f561e4da721b321b2042b6d152dfbda3cce496f20c2e4606')
const native=JSON.parse(nativeBytes),[ordinary,stage,handoff,historical]=native.cases
function nativeFixture(saved){
 const f=createContentActionFixture({...saved.identity,engagementId:saved.action.engagement_id,actorId:saved.receipt.actor_id})
 f.selection=saved.action.selection
 f.workspace.engagementWorkItems=[]
 Object.assign(f.source,{...saved.receipt.source_work,title:saved.action.source_work.title,linked_artifact_version_id:saved.receipt.output.artifact_version_id})
 const version={id:saved.receipt.output.artifact_version_id,...saved.receipt.output,content:saved.action.content,ai_use_allowed:false,data_classification:'internal'}
 const structure={id:stage.action.content.source_architecture_version_id,artifact_id:actionId(19),version_number:1,content:{pages:[{page_key:'home',slug:'home',title:'Home'}]}}
 f.state.hash=saved.action.selection?.context_sha256
 f.studio.load=async(_id,navigation={})=>({engagement:f.workspace.engagement,artifacts:[{id:structure.artifact_id,artifact_type:'website_architecture'}],versions:[structure,...f.state.versions],contentServices:[{id:saved.action.active_service_id,organization_id:f.organizationId,engagement_id:f.engagementId,status:'active',service_catalog:{department_id:'content',is_active:true,name:'Native Content service'}}],navigationWorkRecord:navigation.workRecord?f.source:null})
 f.studio.loadLibrary=async()=>({versions:f.state.versions,approvals:f.state.approvals,downstreamServices:[{id:handoff.action.receiving_service_id,organization_id:f.organizationId,engagement_id:f.engagementId,status:'active',service_catalog:{department_id:'design',is_active:true,name:'Native Design service'}}],downstreamWorkstreams:[{id:handoff.action.receiving_workstream_id,organization_id:f.organizationId,project_id:f.projectId,department_id:'design',status:'active',name:'Native Design stream'}]})
 f.stages.read=async()=>({plan_id:stage.action.selection.plan_id,groups:[{id:stage.action.selection.group_id,steps:[{key:'draft',department_id:'content'}]}]})
 f.stages.readPartition=async()=>({state:'current',plan_id:stage.action.selection.plan_id,group_id:stage.action.selection.group_id,partition:stage.action.selection.partition,page:{id:stage.action.selection.partition.id,page_key:'home',architecture_artifact_id:structure.artifact_id},context_sha256:f.state.hash,steps:[{key:'draft',phase:stage.action.selection.phase,action:'run',depends_on:[],items:[{instance:1,work_required:true,work_item_id:null,missing_work:false}]}]})
 f.expected=saved
 const identityArgs=c=>({p_organization_id:c.identity.organizationId,p_project_id:c.identity.projectId,p_conversation_id:c.identity.conversationId,p_source_message_id:c.identity.sourceMessageId,p_request_id:c.identity.requestId})
 f.client.rpc=async(name,args)=>{
  f.state.calls.push({name,args:structuredClone(args)})
  if(name==='read_project_chat_content_actions')return {data:{items:f.state.receipts,limit:args.p_limit,offset:args.p_offset,has_more:false},error:null}
  if(name==='recover_project_chat_content_action'){
   assert.deepEqual(args,identityArgs(historical))
   return {data:{status:'recorded',receipt:historical.receipt},error:null}
  }
  assert.equal(name,'apply_project_chat_content_action')
  assert.deepEqual(args,{...identityArgs(f.expected),p_action:f.expected.action})
  f.state.receipts.unshift(f.expected.receipt)
  if(f.expected===saved)f.state.versions=[version]
  return {data:f.expected.receipt,error:null}
 }
 f.repository=createProjectChatActionRepository(f.client)
 return f
}
async function exactSave(h,c){
 await h.render({request:{id:c.name,sourceMessageId:c.identity.sourceMessageId}})
 await until(()=>h.field('Content title'))
 const content=c.action.content
 for(const [label,value]of [['Content title',content.working_title],['Objective',content.objective],['Audience',content.audience],['Language',content.language],['Content text',content.body],['Source Content Work','new'],['New Content Work title',c.action.source_work.title],['Work description',c.action.source_work.description],['Change summary',c.action.change_summary]])await h.change(label,value)
 if(content.destination)await h.change('Content destination',content.destination)
 await h.click('Review Content save')
 await until(()=>h.button('Confirm Content save'))
 await h.click('Confirm Content save')
 assert.deepEqual(h.fixture.state.calls.find(x=>x.name==='apply_project_chat_content_action').args.p_action,c.action)
 await until(()=>h.env.container.textContent.includes('Content saved. Review this exact version next.'))
}
function requestIds(t,...ids){
 const previous=crypto.randomUUID
 crypto.randomUUID=()=>{assert.ok(ids.length,'No unexpected action preparation');return ids.shift()}
 t.after(()=>{crypto.randomUUID=previous})
}
const nodes=n=>[n,...n.childNodes.flatMap(nodes)],props=n=>n?.[Object.keys(n).find(k=>k.startsWith('__reactProps$'))]
const flush=()=>act(async()=>{await new Promise(r=>setTimeout(r,0))})
async function until(check){for(let i=0;i<100;i++){if(check())return;await act(async()=>{await new Promise(r=>setTimeout(r,10))})}assert.ok(check(),'Expected mounted condition')}
async function mount(t,fixture){
 const env=mountedEnvironment(),storage=new Map(),signal=new AbortController().signal
 const values={document:env.document,window:env.window,Node:env.window.Node,HTMLElement:env.window.HTMLElement,IS_REACT_ACT_ENVIRONMENT:true,sessionStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)}}
 const previous=Object.fromEntries(Object.keys(values).map(k=>[k,globalThis[k]]));Object.assign(globalThis,values);globalThis.__contentActionTest=fixture
 const vite=await createServer({server:{middlewareMode:true},appType:'custom',logLevel:'silent',plugins:[{name:'content-actions-mounted',enforce:'pre',resolveId(source){if(source.endsWith('/lib/supabase.js'))return '\0content-client';if(source.endsWith('AuthContext.jsx'))return '\0content-auth';if(source.endsWith('artifactApprovalRepository.js'))return '\0content-approval'},load(id){if(id==='\0content-client')return 'export const supabase={rpc(){throw Error("Unexpected live RPC")}}';if(id==='\0content-auth')return 'export const useAuth=()=>({user:{id:globalThis.__contentActionTest.actorId}})';if(id==='\0content-approval')return 'export const artifactApprovals=new Proxy({},{get:(_,k)=>(...a)=>globalThis.__contentActionTest.approvals[k](...a)})'}}]})
 const {default:Panel}=await vite.ssrLoadModule('/src/components/ProjectChatContentActions.jsx'),root=createRoot(env.container)
 const all=()=>nodes(env.container),button=text=>all().find(n=>n.tagName==='BUTTON'&&n.textContent===text)
 const field=label=>{const row=all().find(n=>n.tagName==='LABEL'&&n.childNodes[0]?.textContent===label);return row&&nodes(row).find(n=>['INPUT','TEXTAREA','SELECT'].includes(n.tagName))}
 const click=async text=>{const b=button(text);assert.ok(b,text);assert.ok(!b.disabled,text+' enabled');await act(async()=>props(b).onClick({preventDefault(){}}));await flush()}
 const change=async(label,value)=>{const el=field(label);assert.ok(el,label);await act(async()=>props(el).onChange({target:{value,checked:value}}));await flush()}
 const render=async(extra={})=>{await act(async()=>root.render(createElement(Panel,{key:fixture.conversationId,workspace:fixture.workspace,conversationId:fixture.conversationId,actorId:fixture.actorId,messages:fixture.messages,selection:fixture.selection,signal,repository:fixture.repository,studio:fixture.studio,stages:fixture.stages,relations:fixture.relations,timeoutMs:2000,...extra})));await flush()}
 t.after(async()=>{await act(async()=>root.unmount());await vite.close();Object.assign(globalThis,previous);delete globalThis.__contentActionTest})
 return {fixture,storage,env,root,render,click,change,button,field,all}
}

test('native ordinary save: exact original action through mounted UI and frozen adapter',async t=>{
 requestIds(t,ordinary.identity.requestId)
 const h=await mount(t,nativeFixture(ordinary))
 await exactSave(h,ordinary)
 assert.equal(h.storage.size,0)
 assert.deepEqual(h.fixture.state.receipts,[ordinary.receipt])
})

test('native stage save -> existing approval return -> fresh same-page Design handoff -> historical recovery',async t=>{
 requestIds(t,stage.identity.requestId,actionId(99),handoff.identity.requestId)
 const f=nativeFixture(stage),h=await mount(t,f)
 await exactSave(h,stage)
 // Existing governed UI return boundary: native SQL already proved both signoffs.
 // Here only the second actor's return is simulated, without claiming another SQL write.
 f.approvals.load=async()=>({request:{id:actionId(60),status:'pending',approval_policy:'sequential'},approvers:[],signoffs:[{id:actionId(61),required_approver_id:actionId(62),sequence_position:1,signed_off_at:'2026-11-06T00:00:00Z'},{id:actionId(63),required_approver_id:f.actorId,sequence_position:2,signed_off_at:null}]})
 let signoffs=0
 f.approvals.signOff=async id=>{assert.equal(id,actionId(60));signoffs++;f.state.approvals=[{id:handoff.action.approval_id,artifact_version_id:handoff.action.artifact_version_id}];f.state.hash=handoff.action.selection.context_sha256}
 await h.render({key:'approval-return'})
 await until(()=>h.button('Review exact saved version'));await h.click('Review exact saved version')
 await until(()=>h.button('Sign off this exact version'));await h.click('Sign off this exact version')
 await until(()=>h.button('Prepare Design handoff'));assert.equal(signoffs,1)
 f.expected=handoff
 await h.click('Prepare Design handoff')
 for(const [label,value]of [['Receiving Design Work','new'],['New Design Work title',handoff.action.receiving_work.title],['New Design Work description',handoff.action.receiving_work.description],['Recipient note',handoff.action.recipient_note]])await h.change(label,value)
 await h.click('Review Design handoff')
 await h.click('Edit reviewed action')
 assert.equal(props(h.field('New Design Work description')).value,handoff.action.receiving_work.description)
 assert.equal(props(h.field('Recipient note')).value,handoff.action.recipient_note)
 // Only the final confirmation uses the original native request UUID.
 await h.click('Review Design handoff');await h.click('Confirm Design handoff')
 await until(()=>h.env.container.textContent.includes('Design handoff recorded'))
 assert.deepEqual(f.state.receipts,[handoff.receipt,stage.receipt])
 assert.notEqual(stage.receipt.selection.context_sha256,handoff.receipt.selection.context_sha256)
 const original=await prepareProjectChatContentAction(stage.identity,stage.action)
 h.storage.set(`anka:chat-content-action:${f.actorId}:${f.organizationId}:${f.projectId}:${f.engagementId}:${f.conversationId}`,JSON.stringify(original))
 await h.render({key:'historical-recovery',selection:{...stage.action.selection,context_sha256:'f'.repeat(64)}})
 await until(()=>h.button('Check saved result'));await h.click('Check saved result')
 await until(()=>h.storage.size===0)
 assert.equal(f.state.calls.filter(c=>c.name==='apply_project_chat_content_action').length,2)
 assert.equal(f.state.calls.filter(c=>c.name==='recover_project_chat_content_action').length,1)
 assert.deepEqual(historical.receipt,stage.receipt)
})
