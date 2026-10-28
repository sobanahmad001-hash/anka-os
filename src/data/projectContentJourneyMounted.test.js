import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {createRequire} from 'node:module'
import React,{act} from 'react'
import {createRoot} from 'react-dom/client'
import {transformSync} from 'esbuild'
import {mountedEnvironment,elements} from './testSupport/designVideoDom.js'
const native=createRequire(import.meta.url),props=n=>n?.[Object.keys(n).find(k=>k.startsWith('__reactProps$'))],id=n=>`d0000000-0000-4000-8000-${String(n).padStart(12,'0')}`
async function mount(t,{tracked=false}={}){
 const env=mountedEnvironment(),keys=['window','document','sessionStorage','IS_REACT_ACT_ENVIRONMENT'],old=Object.fromEntries(keys.map(k=>[k,globalThis[k]])),storage=new Map();Object.assign(globalThis,{window:env.window,document:env.document,IS_REACT_ACT_ENVIRONMENT:true,sessionStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)}})
 const org=id(1),project=id(2),eng=id(3),actor=id(4),conversation=id(5),source=id(6),work=id(7),second=id(8),artifact=id(9),v1=id(10),v2=id(11),service=id(12)
 const works=[work,second].map((w,i)=>({id:w,organization_id:org,project_id:project,engagement_id:eng,department_id:'content',title:'Copy '+i,status:'not_started',row_version:1,linked_artifact_id:artifact,linked_artifact_version_id:v1}))
 const workspace={project:{id:project,organization_id:org},engagement:{id:eng,organization_id:org,project_id:project},activeServices:[{id:service,organization_id:org,engagement_id:eng,status:'active',service_catalog:{department_id:'content',name:'Copy'}}],engagementWorkItems:works,projectTasks:[],workshopArtifacts:[{id:artifact,organization_id:org,project_id:project,engagement_id:eng,artifact_type:'content',title:'Output',versions:[v1,v2].map((id,i)=>({id,artifact_id:artifact,organization_id:org,version_number:i+1}))}]}
 const calls=[],links=tracked?[{conversation_id:conversation,work_item_id:work,source_message_id:source}]:[],state={lost:false}
 const repo={list:async()=>structuredClone(links),bind:async(...a)=>{calls.push(['bind',...a]);return {}},handoffs:async()=>[],recoverHandoff:async()=>{calls.push(['recover']);return {request_id:id(20)}}}
 const studio={organizationId:org,load:async(_e,n)=>({engagement:workspace.engagement,navigationWorkRecord:works.find(w=>w.id===n.workRecord.id),artifacts:workspace.workshopArtifacts,versions:workspace.workshopArtifacts[0].versions}),confirmContentHandoff:async input=>{calls.push(['handoff',input]);if(state.lost)throw Error('Response lost');return {request_id:input.p_request_id}}}
 const commands={actor:async()=>actor,apply:async(...a)=>{calls.push(['apply',...a]);return {}},recover:async()=>({status:'not_applied'})}
 const code=transformSync(readFileSync(new URL('../components/ProjectContentJourney.jsx',import.meta.url),'utf8'),{loader:'jsx',format:'cjs',jsxFactory:'React.createElement'}).code,module={exports:{}}
 new Function('require','module','exports','React',code)(n=>n.endsWith('.css')?{}:n.includes('/lib/supabase')?{supabase:{}}:n.includes('contentStudioRepository')?{contentStudio:{}}:n.includes('ProjectWorkActions')||n.includes('ContentChatWriterPane')?{default:()=>null,__esModule:true}:n.includes('ContentLibraryPanel')?{default:({repository,initialVersionId})=>React.createElement('button',{onClick:()=>repository.confirmContentHandoff({p_request_id:id(20),p_artifact_version_id:initialVersionId})},'Confirm test handoff'),__esModule:true}:n==='react-router-dom'?{Link:({children})=>React.createElement('a',null,children)}:native(n),module,module.exports,React)
 const root=createRoot(env.container);await act(async()=>{root.render(React.createElement(module.exports.default,{workspace,conversationId:conversation,actorId:actor,messages:[{id:source,role:'user',author_id:actor,conversation_id:conversation,body:'Write Content'}],owner:true,repository:repo,studio,workCommands:commands}));await new Promise(r=>setTimeout(r,0))})
 t.after(async()=>{await act(async()=>root.unmount());Object.assign(globalThis,old)})
 const button=text=>elements(env.container,'button').find(n=>n.textContent===text),click=text=>act(async()=>props(button(text)).onClick()),change=(label,value)=>act(async()=>props(elements(env.container,'label').find(n=>n.textContent.startsWith(label)).childNodes.find(n=>n.tagName==='SELECT')).onChange({target:{value}}))
 return {env,calls,storage,state,work,second,source,v1,v2,service,button,click,change}
}
test('a retained origin-link handler cannot bind work after the current selection changes',async t=>{
 const u=await mount(t);await u.change('Content work in this conversation',u.work);await u.change('Saved human request',u.source);const retained=props(u.button('Track this work in this conversation')).onClick;await u.change('Content work in this conversation',u.second);await act(async()=>retained());assert.equal(u.calls.length,0)
})
test('a retained exact-version Apply cannot bind a later selection using an old review',async t=>{
 const u=await mount(t,{tracked:true});await u.change('Exact Content version',u.v2);await u.change('Exact active Content service',u.service);await u.click('Review exact result binding');const retained=props(u.button('Apply exact result binding')).onClick;await u.change('Exact Content version',u.v1);await act(async()=>retained());assert.equal(u.calls.length,0)
})
test('lost handoff keeps its original request and recovers without another confirmation write',async t=>{
 const u=await mount(t,{tracked:true});u.state.lost=true;await u.click('Review & explicit Design handoff');await act(async()=>{await props(u.button('Confirm test handoff')).onClick().catch(()=>{})});assert.equal(u.storage.size,1);await u.click('Recover original journey action');assert.deepEqual(u.calls.map(x=>x[0]),['handoff','recover']);assert.equal(u.storage.size,0)
})
