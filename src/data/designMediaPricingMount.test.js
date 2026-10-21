import test from 'node:test'
import assert from 'node:assert/strict'
import {act,createElement} from 'react'
import {createRoot} from 'react-dom/client'
import {createServer} from 'vite'
import {mountedEnvironment} from './testSupport/n1bMountedDom.js'
const all=n=>[n,...n.childNodes.flatMap(all)],props=n=>n?.[Object.keys(n).find(k=>k.startsWith('__reactProps$'))]
test('admin pricing hides ordinary controls, prevents duplicate pending writes, retains failed drafts and clears on abort',async t=>{
 const env=mountedEnvironment(),before={};for(const [key,value] of Object.entries({document:env.document,window:env.window,Event:env.window.Event,Node:env.window.Node,HTMLElement:env.window.HTMLElement,IS_REACT_ACT_ENVIRONMENT:true})){before[key]=globalThis[key];globalThis[key]=value}
 const vite=await createServer({server:{middlewareMode:true},appType:'custom',logLevel:'silent',plugins:[{name:'offline-pricing',enforce:'pre',resolveId(source){if(source.endsWith('/lib/supabase.js'))return '/offline-pricing'},load(id){if(id==='/offline-pricing')return 'export const supabase = null'}}]}),root=createRoot(env.container);t.after(async()=>{await act(async()=>root.unmount());await vite.close();Object.assign(globalThis,before)})
 const {default:Panel}=await vite.ssrLoadModule('/src/components/DesignMediaPricingSettings.jsx');let resolve,calls=[];const client={functions:{invoke:(name,options)=>{calls.push(options.body);return new Promise(r=>{resolve=r})}}},abort=new AbortController()
 const render=(canManage,organizationId='org')=>act(async()=>root.render(createElement(Panel,{organizationId,canManage,requestSignal:abort.signal,client})))
 await render(false);assert.equal(env.container.textContent,'');assert.equal(calls.length,0);await render(true)
 const inputs=()=>all(env.container).filter(n=>n.tagName==='INPUT');const set=(i,value)=>act(async()=>props(inputs()[i]).onChange({target:{value}}))
 await set(0,'exact-model');await set(1,'0.60');await set(2,'https://open.higgsfield.ai/pricing');await set(3,'2026-10-15T12:00:00Z');await set(4,'2026-10-15T13:00:00Z')
 const form=()=>all(env.container).find(n=>n.tagName==='FORM');let pending;await act(async()=>{pending=props(form()).onSubmit({preventDefault(){}})});await act(async()=>{props(form()).onSubmit({preventDefault(){}})});assert.equal(calls.length,1);assert.equal(calls[0].organization_id,'org');assert.equal(calls[0].unit_max_charge_microusd,600000)
 await act(async()=>{resolve({error:Error('transport'),data:null});await pending});assert.match(env.container.textContent,/Save was not confirmed/);assert.equal(props(inputs()[0]).value,'exact-model');const save=all(env.container).find(n=>n.tagName==='BUTTON'&&n.textContent==='Save reviewed rate');assert.equal(props(save).disabled,true)
 await act(async()=>props(inputs().find(n=>props(n)?.type==='checkbox')).onChange({target:{checked:true}}));await render(true,'other-org');assert.equal(props(inputs().find(n=>props(n)?.type==='checkbox')).checked,false);assert.equal(props(inputs().at(-1)).value,'');assert.equal(calls.length,1);
 await act(async()=>abort.abort());assert.equal(Boolean(form()),false);assert.match(env.container.textContent,/Organization access changed/)
})



test('estimated mode holds uncertain writes until readback and never sends generation',async t=>{
 const env=mountedEnvironment(),before={};for(const [key,value] of Object.entries({document:env.document,window:env.window,Event:env.window.Event,Node:env.window.Node,HTMLElement:env.window.HTMLElement,IS_REACT_ACT_ENVIRONMENT:true})){before[key]=globalThis[key];globalThis[key]=value}
 const vite=await createServer({server:{middlewareMode:true},appType:'custom',logLevel:'silent'}),root=createRoot(env.container);t.after(async()=>{await act(async()=>root.unmount());await vite.close();Object.assign(globalThis,before)})
 const {default:Panel}=await vite.ssrLoadModule('/src/components/DesignEstimatedTestSettings.jsx');const calls=[];let fail=true;const client={functions:{invoke:async(name,options)=>{calls.push(options.body);return fail?{data:null,error:Error('uncertain')}:{data:{data:{organization_id:'org',state:'estimated',limit_microusd:10000000,consumed_microusd:3000000,overage_microusd:4000000,valid_until:new Date(Date.now()+3600000).toISOString()}},error:null}}}};
 await act(async()=>root.render(createElement(Panel,{organizationId:'org',client})));const nodes=()=>all(env.container),button=label=>nodes().find(n=>n.tagName==='BUTTON'&&n.textContent===label);
 await act(async()=>props(nodes().find(n=>props(n)?.type==='checkbox')).onChange({target:{checked:true}}));await act(async()=>props(nodes().find(n=>n.tagName==='INPUT'&&props(n)?.type!=='checkbox')).onChange({target:{value:new Date(Date.now()+3600000).toISOString()}}));await act(async()=>props(button('Enable estimated testing')).onClick());assert.equal(calls[0].action,'set_estimated_test_mode');assert.equal(calls[0].accept_estimated_price_risk,true);assert.equal(props(button('Enable estimated testing')).disabled,true);fail=false;await act(async()=>props(button('Refresh allowance')).onClick());assert.equal(calls[1].action,'read_estimated_test_mode');assert.equal(Boolean(props(button('Enable estimated testing')).disabled),false);assert.match(env.container.textContent,/Recorded overages: \$4.000000/)
})
