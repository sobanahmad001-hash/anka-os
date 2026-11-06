import test from 'node:test'
import assert from 'node:assert/strict'
import {act,createElement} from 'react'
import {createRoot} from 'react-dom/client'
import {createServer} from 'vite'
import {mountedEnvironment} from './testSupport/n1bMountedDom.js'
import {readFileSync} from 'node:fs'
import {createProjectChatNativeDesignRepository} from './projectChatNativeDesignRepository.js'
import {websiteNativeLayout} from '../../supabase/functions/_shared/websiteNativeDraft.js'
const nodes=n=>[n,...n.childNodes.flatMap(nodes)],props=n=>n?.[Object.keys(n).find(k=>k.startsWith('__reactProps$'))]
const flush=()=>act(async()=>{await new Promise(r=>setTimeout(r,0))})
async function until(check){for(let i=0;i<100;i++){if(check())return;await act(async()=>{await new Promise(r=>setTimeout(r,10))})}assert.ok(check(),'Expected mounted condition')}
async function mount(t,fixture){
 const env=mountedEnvironment(),storage=new Map(),signal=new AbortController().signal
 const values={document:env.document,window:env.window,Node:env.window.Node,HTMLElement:env.window.HTMLElement,IS_REACT_ACT_ENVIRONMENT:true,sessionStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)}}
 const previous=Object.fromEntries(Object.keys(values).map(k=>[k,globalThis[k]]));Object.assign(globalThis,values);globalThis.__contentActionTest=fixture
 const vite=await createServer({server:{middlewareMode:true},appType:'custom',logLevel:'silent',plugins:[{name:'content-actions-mounted',enforce:'pre',resolveId(source){if(source.endsWith('/lib/supabase.js'))return '\0content-client';if(source.endsWith('OrganizationContext.jsx'))return '\0content-org';if(source.endsWith('AuthContext.jsx'))return '\0content-auth';if(source.endsWith('artifactApprovalRepository.js'))return '\0content-approval'},load(id){if(id==='\0content-client')return 'export const supabase={rpc(){throw Error("Unexpected live RPC")}}';if(id==='\0content-org')return 'export const useOrganization=()=>({})';if(id==='\0content-auth')return 'export const useAuth=()=>({user:{id:globalThis.__contentActionTest.actorId}})';if(id==='\0content-approval')return 'export const artifactApprovals=new Proxy({},{get:(_,k)=>(...a)=>globalThis.__contentActionTest.approvals[k](...a)})'}}]})
 const {ChatDesignActions:Panel}=await vite.ssrLoadModule('/src/components/ProjectChatDesignActions.jsx'),root=createRoot(env.container)
 const all=()=>nodes(env.container),button=text=>all().find(n=>n.tagName==='BUTTON'&&n.textContent===text)
 const field=label=>{const row=all().find(n=>n.tagName==='LABEL'&&n.childNodes[0]?.textContent===label);return row&&nodes(row).find(n=>['INPUT','TEXTAREA','SELECT'].includes(n.tagName))}
 const click=async text=>{const b=button(text);assert.ok(b,text);assert.ok(!b.disabled,text+' enabled');await act(async()=>props(b).onClick({preventDefault(){}}));await flush()}
 const change=async(label,value)=>{const el=field(label);assert.ok(el,label);await act(async()=>props(el).onChange({target:{value,checked:value}}));await flush()}
 const render=async(extra={})=>{await act(async()=>root.render(createElement(Panel,{key:fixture.props.conversationId,...fixture.props,signal,timeoutMs:2000,...extra})));await flush()}
 t.after(async()=>{await act(async()=>root.unmount());await vite.close();Object.assign(globalThis,previous);delete globalThis.__contentActionTest})
 return {fixture,storage,env,root,render,click,change,button,field,all}
}

