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

const native=JSON.parse(readFileSync(new URL('./testSupport/chatDesignNativeSource.json',import.meta.url)))
const recorded=JSON.parse(readFileSync(new URL('./testSupport/chatDesignNativeReceipt.json',import.meta.url)))
test('actual native null-selection export passes adapter but differs from frozen mounted stage-selection intent',async t=>{
 const {identity:i,context:c,source:s}=native,h=s.chat_context.handoff_receipt,calls=[]
 const client={rpc:async(name,args)=>{calls.push({name,args});if(name==='get_project_chat_native_design_source'){assert.deepEqual(args.p_context,c);return {data:s}}if(name==='recover_project_chat_native_design_action')return {data:recorded.recovery};if(name==='read_project_chat_native_design_actions')return {data:{items:[],limit:args.p_limit,offset:args.p_offset,has_more:false}};throw Error('Unexpected native read')},functions:{invoke:async(name,{body})=>{calls.push({name,args:body});return {data:{data:recorded.receipt}}}}}
 const repository=createProjectChatNativeDesignRepository(client)
 const loaded=await repository.load(i,c),proposal=await repository.prepare(i,c,loaded,websiteNativeLayout(loaded))
 assert.deepEqual(proposal,recorded.proposal)
 assert.deepEqual(await repository.confirm(proposal),recorded.receipt)
 assert.deepEqual(await repository.recover(i),recorded.recovery)
 const priorWrites=calls.filter(v=>v.name==='website-native-design').length
 const engagement={id:c.engagement_id,organization_id:i.organization_id,project_id:i.project_id}
 const briefId='a0000000-0000-4000-8000-000000000041'
 // These workspace, page, brief and current-partition read boundaries are synthetic.
 // Native source/receipt/proposal bytes remain exactly the owner's exports.
 const data={engagement,versions:[{id:h.output.artifact_version_id,artifact_id:h.output.artifact_id,content_checksum:h.output.content_checksum}],creativeBriefs:[{id:briefId,organization_id:i.organization_id,engagement_id:c.engagement_id,visibility:'official',engagement_service_id:h.handoff.receiving_service_id,engagement_work_item_id:c.receiving_work.id,current_version_id:c.brief_version_id,frozen_version_id:c.brief_version_id}],creativeBriefVersions:[{id:c.brief_version_id,creative_brief_id:briefId,validation_snapshot:{valid:true},content:{output_type:'website',title:'Synthetic confirmed brief'},version_number:1}]}
 const fixture={props:{workspace:{project:{id:i.project_id,organization_id:i.organization_id},engagement},actorId:s.chat_context.actor_id,conversationId:i.conversation_id,messages:[{id:h.source_message_id,conversation_id:i.conversation_id,author_id:h.actor_id,role:'user',body:'Synthetic fixture message'}],canSave:true,repository,studio:{load:async()=>data},native:{workspace:async()=>({sites:[{...s.site_version,organization_id:i.organization_id,project_id:i.project_id,engagement_id:c.engagement_id}],designs:[]})},pages:{list:async()=>({pages:[{page_id:c.page_id,source:{title:'Home',page_key:'home'}}],counts:{filtered_total:1}})},relations:{read:async({subjectId})=>({subject:subjectId===c.source_work.id?c.source_work:c.receiving_work})},stages:{readPartition:async()=>({state:'current',plan_id:h.selection.plan_id,group_id:h.selection.group_id,partition:h.selection.partition,context_sha256:h.selection.context_sha256})},contentRepository:{recover:async()=>({status:'recorded',receipt:h})},request:{id:'original-native-handoff',receipt:h}}}
 const mounted=await mount(t,fixture);await mounted.render();await until(()=>mounted.button('Load exact Design sources'));await mounted.click('Load exact Design sources')
 const attempted=calls.filter(v=>v.name==='get_project_chat_native_design_source').at(-1).args.p_context
 assert.deepEqual({...attempted,selection:null},c)
 assert.deepEqual(attempted.selection,h.selection)
 assert.equal(c.selection,null)
 assert.equal(mounted.button('Confirm Design save'),undefined)
 assert.equal(calls.filter(v=>v.name==='website-native-design').length,priorWrites)
 assert.match(mounted.env.container.textContent,/Expected values to be strictly deep-equal/)
})
