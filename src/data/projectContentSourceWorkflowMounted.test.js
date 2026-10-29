import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {createRequire} from 'node:module'
import React,{act} from 'react'
import {createRoot} from 'react-dom/client'
import {transformSync} from 'esbuild'
import {mountedEnvironment,elements} from './testSupport/designVideoDom.js'
const native=createRequire(import.meta.url),props=n=>n?.[Object.keys(n).find(k=>k.startsWith('__reactProps$'))]
async function mount(t){
 const env=mountedEnvironment(),keys=['window','document','sessionStorage','IS_REACT_ACT_ENVIRONMENT'],old=Object.fromEntries(keys.map(k=>[k,globalThis[k]])),storage=new Map()
 Object.assign(globalThis,{window:env.window,document:env.document,IS_REACT_ACT_ENVIRONMENT:true,sessionStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)}})
 const calls=[],writer=[],scope={organization_id:'org',project_id:'project',engagement_id:'eng'},state={hold:false,finish:null}
 let messages=[{id:'old',role:'user',author_id:'actor',conversation_id:'chat',sequence:1,body:'Old provisional brief'}, {id:'request',role:'user',author_id:'actor',conversation_id:'chat',sequence:4,body:'Use the reviewed homepage brief and copy'}, {id:'brief',role:'assistant',conversation_id:'chat',sequence:3,body:'Reviewed homepage brief\n  Exact audience and six sections.  '}, {id:'draft',role:'assistant',conversation_id:'chat',sequence:5,body:'  Exact homepage copy\n\nSix sections preserved.\n  '}]
 const original=structuredClone(messages),workspace={project:{id:'project',organization_id:'org'},engagement:{id:'eng',organization_id:'org',project_id:'project'},activeServices:[{id:'service',organization_id:'org',engagement_id:'eng',status:'active',service_catalog:{department_id:'content',name:'Website copy'}}],engagementWorkItems:[],projectTasks:[],workshopArtifacts:[]}
 const repo={list:async()=>[],handoffs:async()=>[]},studio={organizationId:'org',load:async(_e,n)=>({engagement:workspace.engagement,navigationWorkRecord:workspace.engagementWorkItems.find(w=>w.id===n.workRecord.id),artifacts:[],versions:[]})}
 const commands={actor:async()=> 'actor',apply:async(s,id,command)=>{calls.push({s,id,command});if(state.hold)await new Promise(r=>{state.finish=r});const row={id:'new-work',...scope,department_id:'content',title:command.title,status:'not_started',row_version:1};workspace.engagementWorkItems.push(row);return {work_item:row}},recover:async()=>({status:'not_applied'})}
 const cache=new Map()
 function load(name){if(cache.has(name))return cache.get(name);const module={exports:{}},code=transformSync(readFileSync(new URL('../components/'+name+'.jsx',import.meta.url),'utf8'),{loader:'jsx',format:'cjs',jsxFactory:'React.createElement'}).code
  new Function('require','module','exports','React',code)(n=>n.endsWith('.css')?{}:n.includes('/lib/supabase')?{supabase:{}}:n.includes('contentStudioRepository')?{contentStudio:{}}:n.includes('ContentChatWriterPane')?{default:p=>{writer.push(p);return React.createElement('p',null,'Canonical Writer selected')},__esModule:true}:n.includes('ContentLibraryPanel')?{default:()=>null,__esModule:true}:n.endsWith('.jsx')?load(n.split('/').at(-1).replace('.jsx','')):n==='react-router-dom'?{Link:({children})=>React.createElement('a',null,children)}:native(n),module,module.exports,React);cache.set(name,module.exports);return module.exports}
 const Component=load('ProjectContentJourney').default,root=createRoot(env.container)
 const input={workspace,conversationId:'chat',actorId:'actor',owner:true,repository:repo,studio,workCommands:commands,onChanged:async()=>{input.workspace={...workspace};await render()}}
 async function render(){await act(async()=>{root.render(React.createElement(Component,{...input,messages}));await new Promise(r=>setTimeout(r,0))})}
 await render();t.after(async()=>{await act(async()=>root.unmount());Object.assign(globalThis,old)})
 const button=text=>elements(env.container,'button').find(n=>n.textContent===text),click=text=>act(async()=>props(button(text)).onClick()),change=(label,value)=>act(async()=>props(elements(env.container,'label').find(n=>n.textContent.startsWith(label)).childNodes.find(n=>n.tagName==='SELECT')).onChange({target:{value}}))
 async function select(){await change('Your saved request','request');await change('Reviewed brief message','brief');await change('Exact draft response','draft');await click('Review selected brief and draft')}
 async function confirm(){await act(async()=>props(elements(env.container,'input').find(n=>props(n).type==='checkbox')).onChange({target:{checked:true}}));await click('Use selected sources for Content work')}
 return {env,storage,calls,writer,state,input,original,render,button,click,change,select,confirm,setMessages:m=>{messages=m},messages:()=>messages}
}
test('exact Chat selections require unchecked review then explicit Work Apply and reach the canonical Writer without re-entry',async t=>{
 const u=await mount(t);assert.equal(u.calls.length,0);assert.equal(props(u.button('Review selected brief and draft')).disabled,true)
 await u.select();assert.equal(props(u.button('Use selected sources for Content work')).disabled,true)
 assert.deepEqual(elements(u.env.container,'pre').map(n=>n.textContent),[u.original[1].body,u.original[2].body,u.original[3].body])
 await u.confirm();assert.equal(u.calls.length,0);assert.equal(props(elements(u.env.container,'textarea')[0]).value,u.original[2].body)
 await u.change('Exact active service','service');await u.click('Review new work request');assert.equal(u.calls.length,0)
 await u.click('Apply reviewed work action');assert.equal(u.calls.length,1);assert.equal(u.calls[0].command.description,u.original[2].body);assert.equal(u.calls[0].s.actorId,'actor')
 assert.equal(u.writer.at(-1).reviewedChatSources.draft.body,u.original[3].body);assert.equal(u.writer.at(-1).reviewedChatSources.brief.id,'brief');assert.equal(u.writer.at(-1).chatSourcesCurrent(),true)
 assert.deepEqual(u.messages(),u.original);assert.equal(u.storage.size,0)
})
test('retained source confirmation rejects changed messages and a later reply never silently replaces the selected draft',async t=>{
 const u=await mount(t);await u.select();await act(async()=>props(elements(u.env.container,'input').find(n=>props(n).type==='checkbox')).onChange({target:{checked:true}}));const retained=props(u.button('Use selected sources for Content work')).onClick
 u.setMessages(u.messages().map(m=>m.id==='brief'?{...m,body:'Changed brief'}:m));await u.render();await act(async()=>retained());assert.match(u.env.container.textContent,/Selected messages changed/);assert.equal(u.calls.length,0)
 await u.select();await u.confirm();u.setMessages([...u.messages(),{id:'later',role:'assistant',conversation_id:'chat',sequence:9,body:'Unreviewed later response'}]);await u.render();await u.change('Exact active service','service');await u.click('Review new work request');await u.click('Apply reviewed work action');assert.equal(u.writer.at(-1).reviewedChatSources.draft.id,'draft')
})
test('source mutation during an admitted Work save prevents automatic attachment of the stale draft to its returned result',async t=>{
 const u=await mount(t);await u.select();await u.confirm();await u.change('Exact active service','service');await u.click('Review new work request');u.state.hold=true
 let flight;await act(async()=>{flight=props(u.button('Apply reviewed work action')).onClick();await new Promise(r=>setTimeout(r,0))});assert.equal(u.calls.length,1)
 u.setMessages(u.messages().map(m=>m.id==='draft'?{...m,body:'Changed draft during save'}:m));await u.render();await act(async()=>{u.state.finish();await flight});assert.equal(u.writer.length,0);assert.match(u.env.container.textContent,/A selected source changed/);assert.equal(u.storage.size,0)
})
