import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {act,createElement} from 'react'
import {createRoot} from 'react-dom/client'
import {createServer} from 'vite'
import {mountedEnvironment} from './testSupport/n1bMountedDom.js'
import {createDirectChatFixture,createProjectNavigationPreviewFixture,actor,organizationId,allowlist} from '../../tools/direct-chat-fixture.js'
import {directChatRecoveryKey} from './directChatRecovery.js'
import {writeDirectChatDraft} from './directChatDraft.js'
import {projectStagePlan} from './projectStagePlan.js'
const descendants=n=>[n,...n.childNodes.flatMap(descendants)]
const props=n=>n?.[Object.keys(n).find(k=>k.startsWith('__reactProps$'))]
const flush=()=>act(async()=>{await new Promise(r=>setTimeout(r,0))})
async function until(condition){for(let i=0;i<150;i++){if(condition())return;await act(async()=>{await new Promise(r=>setTimeout(r,20))})}assert.ok(condition(),'Mounted condition became available')}
for(const mode of ['first mount','arrival while restoring','scope cancellation']) test('explicit stage event: '+mode,async t=>{
 const env=mountedEnvironment(),storage=new Map(),signal=new AbortController().signal
 const values={document:env.document,window:env.window,Event:env.window.Event,Node:env.window.Node,HTMLElement:env.window.HTMLElement,IS_REACT_ACT_ENVIRONMENT:true,sessionStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)}}
 const previous=Object.fromEntries(Object.keys(values).map(k=>[k,globalThis[k]]));Object.assign(globalThis,values)
 const fixture=createDirectChatFixture({surface:'project',state:'populated'}),workspace=createProjectNavigationPreviewFixture(fixture.scope.project_id).workspace
 const native=JSON.parse(readFileSync(new URL('../../tools/project-stage-native-fixture.json',import.meta.url),'utf8'))
 const exact={organization_id:organizationId,project_id:workspace.project.id,engagement_id:workspace.engagement.id}
 const header={...native.header,...exact},unit={...native.unit,...exact},plan=projectStagePlan(header,[unit]),track=plan.tracks.find(r=>r.id==='website'),stage=track.stages.find(r=>r.id==='website.content')
 let releaseRead;const readGate=new Promise(resolve=>{releaseRead=resolve}),read=fixture.chat.getContextConversation
 fixture.chat.getContextConversation=async input=>{await readGate;return read(input)}
 const draftKey=directChatRecoveryKey(actor,organizationId,'project_team',workspace.project.id,'')
 writeDirectChatDraft(draftKey,{new_conversation_id:crypto.randomUUID(),conversation_id:fixture.data.rows[0].id,text:'Keep my unsent draft',attempt:null},values.sessionStorage)
 const acknowledged=[]
 const captured=[];const append=fixture.chat.appendContextHumanMessage;fixture.chat.appendContextHumanMessage=async input=>{captured.push(structuredClone(input));return append(input)}
 globalThis.__stageSendTest={fixture,actor,allowlist,organization:{activeOrganizationId:organizationId,activeMembership:{role:'system_owner'},scopeRevision:1,requestSignal:signal,handleOrganizationAccessError(){}},rpc:async name=>({data:name==='read_project_stage_plan'?header:unit,error:null})}
 const vite=await createServer({server:{middlewareMode:true},appType:'custom',logLevel:'silent',plugins:[{name:'stage-send-mounted',enforce:'pre',resolveId(source){for(const [suffix,id] of [['/lib/supabase.js','client'],['AuthContext.jsx','auth'],['OrganizationContext.jsx','org'],['departmentChatRepository.js','chat'],['contextChatRunnerRepository.js','runner'],['integrationRepository.js','models'],['ProjectAttachmentPanel.jsx','attachments']])if(source.endsWith(suffix))return '\0stage-'+id},load(id){
  if(id==='\0stage-client')return 'export const supabase={rpc:(...a)=>globalThis.__stageSendTest.rpc(...a),functions:{invoke(){throw Error("Unexpected live importer")}}}'
  if(id==='\0stage-auth')return 'export const useAuth=()=>({user:{id:globalThis.__stageSendTest.actor}})'
  if(id==='\0stage-org')return 'export const useOrganization=()=>globalThis.__stageSendTest.organization'
  if(id==='\0stage-chat')return 'export const departmentChat=new Proxy({},{get:(_,k)=>(...a)=>globalThis.__stageSendTest.fixture.chat[k](...a)})'
  if(id==='\0stage-runner')return 'export const contextChatRunner=new Proxy({},{get:(_,k)=>(...a)=>globalThis.__stageSendTest.fixture.runner[k](...a)})'
  if(id==='\0stage-models')return 'export const integrations={listModelAllowlist:async()=>globalThis.__stageSendTest.allowlist}'
  if(id==='\0stage-attachments')return `import {createElement} from 'react';export default function AttachmentProbe({documentProps,onClose}){globalThis.__stageSendTest.documents=documentProps;return createElement('div',null,createElement('button',{onClick:()=>documentProps.onSelection(['dd000000-0000-4000-8000-000000000001'])},'Select fixture reference'),createElement('button',{onClick:()=>documentProps.onSelection([])},'Deselect fixture reference'),createElement('button',{onClick:onClose},'Close fixture attachments'))}`
 }}]})
 const {default:Panel}=await vite.ssrLoadModule('/src/components/ContextConversationPanel.jsx'),root=createRoot(env.container)
 const all=()=>descendants(env.container),named=name=>all().find(n=>props(n)?.['aria-label']===name),button=name=>all().find(n=>n.tagName==='BUTTON'&&(props(n)?.['aria-label']||n.textContent)===name)
 const click=async name=>{assert.ok(button(name),name);await act(async()=>props(button(name)).onClick?.({preventDefault(){}}));await flush()}
 const render=async selection=>{await act(async()=>root.render(createElement(Panel,{directSend:true,contextKind:'project_team',projectId:workspace.project.id,projectJourney:workspace,initialConversation:fixture.data.rows[0],projectStageSelection:selection,onProjectStageSelectionConsumed:id=>acknowledged.push(id)})));await flush()}
 t.after(async()=>{await act(async()=>root.unmount());await vite.close();Object.assign(globalThis,previous);delete globalThis.__stageSendTest})
 const selection={selectionId:'first-mount-stage',track,stage}
 await render(mode==='arrival while restoring'?undefined:selection)
 await until(()=>named('Message')?.disabled)
 if(mode==='arrival while restoring')await render(selection)
 assert.equal(button('Remove stage context'),undefined,'selection waits for restore')
 assert.equal([...storage.keys()].filter(k=>k.includes(':stage:')).length,0)
 if(mode==='scope cancellation'){
   workspace.engagement={...workspace.engagement,id:'aa000000-0000-4000-8000-000000000099'}
   await render(selection)
 }
 await act(async()=>releaseRead());await until(()=>named('Message')&&!named('Message').disabled)
 if(mode==='scope cancellation'){
   assert.equal(button('Remove stage context'),undefined)
   assert.equal([...storage.keys()].filter(k=>k.includes(':stage:')).length,0)
   assert.deepEqual(acknowledged,[selection.selectionId])
   assert.equal(named('Message').value,'Keep my unsent draft')
   return
 }
 await until(()=>button('Remove stage context'))
 assert.equal(named('Message').value,'Keep my unsent draft')
 assert.deepEqual(acknowledged,[selection.selectionId])
 const saved=[...storage.entries()].filter(([k])=>k.includes(':stage:'))
 assert.equal(saved.length,1);assert.ok(saved[0][0].endsWith(fixture.data.rows[0].id))
 assert.deepEqual(JSON.parse(saved[0][1]).context,stage.context)
 assert.equal(captured.length,0);assert.equal(fixture.data.counters.run,0)
 await click('Remove stage context');await render(selection);await flush()
 assert.equal(button('Remove stage context'),undefined,'consumed event does not reselect after removal')
 const newButton=all().find(n=>n.tagName==='BUTTON'&&/New chat|New conversation/.test(n.textContent))
 assert.ok(newButton,'new conversation control')
 await act(async()=>props(newButton).onClick());await render(selection);await flush()
 assert.equal(button('Remove stage context'),undefined,'consumed event does not follow conversation switching')
 await act(async()=>root.render(null))
 await render();await until(()=>named('Message')&&!named('Message').disabled)
 assert.equal(button('Remove stage context'),undefined,'acknowledged parent event is absent on remount')
 assert.deepEqual(acknowledged,[selection.selectionId])
})
