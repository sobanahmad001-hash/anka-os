import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {act,createElement} from 'react'
import {createRoot} from 'react-dom/client'
import {createServer} from 'vite'
import {mountedEnvironment} from './testSupport/n1bMountedDom.js'
import {createDirectChatFixture,createProjectNavigationPreviewFixture,actor,organizationId,allowlist} from '../../tools/direct-chat-fixture.js'
import {createChatDesignFixture} from '../../tools/project-chat-design-fixture.js'
import {createContentActionFixture} from '../../tools/project-chat-content-fixture.js'
import {projectStagePlan} from './projectStagePlan.js'
const descendants=n=>[n,...n.childNodes.flatMap(descendants)]
const props=n=>n?.[Object.keys(n).find(k=>k.startsWith('__reactProps$'))]
const flush=()=>act(async()=>{await new Promise(r=>setTimeout(r,0))})
async function until(condition){for(let i=0;i<150;i++){if(condition())return;await act(async()=>{await new Promise(r=>setTimeout(r,20))})}assert.ok(condition(),'Mounted condition became available')}
test('actual Chat Design handoff saves inline, appends reviewed layout request and preserves normal Send',async t=>{
 const env=mountedEnvironment(),storage=new Map(),signal=new AbortController().signal
 const values={document:env.document,window:env.window,Event:env.window.Event,Node:env.window.Node,HTMLElement:env.window.HTMLElement,IS_REACT_ACT_ENVIRONMENT:true,sessionStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)}}
 const previous=Object.fromEntries(Object.keys(values).map(k=>[k,globalThis[k]]));Object.assign(globalThis,values)
 const fixture=createDirectChatFixture({surface:'project',state:'populated'}),workspace=createProjectNavigationPreviewFixture(fixture.scope.project_id).workspace
 const native=JSON.parse(readFileSync(new URL('../../tools/project-stage-native-fixture.json',import.meta.url),'utf8'))
 const exact={organization_id:organizationId,project_id:workspace.project.id,engagement_id:workspace.engagement.id}
 const header={...native.header,...exact},unit={...native.unit,...exact}
 const actions=createContentActionFixture({organizationId,projectId:workspace.project.id,engagementId:workspace.engagement.id,conversationId:fixture.data.rows[0].id,actorId:actor,sourceMessageId:fixture.data.messages.find(m=>m.role==='user').id});workspace.engagementWorkItems=actions.workspace.engagementWorkItems
 const design=await createChatDesignFixture({organizationId,projectId:workspace.project.id,engagementId:workspace.engagement.id,conversationId:fixture.data.rows[0].id,actorId:actor,sourceMessageId:fixture.data.messages.find(m=>m.role==='user').id});actions.state.receipts=[design.h]
 const captured=[];const append=fixture.chat.appendContextHumanMessage;fixture.chat.appendContextHumanMessage=async input=>{captured.push(structuredClone(input));return append(input)}
 globalThis.__stageSendTest={fixture,actor,allowlist,design,organization:{activeOrganizationId:organizationId,activeMembership:{role:'system_owner'},scopeRevision:1,requestSignal:signal,handleOrganizationAccessError(){}},actions,rpc:async(name,args)=>name.includes('project_chat_content_action')?actions.client.rpc(name,args):({data:name==='read_project_stage_plan'?header:unit,error:null})}
 const vite=await createServer({server:{middlewareMode:true},appType:'custom',logLevel:'silent',plugins:[{name:'stage-send-mounted',enforce:'pre',resolveId(source){for(const [suffix,id] of [['/lib/supabase.js','client'],['AuthContext.jsx','auth'],['OrganizationContext.jsx','org'],['departmentChatRepository.js','chat'],['contextChatRunnerRepository.js','runner'],['integrationRepository.js','models'],['ProjectAttachmentPanel.jsx','attachments'],['contentStudioRepository.js','content'],['artifactApprovalRepository.js','approval'],['projectChatNativeDesignRepository.js','nativeChat'],['designWorkshopRepository.js','designStudio'],['/websiteNative.js','native'],['/projectWebsitePages.js','pages'],['projectAssetRelationsRepository.js','relations']])if(source.endsWith(suffix))return '\0stage-'+id},load(id){
  if(id==='\0stage-nativeChat')return 'export const createProjectChatNativeDesignRepository=()=>globalThis.__stageSendTest.design.props.repository'
  if(id==='\0stage-designStudio')return 'export const createDesignWorkshopScope=()=>globalThis.__stageSendTest.design.props.studio;export const designWorkshop={forOrganization:createDesignWorkshopScope}'
  if(id==='\0stage-native')return 'export const websiteNative=new Proxy({},{get:(_,k)=>(...a)=>globalThis.__stageSendTest.design.props.native[k](...a)})'
  if(id==='\0stage-pages')return 'export const projectWebsitePages=new Proxy({},{get:(_,k)=>(...a)=>globalThis.__stageSendTest.design.props.pages[k](...a)})'
  if(id==='\0stage-relations')return 'export const createProjectAssetRelationsRepository=()=>globalThis.__stageSendTest.design.props.relations'
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
 await until(()=>button('Continue Design'));await click('Continue Design');await until(()=>button('Load exact Design sources'));await click('Load exact Design sources');await until(()=>button('Draft layout request in Chat'))
 await click('Draft layout request in Chat');assert.match(named('Message').value,/Keep this normal Chat draft/);assert.match(named('Message').value,/Suggest a responsive layout/);assert.equal(fixture.data.counters.run,0)
 await click('Review Design draft');await until(()=>button('Confirm Design save'));await click('Confirm Design save');await until(()=>env.container.textContent.includes('Design draft saved'))
 assert.equal(design.state.calls.filter(c=>c.name==='website-native-design').length,1);assert.equal(fixture.data.counters.run,0)
 await until(()=>!named('Message').disabled);await act(async()=>props(named('Chat composer')).onSubmit({preventDefault(){}}));await until(()=>fixture.data.counters.run===1)
 assert.match(captured[0].message,/Keep this normal Chat draft/);assert.equal(design.state.calls.filter(c=>c.name==='website-native-design').length,1)
})