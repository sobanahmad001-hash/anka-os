import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {createRequire} from 'node:module'
import React,{act} from 'react'
import {createRoot} from 'react-dom/client'
import {transformSync} from 'esbuild'
import {mountedEnvironment,elements} from './testSupport/designVideoDom.js'
const requireNative=createRequire(import.meta.url),props=n=>n?.[Object.keys(n).find(k=>k.startsWith('__reactProps$'))],id=n=>'b0000000-0000-4000-8000-'+String(n).padStart(12,'0')
async function mount(t,canBuild=true){
 const env=mountedEnvironment(),names=['window','document','sessionStorage','IS_REACT_ACT_ENVIRONMENT'],old=Object.fromEntries(names.map(k=>[k,globalThis[k]])),storage=new Map();Object.assign(globalThis,{window:env.window,document:env.document,IS_REACT_ACT_ENVIRONMENT:true,sessionStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)}})
 const row={organization_id:id(1),project_id:id(2),engagement_id:id(3)},calls=[],state={answer:null,lost:false,gate:null},review={...row,design_id:id(4),design_version:1,stale_sources:[],review_sha256:'a'.repeat(64),manifest:{scope:{...row,page_key:'home'},content:{title:'Saved native page'},layout:{template:'home'},sources:{content:{version_id:id(9),checksum:'b'.repeat(64)}}}}
 const repository={workspace:async(_scope,o={})=>{calls.push({kind:'read',options:o});return {...row,designs:[{design_id:id(4),page_key:'home',title:'Saved native page',version_number:1}],jobs:state.answer?[state.answer]:[],design_total:1,job_total:state.answer?1:0}},review:async()=>{calls.push({kind:'review'});if(state.gate)await state.gate;return review},build:async(_scope,input)=>{calls.push({kind:'build',input});state.answer={...row,id:id(5),website_page_design_id:id(4),request_id:input.requestId,page_id:id(6),status:'complete',requested_at:'synthetic'};if(state.lost)throw Error('Response lost');return state.answer}}
 const code=transformSync(readFileSync(new URL('../components/WebsiteBlockBuildPanel.jsx',import.meta.url),'utf8'),{loader:'jsx',format:'cjs',jsxFactory:'React.createElement'}).code,module={exports:{}};new Function('require','module','exports','React',code)(name=>name.includes('websiteBlocks')?{websiteBlocks:repository}:requireNative(name),module,module.exports,React)
 const root=createRoot(env.container),controller=new AbortController(),Component=module.exports.default
 await act(async()=>{root.render(React.createElement(Component,{organizationId:id(1),projectId:id(2),engagementId:id(3),actorId:id(7),canBuild,signal:controller.signal,repository}));await new Promise(r=>setTimeout(r,0))})
 t.after(async()=>{await act(async()=>root.unmount());Object.assign(globalThis,old)})
 const button=name=>elements(env.container,'button').find(n=>n.textContent===name),click=name=>act(async()=>props(button(name)).onClick()),choose=value=>act(async()=>props(elements(env.container,'select')[0]).onChange({target:{value}}))
 return {env,calls,state,storage,button,click,choose,controller}
}
test('actual native build manual selection and review are read-only; stale Build cannot dispatch',async t=>{
 const ui=await mount(t);await ui.choose(id(4));await ui.click('Review native package');assert.equal(ui.calls.filter(c=>c.kind==='build').length,0)
 const stale=props(ui.button('Build private review package')).onClick;await ui.choose('');assert.equal(ui.button('Build private review package'),undefined);await act(async()=>stale());assert.equal(ui.calls.filter(c=>c.kind==='build').length,0)
})
test('uncertain native build locks new requests and recovers original read-only',async t=>{
 const ui=await mount(t);await ui.choose(id(4));await ui.click('Review native package');ui.state.lost=true;await ui.click('Build private review package');assert.equal(ui.storage.size,1);assert.equal(ui.calls.filter(c=>c.kind==='build').length,1);await ui.click('Recover original native build');assert.equal(ui.storage.size,0);assert.equal(ui.calls.filter(c=>c.kind==='build').length,1);assert.match(ui.env.container.textContent,/recovered without another write/)
})
test('retained native Build handler cannot cross aborted project context',async t=>{
 const ui=await mount(t);await ui.choose(id(4));await ui.click('Review native package');const retained=props(ui.button('Build private review package')).onClick;ui.controller.abort();await act(async()=>retained());assert.equal(ui.calls.filter(c=>c.kind==='build').length,0)
})
test('read-only native input review never gains build authority',async t=>{
 const ui=await mount(t,false);await ui.choose(id(4));await ui.click('Review native package');const handler=props(ui.button('Build private review package')).onClick;await act(async()=>handler());assert.equal(ui.calls.filter(c=>c.kind==='build').length,0)
})
