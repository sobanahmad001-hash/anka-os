import assert from 'node:assert/strict'
import test from 'node:test'
import {act,createElement} from 'react'
import {createRoot} from 'react-dom/client'
import {createServer} from 'vite'
import {mountedEnvironment,elements} from './testSupport/designVideoDom.js'
const org='8a6d2c5e-2c99-4ec7-a92f-6d1bd877eb25',actor='a0000000-0000-4000-8000-000000000002'
const props=node=>node?.[Object.keys(node).find(key=>key.startsWith('__reactProps$'))]
const snapshot={published:false,review_sha256:'a'.repeat(64),services:[{id:'leaf',name:'New website copy',unit:'page',recurrence:'per_batch'}],plan:{execution:{p_steps:[{key:'copy',label:'Prepare scoped website page copy',kind:'human',department_id:'content',depends_on:[],stage_contract:{output_label:'Page copy',required_inputs:[],reuse_allowed:false}}]}}}
async function mount(t,{role='system_owner',lost=false,storage=new Map(),rejectCode,storageFails=false}={}){
 const server=await createServer({server:{middlewareMode:true},appType:'custom',logLevel:'silent',plugins:[{name:'website-starter-test',enforce:'pre',resolveId(source){if(source.endsWith('/websiteStarter.js'))return '\0starter'},load(id){if(id==='\0starter')return 'export const websiteStarter={}'}}]})
 t.after(()=>server.close())
 const {default:Panel}=await server.ssrLoadModule('/src/components/WebsiteStarterPanel.jsx'),env=mountedEnvironment(),names=['document','window','Event','Node','HTMLElement','IS_REACT_ACT_ENVIRONMENT','sessionStorage'],previous=Object.fromEntries(names.map(name=>[name,globalThis[name]]))
 let uuidCalls=0;const session={getItem:key=>storage.get(key)||null,setItem:(key,value)=>{if(storageFails)throw new Error('Storage unavailable');storage.set(key,value)},removeItem:key=>storage.delete(key)}
 Object.assign(globalThis,{document:env.document,window:env.window,Event:env.window.Event,Node:env.window.Node,HTMLElement:env.window.HTMLElement,IS_REACT_ACT_ENVIRONMENT:true,sessionStorage:session})
 const oldUUID=crypto.randomUUID;crypto.randomUUID=()=>{uuidCalls++;return '31cb2407-5970-4071-a04c-a8c02c4a7d73'}
 let receipt=null,gate,release;const reads=[],writes=[],repository={review:async id=>{reads.push(id);if(gate)await gate;return receipt ? {published:true,receipt}:structuredClone(snapshot)},publish:async(id,command)=>{writes.push({id,command});if(gate)await gate;if(rejectCode)throw Object.assign(new Error('Changed'),{code:rejectCode});receipt={request_id:command.requestId,result:{name:'Website core'}};if(lost)throw new Error('Lost response');return receipt.result}}
 const controller=new AbortController(),root=createRoot(env.container);let selected=org
 const render=()=>act(async()=>root.render(createElement(Panel,{key:selected,organizationId:selected,actorId:actor,membership:{organizationId:selected,role},signal:controller.signal,repository})))
 t.after(async()=>{await act(async()=>root.unmount());crypto.randomUUID=oldUUID;Object.assign(globalThis,previous)})
 await render()
 const button=name=>elements(env.container,'button').find(node=>node.textContent===name)
 const click=name=>act(async()=>{assert.ok(button(name),name);assert.notEqual(props(button(name)).disabled,true);await props(button(name)).onClick()})
 return {env,reads,writes,storage,button,click,controller,uuidCalls:()=>uuidCalls,setGate(){gate=new Promise(done=>{release=done})},release:()=>act(async()=>release()),switchOrg:async()=>{selected='a0000000-0000-4000-8000-000000000003';await render()}}
}
test('review is read-only; explicit publish uses the reviewed exact organization',async t=>{
 const ui=await mount(t);assert.equal(ui.reads.length,0);await ui.click('Review Website plan');assert.equal(ui.writes.length,0);assert.match(ui.env.container.textContent,/Page copy/);await ui.click('Publish plan');assert.equal(ui.writes.length,1);assert.equal(ui.writes[0].id,org);assert.equal(ui.writes[0].command.hash,snapshot.review_sha256);assert.equal(ui.storage.size,0);assert.match(ui.env.container.textContent,/Website starter published/)
})
test('ordinary department manager sees no admin publication action',async t=>{const ui=await mount(t,{role:'department_manager'});assert.equal(ui.button('Review Website plan'),undefined);assert.equal(ui.reads.length,0)})
test('synchronous duplicate Publish submits one immutable request',async t=>{
 const ui=await mount(t);await ui.click('Review Website plan');ui.setGate();const handler=props(ui.button('Publish plan')).onClick;await act(async()=>{void handler();void handler()});assert.equal(ui.writes.length,1);assert.equal(ui.uuidCalls(),1);await ui.release()
})
test('lost response recovers original receipt with a read, without a duplicate write',async t=>{
 const ui=await mount(t,{lost:true});await ui.click('Review Website plan');await ui.click('Publish plan');assert.equal(ui.storage.size,1);await ui.click('Check publication status');assert.equal(ui.writes.length,1);assert.equal(ui.storage.size,0);assert.match(ui.env.container.textContent,/Website starter published/)
})
test('unresolved stored command blocks a new identity and permits only original retry',async t=>{
 const original={requestId:'31cb2407-5970-4071-a04c-a8c02c4a7d73',hash:'b'.repeat(64),reason:'Original review'},storage=new Map([[`anka:website-starter:${org}:${actor}:v1`,JSON.stringify(original)]])
 const ui=await mount(t,{storage});await ui.click('Check publication status');await ui.click('Retry original publish');assert.deepEqual(ui.writes[0].command,original);assert.equal(ui.uuidCalls(),0)
})
test('definitive server review conflict releases identity and requires fresh review',async t=>{
 const ui=await mount(t,{rejectCode:'40001'});await ui.click('Review Website plan');await ui.click('Publish plan');assert.equal(ui.storage.size,0);assert.equal(ui.button('Publish plan'),undefined);assert.match(ui.env.container.textContent,/Review the plan again/)
})
test('storage failure prevents untracked dispatch',async t=>{const ui=await mount(t,{storageFails:true});await ui.click('Review Website plan');await ui.click('Publish plan');assert.equal(ui.writes.length,0);assert.match(ui.env.container.textContent,/Storage unavailable/)})
test('late review cannot populate another selected organization',async t=>{
 const ui=await mount(t);ui.setGate();await act(async()=>{void props(ui.button('Review Website plan')).onClick()});await ui.switchOrg();await ui.release();assert.equal(ui.button('Publish plan'),undefined);assert.doesNotMatch(ui.env.container.textContent,/Page copy/)
})
test('aborted organization context prevents an existing Publish handler from writing',async t=>{
 const ui=await mount(t);await ui.click('Review Website plan');ui.controller.abort();await ui.click('Publish plan');assert.equal(ui.writes.length,0)
})