const native=JSON.parse(readFileSync(new URL('./testSupport/chatDesignNativeStageSource.json',import.meta.url)))
const recorded=JSON.parse(readFileSync(new URL('./testSupport/chatDesignNativeStageReceipt.json',import.meta.url)))
const prior=JSON.parse(readFileSync(new URL('./testSupport/chatDesignNativeReceipt.json',import.meta.url)))
test('actual staged native revision through mounted UI preserves exact action, parent and original recovery',async t=>{
 const {identity:i,context:c,source:s}=native,h=s.chat_context.handoff_receipt,calls=[]
 let saved=false
 const originalUUID=crypto.randomUUID;crypto.randomUUID=()=>i.request_id;t.after(()=>{crypto.randomUUID=originalUUID})
 const parentRead={organization_id:i.organization_id,project_id:i.project_id,engagement_id:c.engagement_id,...prior.receipt.output,manifest:prior.proposal.manifest,html_content:'<p>Synthetic historical preview boundary</p>'}
 const client={rpc:async(name,args)=>{
  calls.push({name,args:structuredClone(args)})
  if(name==='get_project_chat_native_design_source'){assert.deepEqual(args,{p_organization_id:i.organization_id,p_project_id:i.project_id,p_conversation_id:i.conversation_id,p_source_message_id:i.source_message_id,p_context:c});return {data:s}}
  if(name==='get_website_native_design'){assert.equal(args.p_design_id,prior.receipt.output.design_id);return {data:parentRead}}
  if(name==='recover_project_chat_native_design_action'){assert.deepEqual(args,{p_organization_id:i.organization_id,p_project_id:i.project_id,p_conversation_id:i.conversation_id,p_source_message_id:i.source_message_id,p_request_id:i.request_id});return {data:recorded.recovery}}
  if(name==='read_project_chat_native_design_actions')return {data:{items:saved?[recorded.receipt,prior.receipt]:[prior.receipt],limit:args.p_limit,offset:args.p_offset,has_more:false}}
  throw Error('Unexpected native read')
 },functions:{invoke:async(name,{body})=>{
  calls.push({name,args:structuredClone(body)})
  const p=recorded.proposal
  assert.equal(name,'website-native-design');assert.deepEqual(body,{action:'save_chat_design',...i,engagement_id:c.engagement_id,context:c,chat_review_sha256:p.chat_review_sha256,review_sha256:p.review_sha256,architecture_approval_id:p.architecture_approval_id,manifest:p.manifest})
  saved=true;return {data:{data:recorded.receipt}}
 }}}
 const repository=createProjectChatNativeDesignRepository(client)
 const engagement={id:c.engagement_id,organization_id:i.organization_id,project_id:i.project_id}
 const briefId='a0000000-0000-4000-8000-000000000041'
 // These workspace, page, brief and current-partition read boundaries are synthetic.
 // Native source/receipt/proposal bytes remain exactly the owner's exports.
 const data={engagement,versions:[{id:h.output.artifact_version_id,artifact_id:h.output.artifact_id,content_checksum:h.output.content_checksum}],creativeBriefs:[{id:briefId,organization_id:i.organization_id,engagement_id:c.engagement_id,visibility:'official',engagement_service_id:h.handoff.receiving_service_id,engagement_work_item_id:c.receiving_work.id,current_version_id:c.brief_version_id,frozen_version_id:c.brief_version_id}],creativeBriefVersions:[{id:c.brief_version_id,creative_brief_id:briefId,validation_snapshot:{valid:true},content:{output_type:'website',title:'Synthetic confirmed brief'},version_number:1}]}
 const fixture={props:{workspace:{project:{id:i.project_id,organization_id:i.organization_id},engagement},actorId:s.chat_context.actor_id,conversationId:i.conversation_id,messages:[{id:h.source_message_id,conversation_id:i.conversation_id,author_id:h.actor_id,role:'user',body:'Synthetic fixture message'}],canSave:true,repository,studio:{load:async()=>data},native:{workspace:async()=>({sites:[{...s.site_version,organization_id:i.organization_id,project_id:i.project_id,engagement_id:c.engagement_id}],designs:[]})},pages:{list:async()=>({pages:[{page_id:c.page_id,source:{title:'Home',page_key:'home'}}],counts:{filtered_total:1}})},relations:{read:async({subjectId})=>({subject:subjectId===c.source_work.id?c.source_work:c.receiving_work})},stages:{readPartition:async()=>({state:'current',plan_id:h.selection.plan_id,group_id:h.selection.group_id,partition:h.selection.partition,context_sha256:c.selection.context_sha256})},contentRepository:{recover:async()=>({status:'recorded',receipt:h})},request:null}}
 const mounted=await mount(t,fixture);await mounted.render();await until(()=>mounted.button('Revise this Design draft'));await mounted.click('Revise this Design draft');await mounted.click('Load exact Design sources');await until(()=>mounted.button('Review Design draft'));await mounted.click('Review Design draft');await mounted.click('Confirm Design save')
 assert.match(mounted.env.container.textContent,/Design draft saved · v2/)
 const writes=calls.filter(v=>v.name==='website-native-design');assert.equal(writes.length,1)
 assert.equal(writes[0].args.context.expected_parent_design_id,prior.receipt.output.design_id)
 assert.deepEqual(writes[0].args.context.selection,c.selection)
 assert.equal(mounted.storage.size,0)
 const recoveryKey=`anka:chat-native-design:${s.chat_context.actor_id}:${i.organization_id}:${i.project_id}:${c.engagement_id}:${i.conversation_id}`
 mounted.storage.set(recoveryKey,JSON.stringify({proposal:recorded.proposal,layout:websiteNativeLayout(s)}))
 await mounted.render({key:'recovery',request:null});await until(()=>mounted.button('Check saved Design result'));await mounted.click('Check saved Design result')
 assert.equal(mounted.storage.size,0);assert.equal(calls.filter(v=>v.name==='website-native-design').length,1)
 assert.equal(calls.filter(v=>v.name==='recover_project_chat_native_design_action').length,1)
 assert.deepEqual(recorded.recovery.receipt,recorded.receipt)
})
