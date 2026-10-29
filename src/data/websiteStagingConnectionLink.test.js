import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {createRequire} from 'node:module'
import React,{act} from 'react'
import {createRoot} from 'react-dom/client'
import {transformSync} from 'esbuild'
import {mountedEnvironment,elements} from './testSupport/designVideoDom.js'
import {createWebsiteStagingRepository} from './websiteStagingRepository.js'
const requireNative=createRequire(import.meta.url),props=n=>n?.[Object.keys(n).find(k=>k.startsWith('__reactProps$'))],id=n=>'e0000000-0000-4000-8000-'+String(n).padStart(12,'0')
const scope={organizationId:id(1),projectId:id(2),engagementId:id(3),actorId:id(8)},row={organization_id:id(1),project_id:id(2),engagement_id:id(3)}
const connection={id:id(4),display_name:'Verified staging',base_url:'https://stage.example.test',revision:'2026-10-29T11:00:00Z',project_linked:false}
async function mount(t){
 const env=mountedEnvironment(),names=['window','document','sessionStorage','IS_REACT_ACT_ENVIRONMENT'],old=Object.fromEntries(names.map(k=>[k,globalThis[k]])),storage=new Map(),calls=[],locks=[],state={lost:false,missing:false,refreshFailure:false,answer:null,storageFailure:false}
 Object.assign(globalThis,{window:env.window,document:env.document,IS_REACT_ACT_ENVIRONMENT:true,sessionStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>{if(state.storageFailure)throw Error('Synthetic storage unavailable');storage.set(k,v)},removeItem:k=>storage.delete(k)}})
 const repository={linkWorkspace:async()=>{if(state.refreshFailure&&state.answer)throw Error('Synthetic refresh failed');return {...row,connections:[{...connection,project_linked:Boolean(state.answer)}]}},linkSave:async(_scope,input)=>{calls.push({kind:'save',...input});state.answer={...row,connection_id:connection.id,request_id:input.requestId,created_by:scope.actorId,department_id:'development',base_url:connection.base_url};if(state.lost)throw Error('Synthetic response lost');return state.answer},linkRecover:async(_scope,requestId)=>{calls.push({kind:'recover',requestId});return state.missing?null:state.answer}}
 const code=transformSync(readFileSync(new URL('../components/WebsiteStagingConnectionLink.jsx',import.meta.url),'utf8'),{loader:'jsx',format:'cjs',jsxFactory:'React.createElement'}).code,module={exports:{}}
 new Function('require','module','exports','React',code)(requireNative,module,module.exports,React)
 const root=createRoot(env.container),controller=new AbortController(),Component=module.exports.default,base={scope,canLink:true,disabled:false,signal:controller.signal,repository,onLinked:()=>calls.push({kind:'linked'}),onLockChange:value=>locks.push(value)}
 const render=async changes=>act(async()=>{root.render(React.createElement(Component,{...base,...changes}));await new Promise(r=>setTimeout(r,0))})
 await render({});t.after(async()=>{await act(async()=>root.unmount());Object.assign(globalThis,old)})
 const button=name=>elements(env.container,'button').find(n=>n.textContent===name),click=name=>act(async()=>props(button(name)).onClick()),choose=value=>act(async()=>props(elements(env.container,'select')[0]).onChange({target:{value}})),confirm=()=>act(async()=>props(elements(env.container,'input').find(n=>props(n).type==='checkbox')).onChange({target:{checked:true}})),prepare=async()=>{await choose(connection.id);await click('Review project link')}
 return {env,calls,locks,state,storage,controller,button,click,choose,confirm,prepare,render}
}
test('owner reviews and explicitly confirms one project link without connection retest',async t=>{
 const ui=await mount(t);await ui.prepare();await ui.click('Save reviewed project link');assert.equal(ui.calls.length,0);assert.equal(ui.locks.at(-1),false)
 await ui.confirm();await ui.click('Save reviewed project link');assert.equal(ui.calls.filter(x=>x.kind==='save').length,1);assert.equal(ui.calls.filter(x=>x.kind==='linked').length,1);assert.equal(ui.storage.size,0)
})
test('lost response retains original UUID and recovers read-only without a second save',async t=>{
 const ui=await mount(t);await ui.prepare();await ui.confirm();ui.state.lost=true;const retained=props(ui.button('Save reviewed project link')).onClick;await ui.click('Save reviewed project link');assert.equal(ui.storage.size,1);await act(async()=>retained());assert.equal(ui.calls.filter(x=>x.kind==='save').length,1)
 ui.state.missing=true;await ui.click('Recover original project link');assert.equal(ui.storage.size,1)
 ui.state.missing=false;await ui.click('Recover original project link');assert.equal(ui.storage.size,0);assert.equal(ui.calls.filter(x=>x.kind==='save').length,1);assert.equal(ui.calls.filter(x=>x.kind==='recover')[0].requestId,ui.calls.find(x=>x.kind==='save').requestId)
})
test('stale save handler cannot acquire changed role or cross an actor boundary',async t=>{
 const ui=await mount(t);await ui.prepare();await ui.confirm();const retained=props(ui.button('Save reviewed project link')).onClick
 await ui.render({canLink:false});await act(async()=>retained());assert.equal(ui.calls.length,0)
 await ui.render({scope:{...scope,actorId:id(9)}});await act(async()=>retained());assert.equal(ui.calls.length,0)
})
test('failed recovery storage prevents save and releases the navigation lock',async t=>{
 const ui=await mount(t);await ui.prepare();await ui.confirm();ui.state.storageFailure=true;await ui.click('Save reviewed project link');assert.equal(ui.calls.length,0);assert.equal(ui.locks.at(-1),false)
})
test('post-save refresh failure retains committed status and does not resend',async t=>{
 const ui=await mount(t);await ui.prepare();await ui.confirm();ui.state.refreshFailure=true;await ui.click('Save reviewed project link');assert.equal(ui.storage.size,0);assert.equal(ui.calls.filter(x=>x.kind==='save').length,1);assert.ok(ui.env.container.textContent.includes('Project link saved.'))
})
test('repository pins actual scope actor and original request without calling the gateway',async()=>{
 const calls=[],client={rpc:async(name,args)=>{calls.push({name,args});return {data:{...row,connection_id:connection.id,request_id:id(10),created_by:scope.actorId,department_id:'development',base_url:connection.base_url},error:null}},functions:{invoke:()=>{throw Error('Unexpected gateway call')}}},repo=createWebsiteStagingRepository(client)
 await assert.rejects(repo.linkSave(scope,{connection,confirmed:false,requestId:id(10)}));assert.equal(calls.length,0)
 await repo.linkSave(scope,{connection,confirmed:true,requestId:id(10)});await repo.linkRecover(scope,id(10));assert.deepEqual(calls.map(x=>x.name),['link_website_staging_connection','get_website_staging_connection_link']);assert.equal(calls[0].args.p_actor_id,undefined)
})
