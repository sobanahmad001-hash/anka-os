import test from 'node:test'
import assert from 'node:assert/strict'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { createServer } from 'vite'
import { mountedEnvironment } from './testSupport/n1bMountedDom.js'
const nodes=node=>[node,...node.childNodes.flatMap(nodes)]
const find=(env,tag,text='')=>nodes(env.container).find(node=>node.tagName===tag && node.textContent.includes(text))
const flush=()=>act(async()=>{await new Promise(resolve=>setTimeout(resolve,0))})
const change=(env,node,value)=>act(async()=>{node.value=value;node.dispatchEvent(new env.window.Event('change'))})
const click=(env,node)=>act(async()=>node.dispatchEvent(new env.window.Event('click')))
const snapshot=(version='version',overrides={})=>({organization_id:'org',project_id:'project',plan_version_id:version,can_manage:true,approved_version:true,token:'exact-token',
 snapshot:{payload:{version:{id:version,organization_id:'org',plan_id:'plan'},templates:[{template_key:'one',title:'Exact assigned work',department_id:'design',default_assignee_id:'bob',start_offset_days:0,due_offset_days:2}]},history:[]},...overrides})
const list={organization_id:'org',project_id:'project',can_manage:true,versions:[{id:'version',title:'Plan',version_number:1},{id:'next',title:'Plan',version_number:2}]}
async function mount(t,client){
 const env=mountedEnvironment()
 const previous={document:globalThis.document,window:globalThis.window,IS_REACT_ACT_ENVIRONMENT:globalThis.IS_REACT_ACT_ENVIRONMENT}
 Object.assign(globalThis,{document:env.document,window:env.window,IS_REACT_ACT_ENVIRONMENT:true})
 const server=await createServer({server:{middlewareMode:true},appType:'custom',logLevel:'silent',
 plugins:[{name:'offline-delegation',enforce:'pre',resolveId(source){if(source.endsWith('/lib/supabase.js'))return '/offline-delegation'},load(id){if(id==='/offline-delegation')return 'export const supabase = null'}}]})
 const {default:Panel}=await server.ssrLoadModule('/src/components/RecurringAssignmentDelegation.jsx')
 const root=createRoot(env.container)
 t.after(async()=>{await act(async()=>root.unmount());await server.close();Object.assign(globalThis,previous)})
 await act(async()=>root.render(createElement(Panel,{project:{id:'project',organization_id:'org'},client})));await flush()
 return env
}
test('delegation UI requires exact payload confirmation, ignores duplicate submits and does not retry stale writes',async t=>{
 const calls=[];let finish
 const env=await mount(t,{rpc(name,args){
  calls.push({name,args})
  if(name.startsWith('change_'))return new Promise(resolve=>{finish=resolve})
  return Promise.resolve({data:args.p_plan_version_id?snapshot(args.p_plan_version_id):list})
 }})
 await change(env,find(env,'SELECT'),'version');await flush()
 assert.match(env.container.textContent,/Exact assigned work/)
 const approve=find(env,'BUTTON','Approve exact assignments')
 assert.equal(approve.disabled,true)
 const check=find(env,'INPUT')
 await act(async()=>{check.checked=true;check.dispatchEvent(new env.window.Event('click'))})
 assert.equal(approve.disabled,false)
 await act(async()=>{approve.dispatchEvent(new env.window.Event('click'));approve.dispatchEvent(new env.window.Event('click'))})
 assert.equal(calls.filter(call=>call.name.startsWith('change_')).length,1)
 const mutation=calls.find(call=>call.name.startsWith('change_')).args
 assert.equal(mutation.p_plan_version_id,'version');assert.equal(mutation.p_expected_token,'exact-token');assert.equal(mutation.p_enabled,true)
 assert.equal(find(env,'SELECT').disabled,true)
 await act(async()=>finish({error:{code:'40001',message:'stale'}}));await flush()
 assert.match(env.container.textContent,/changed elsewhere/)
 assert.equal(calls.filter(call=>call.name.startsWith('change_')).length,1)
 assert.equal(find(env,'BUTTON','Approve exact assignments').disabled,true)
})
test('delegation UI never grants controls from plan ownership or viewer state',async t=>{
 const env=await mount(t,{rpc(_name,args){return Promise.resolve({data:args.p_plan_version_id?snapshot('version',{can_manage:false}):list})}})
 await change(env,find(env,'SELECT'),'version');await flush()
 assert.equal(find(env,'BUTTON','Approve exact assignments').disabled,true)
 assert.equal(find(env,'INPUT').disabled,true)
 assert.match(env.container.textContent,/Only current same-project PMs/)
})
test('delegation UI withdraws only on explicit submit and preserves scope/request identity',async t=>{
 let mutation
 const active=snapshot();active.snapshot.history=[{id:'approval',status:'active',approved_by:'alice',approved_at:'today'}]
 const env=await mount(t,{rpc(name,args){
  if(name.startsWith('change_')){mutation=args;return Promise.resolve({data:{organization_id:'org',project_id:'project',plan_version_id:'version',request_id:args.p_request_id}})}
  return Promise.resolve({data:args.p_plan_version_id?active:list})
 }})
 await change(env,find(env,'SELECT'),'version');await flush()
 assert.equal(mutation,undefined)
 await click(env,find(env,'BUTTON','Withdraw assignment delegation'));await flush()
 assert.equal(mutation.p_enabled,false);assert.ok(mutation.p_request_id)
 assert.match(env.container.textContent,/rechecked at execution/)
})
test('delegation UI ignores delayed old-version data and wrong-scope snapshots',async t=>{
 let finish
 const env=await mount(t,{rpc(_name,args){
  if(!args.p_plan_version_id)return Promise.resolve({data:list})
  if(args.p_plan_version_id==='version')return new Promise(resolve=>{finish=resolve})
  return Promise.resolve({data:snapshot('next',{project_id:'foreign'})})
 }})
 await change(env,find(env,'SELECT'),'version')
 await change(env,find(env,'SELECT'),'next');await flush()
 await act(async()=>finish({data:snapshot()}));await flush()
 assert.match(env.container.textContent,/scope mismatch/)
 assert.equal(find(env,'BUTTON','Approve exact assignments'),undefined)
})
