import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {act,createElement} from 'react'
import {createRoot} from 'react-dom/client'
import {createServer} from 'vite'
import {mountedEnvironment} from './testSupport/n1bMountedDom.js'
import {createDirectChatFixture,createProjectNavigationPreviewFixture,actor,organizationId,allowlist} from '../../tools/direct-chat-fixture.js'
import {projectStagePlan} from './projectStagePlan.js'
const descendants=n=>[n,...n.childNodes.flatMap(descendants)]
const props=n=>n?.[Object.keys(n).find(k=>k.startsWith('__reactProps$'))]
const flush=()=>act(async()=>{await new Promise(r=>setTimeout(r,0))})
async function until(condition){for(let i=0;i<150;i++){if(condition())return;await act(async()=>{await new Promise(r=>setTimeout(r,20))})}assert.ok(condition(),'Mounted condition became available')}
test('stage and attachment conflict keeps draft, references and original context until an explicit choice',async t=>{
 const env=mountedEnvironment(),storage=new Map(),signal=new AbortController().signal
 const values={document:env.document,window:env.window,Event:env.window.Event,Node:env.window.Node,HTMLElement:env.window.HTMLElement,IS_REACT_ACT_ENVIRONMENT:true,sessionStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)}}
 const previous=Object.fromEntries(Object.keys(values).map(k=>[k,globalThis[k]]));Object.assign(globalThis,values)
 const fixture=createDirectChatFixture({surface:'project',state:'populated'}),workspace=createProjectNavigationPreviewFixture(fixture.scope.project_id).workspace
 const native=JSON.parse(readFileSync(new URL('../../tools/project-stage-native-fixture.json',import.meta.url),'utf8'))
 const exact={organization_id:organizationId,project_id:workspace.project.id,engagement_id:workspace.engagement.id}
 const header={...native.header,...exact},unit={...native.unit,...exact},plan=projectStagePlan(header,[unit]),track=plan.tracks.find(r=>r.id==='website'),stage=track.stages.find(r=>r.id==='website.content')
 const captured=[];const append=fixture.chat.appendContextHumanMessage;fixture.chat.appendContextHumanMessage=async input=>{captured.push(structuredClone(input));return append(input)}
 globalThis.__stageSendTest={fixture,actor,allowlist,organization:{activeOrganizationId:organizationId,activeMembership:{role:'system_owner'},scopeRevision:1,requestSignal:signal,handleOrganizationAccessError(){}},rpc:async name=>({data:name==='read_project_stage_plan'?header:unit,error:null})}
 const vite=await createServer({server:{middlewareMode:true},appType:'custom',logLevel:'silent',plugins:[{name:'stage-send-mounted',enforce:'pre',resolveId(source){for(const [suffix,id] of [['WorkspaceDialog.jsx','dialog'],['ProjectSetupPanel.jsx','setup'],['ProjectContentJourney.jsx','sibling'],['ProjectWebsiteExecution.jsx','sibling'],['/lib/supabase.js','client'],['AuthContext.jsx','auth'],['OrganizationContext.jsx','org'],['departmentChatRepository.js','chat'],['contextChatRunnerRepository.js','runner'],['integrationRepository.js','models'],['ProjectAttachmentPanel.jsx','attachments']])if(source.endsWith(suffix))return '\0stage-'+id},load(id){
  if(id==='\0stage-dialog')return "import {createElement} from 'react'; export default function Dialog({title,children,onClose}){return createElement('section',null,children,createElement('button',{onClick:onClose},'Close '+title))}"
  if(id==='\0stage-setup')return "import {createElement} from 'react'; export default function Setup(props){return createElement('p',{'aria-label':'Setup for '+props.projectId},'Review project setup')}"
  if(id==='\0stage-sibling')return 'export default function Sibling(){return null}'
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
 const render=async selection=>{await act(async()=>root.render(createElement(Panel,{directSend:true,contextKind:'project_team',projectId:workspace.project.id,projectJourney:workspace,initialConversation:fixture.data.rows[0],projectStageSelection:selection})));await flush()}
 t.after(async()=>{await act(async()=>root.unmount());await vite.close();Object.assign(globalThis,previous);delete globalThis.__stageSendTest})
 await render();await until(()=>named('Message')&&!named('Message').disabled)
 await act(async()=>props(named('Message')).onChange({target:{value:'Preserve this stage request'}}))
 await click('Open pipeline and work details');await until(()=>button('Open project setup'))
 await click('Open project setup');await until(()=>named('Setup for '+workspace.project.id))
 assert.equal(named('Message').value,'Preserve this stage request');assert.equal(captured.length,0);assert.equal(fixture.data.counters.run,0)
 await click('Close Review project setup')
 await render({selectionId:'explicit-stage-choice',track,stage});await until(()=>button('Remove stage context'))
 await click('Attach files');await until(()=>button('Select fixture reference'));await click('Select fixture reference');await click('Close fixture attachments')
 await act(async()=>props(named('Chat composer')).onSubmit({preventDefault(){}}));await flush();await until(()=>env.container.textContent.includes('Choose stage context or attached references'))
 assert.equal(named('Message').value,'Preserve this stage request');assert.equal(captured.length,0);assert.equal(fixture.data.counters.run,0)
 assert.deepEqual(__stageSendTest.documents.selectedIds,['dd000000-0000-4000-8000-000000000001']);assert.ok(button('Remove stage context'))
 await click('Remove stage context');await act(async()=>props(named('Chat composer')).onSubmit({preventDefault(){}}));await until(()=>captured.length===1&&fixture.data.counters.run===1)
 assert.equal(captured[0].message,'Preserve this stage request');assert.deepEqual(captured[0].project_document_ids,['dd000000-0000-4000-8000-000000000001']);assert.equal('project_stage_context'in captured[0],false)
 await until(()=>!named('Message').disabled)
 await act(async()=>props(named('Message')).onChange({target:{value:'Use the stage after explicit deselection'}}))
 await render({selectionId:'choose-stage-again',track,stage});await until(()=>button('Remove stage context'))
 await click('Attach files');await until(()=>button('Deselect fixture reference'));await click('Deselect fixture reference');await click('Close fixture attachments')
 await act(async()=>props(named('Chat composer')).onSubmit({preventDefault(){}}));await until(()=>captured.length===2&&fixture.data.counters.run===2)
 assert.equal(captured[1].message,'Use the stage after explicit deselection');assert.equal('project_document_ids'in captured[1],false);assert.equal('design_attachment_ids'in captured[1],false);assert.deepEqual(captured[1].project_stage_context,{selection:stage.context,output_version_ids:[]})

})
