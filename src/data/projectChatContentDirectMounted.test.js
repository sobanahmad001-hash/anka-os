import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {act,createElement} from 'react'
import {createRoot} from 'react-dom/client'
import {createServer} from 'vite'
import {mountedEnvironment} from './testSupport/n1bMountedDom.js'
import {createDirectChatFixture,createProjectNavigationPreviewFixture,actor,organizationId,allowlist} from '../../tools/direct-chat-fixture.js'
import {createContentActionFixture,actionId} from '../../tools/project-chat-content-fixture.js'
import {projectStagePlan} from './projectStagePlan.js'
const descendants=n=>[n,...n.childNodes.flatMap(descendants)]
const props=n=>n?.[Object.keys(n).find(k=>k.startsWith('__reactProps$'))]
const flush=()=>act(async()=>{await new Promise(r=>setTimeout(r,0))})
async function until(condition){for(let i=0;i<150;i++){if(condition())return;await act(async()=>{await new Promise(r=>setTimeout(r,20))})}assert.ok(condition(),'Mounted condition became available')}
test('actual Chat inline save preserves composer and normal Send needs no action confirmation',async t=>{
 const env=mountedEnvironment(),storage=new Map(),signal=new AbortController().signal
 const values={document:env.document,window:env.window,Event:env.window.Event,Node:env.window.Node,HTMLElement:env.window.HTMLElement,IS_REACT_ACT_ENVIRONMENT:true,sessionStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)}}
 const previous=Object.fromEntries(Object.keys(values).map(k=>[k,globalThis[k]]));Object.assign(globalThis,values)
 const fixture=createDirectChatFixture({surface:'project',state:'populated'}),workspace=createProjectNavigationPreviewFixture(fixture.scope.project_id).workspace
 const native=JSON.parse(readFileSync(new URL('../../tools/project-stage-native-fixture.json',import.meta.url),'utf8'))
 const exact={organization_id:organizationId,project_id:workspace.project.id,engagement_id:workspace.engagement.id}
 const header={...native.header,...exact},unit={...native.unit,...exact}
 const actions=createContentActionFixture({organizationId,projectId:workspace.project.id,engagementId:workspace.engagement.id,conversationId:fixture.data.rows[0].id,actorId:actor,sourceMessageId:fixture.data.messages.find(m=>m.role==='user').id});workspace.engagementWorkItems=actions.workspace.engagementWorkItems
 const captured=[];const append=fixture.chat.appendContextHumanMessage;fixture.chat.appendContextHumanMessage=async input=>{captured.push(structuredClone(input));return append(input)}
 globalThis.__stageSendTest={fixture,actor,allowlist,organization:{activeOrganizationId:organizationId,activeMembership:{role:'system_owner'},scopeRevision:1,requestSignal:signal,handleOrganizationAccessError(){}},actions,rpc:async(name,args)=>name.includes('project_chat_content_action')?actions.client.rpc(name,args):({data:name==='read_project_stage_plan'?header:unit,error:null})}
 const vite=await createServer({server:{middlewareMode:true},appType:'custom',logLevel:'silent',plugins:[{name:'stage-send-mounted',enforce:'pre',resolveId(source){for(const [suffix,id] of [['/lib/supabase.js','client'],['AuthContext.jsx','auth'],['OrganizationContext.jsx','org'],['departmentChatRepository.js','chat'],['contextChatRunnerRepository.js','runner'],['integrationRepository.js','models'],['ProjectAttachmentPanel.jsx','attachments'],['contentStudioRepository.js','content'],['artifactApprovalRepository.js','approval']])if(source.endsWith(suffix))return '\0stage-'+id},load(id){
  if(id==='\0stage-client')return 'export const supabase={rpc:(...a)=>globalThis.__stageSendTest.rpc(...a),functions:{invoke(){throw Error("Unexpected live importer")}}}'
  if(id==='\0stage-auth')return 'export const useAuth=()=>({user:{id:globalThis.__stageSendTest.actor}})'
  if(id==='\0stage-org')return 'export const useOrganization=()=>globalThis.__stageSendTest.organization'
  if(id==='\0stage-chat')return 'export const departmentChat=new Proxy({},{get:(_,k)=>(...a)=>globalThis.__stageSendTest.fixture.chat[k](...a)})'
  if(id==='\0stage-runner')return 'export const contextChatRunner=new Proxy({},{get:(_,k)=>(...a)=>globalThis.__stageSendTest.fixture.runner[k](...a)})'
  if(id==='\0stage-content')return 'export const createContentStudioScope=()=>globalThis.__stageSendTest.actions.studio;export const contentStudio={forOrganization:createContentStudioScope}'
  if(id==='\0stage-approval')return 'export const artifactApprovals=new Proxy({},{get:(_,k)=>(...a)=>globalThis.__stageSendTest.actions.approvals[k](...a)})'
  if(id==='\0stage-models')return 'export const integrations={listModelAllowlist:async()=>globalThis.__stageSendTest.allowlist}'
  if(id==='\0stage-attachments')return `import {createElement} from 'react';export default function AttachmentProbe({documentProps,onClose}){globalThis.__stageSendTest.documents=documentProps;return createElement('div',null,createElement('button',{onClick:()=>documentProps.onSelection(['dd000000-0000-4000-8000-000000000001'])},'Select fixture reference'),createElement('button',{onClick:()=>documentProps.onSelection([])},'Deselect fixture reference'),createElement('button',{onClick:onClose},'Close fixture attachments'))}`
 }}]})
 const {default:Panel}=await vite.ssrLoadModule('/src/components/ContextConversationPanel.jsx'),root=createRoot(env.container)
 const all=()=>descendants(env.container),named=name=>all().find(n=>props(n)?.['aria-label']===name),button=name=>all().find(n=>n.tagName==='BUTTON'&&(props(n)?.['aria-label']||n.textContent)===name)
 const click=async name=>{assert.ok(button(name),name);await act(async()=>props(button(name)).onClick?.({preventDefault(){}}));await flush()}
 const render=async selection=>{await act(async()=>root.render(createElement(Panel,{directSend:true,contextKind:'project_team',projectId:workspace.project.id,projectJourney:workspace,initialConversation:fixture.data.rows[0],projectStageSelection:selection})));await flush()}
 t.after(async()=>{await act(async()=>root.unmount());await vite.close();Object.assign(globalThis,previous);delete globalThis.__stageSendTest})
 await render();await until(()=>named('Message')&&!named('Message').disabled)
 await act(async()=>props(named('Message')).onChange({target:{value:'Keep this normal Chat draft'}}))
 await click('Prepare Content');await until(()=>env.container.textContent.includes('Prepare Content from this message'))
 const field=label=>{const row=all().find(n=>n.tagName==='LABEL'&&n.childNodes[0]?.textContent===label);return row&&descendants(row).find(n=>['INPUT','TEXTAREA','SELECT'].includes(n.tagName))}
 for(const [label,value]of [['Content title','Chat draft output'],['Content destination','Homepage'],['Objective','Explain services'],['Audience','Visitors'],['Language','English'],['Content text','Reviewed exact Content'],['Content service',actionId(13)],['Source Content Work',actionId(6)]]){
  assert.ok(field(label),label);await act(async()=>props(field(label)).onChange({target:{value}}))
 }
 await click('Review Content save');await until(()=>button('Confirm Content save'));await click('Confirm Content save')
 await until(()=>button('Approve version 1'))
 assert.equal(named('Message').value,'Keep this normal Chat draft');assert.equal(fixture.data.counters.run,0)
 assert.equal(actions.state.calls.filter(c=>c.name==='apply_project_chat_content_action').length,1)
 assert.equal(actions.state.receipts[0].source_message_id,fixture.data.messages.find(m=>m.role==='user').id)
 await until(()=>!named('Message').disabled)
 await act(async()=>props(named('Chat composer')).onSubmit({preventDefault(){}}))
 await until(()=>fixture.data.counters.run===1);assert.equal(captured[0].message,'Keep this normal Chat draft')
 assert.equal(actions.state.calls.filter(c=>c.name==='apply_project_chat_content_action').length,1)
})
