import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {createRequire} from 'node:module'
import React,{act} from 'react'
import {createRoot} from 'react-dom/client'
import {transformSync} from 'esbuild'
import {mountedEnvironment,elements} from './testSupport/designVideoDom.js'
import * as setup from './projectSetup.js'
import {SERVICE_CATALOGUE,SERVICE_CADENCES} from './serviceCatalogue.js'
const native=createRequire(import.meta.url),props=n=>n?.[Object.keys(n).find(k=>k.startsWith('__reactProps$'))],id=n=>`c0000000-0000-4000-8000-${String(n).padStart(12,'0')}`
async function mount(t){
 const env=mountedEnvironment(),keys=['window','document','sessionStorage','IS_REACT_ACT_ENVIRONMENT'],old=Object.fromEntries(keys.map(k=>[k,globalThis[k]])),storage=new Map();Object.assign(globalThis,{window:env.window,document:env.document,IS_REACT_ACT_ENVIRONMENT:true,sessionStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)}})
 const leaf=SERVICE_CATALOGUE.find(x=>x.name==='New website copy'),calls=[],state={lost:false,receipt:null},scope={organization_id:id(1),project_id:id(2)},snapshot={...scope,token:'a'.repeat(32),leaves:[leaf],catalog:[leaf],scopes:[],can_manage:true,state:null}
 const repository={snapshot:async()=>structuredClone(snapshot),delivery:{review:async(_s,p)=>{calls.push('review');return {data:{...scope,engagement_id:id(3),review_sha256:'b'.repeat(64),draft:{groups:[{bucket_key:'website',kind:'website',cadence:'once',contributions:[{name:leaf.name,quantity:p.items[0].quantity}],stages:[{key:'copy',label:'Page copy',depends_on:[]}],group_options:[],binding_locked:false}],unmapped:[]}}}},apply:async(_s,_r,requestId)=>{calls.push('apply');state.receipt={atomic:true,request_id:requestId};if(state.lost)throw Error('Response lost');return state.receipt},recover:async()=>{calls.push('recover');return state.receipt||{status:'not_applied'}}}}
 const code=transformSync(readFileSync(new URL('../components/ProjectSetupPanel.jsx',import.meta.url),'utf8'),{loader:'jsx',format:'cjs',jsxFactory:'React.createElement'}).code,module={exports:{}};new Function('require','module','exports','React',code)(n=>n.endsWith('.css')?{}:n.includes('ProjectDeliveryPlanPanel')?{default:()=>null,__esModule:true}:n.includes('projectSetupRepository')?{projectSetupRepository:repository}:n.includes('projectSetup.js')?setup:n.includes('serviceCatalogue')?{SERVICE_CADENCES}:native(n),module,module.exports,React)
 const root=createRoot(env.container),Component=module.exports.default,controller=new AbortController();await act(async()=>{root.render(React.createElement(Component,{organizationId:id(1),projectId:id(2),actorId:id(4),repository,signal:controller.signal}));await new Promise(r=>setTimeout(r,0))})
 t.after(async()=>{await act(async()=>root.unmount());Object.assign(globalThis,old)})
 const button=name=>elements(env.container,'button').find(n=>n.textContent===name),click=name=>act(async()=>props(button(name)).onClick()),change=(tag,predicate,value)=>act(async()=>props(elements(env.container,tag).find(predicate)).onChange({target:{value,checked:true}}))
 async function review(){await change('input',n=>props(n)?.type==='checkbox'&&!['website','marketing'].includes(props(n)?.value),true);await change('input',n=>props(n)?.['aria-label']==='Quantity New website copy','2');await click('Review combined setup')}
 return {env,calls,state,storage,button,click,change,review}
}
test('mounted combined setup review performs no write and applies both domains once',async t=>{const ui=await mount(t);await ui.review();assert.deepEqual(ui.calls,['review']);assert.equal(ui.button('Apply setup').disabled,false);await ui.click('Apply setup');assert.deepEqual(ui.calls,['review','apply']);assert.match(ui.env.container.textContent,/saved together/);assert.equal(ui.storage.size,0)})
test('mounted uncertain save retains original request and recovery never reapplies',async t=>{const ui=await mount(t);await ui.review();ui.state.lost=true;await ui.click('Apply setup');assert.equal(ui.storage.size,1);assert.equal(Boolean(props(ui.button('Review combined setup')).disabled),true);await ui.click('Recover original setup save');assert.deepEqual(ui.calls,['review','apply','recover']);assert.equal(ui.storage.size,0)})
test('stale retained Apply handler cannot save an edited proposal',async t=>{const ui=await mount(t);await ui.review();const retained=props(ui.button('Apply setup')).onClick;await ui.change('input',n=>props(n)?.['aria-label']==='Quantity New website copy','3');await act(async()=>retained());assert.equal(ui.calls.includes('apply'),false)})
