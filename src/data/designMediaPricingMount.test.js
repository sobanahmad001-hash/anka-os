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
 const render=canManage=>act(async()=>root.render(createElement(Panel,{organizationId:'org',canManage,requestSignal:abort.signal,client})))
 await render(false);assert.equal(env.container.textContent,'');assert.equal(calls.length,0);await render(true)
 const inputs=()=>all(env.container).filter(n=>n.tagName==='INPUT');const set=(i,value)=>act(async()=>props(inputs()[i]).onChange({target:{value}}))
 await set(0,'exact-model');await set(1,'0.60');await set(2,'https://open.higgsfield.ai/pricing');await set(3,'2026-10-15T12:00:00Z');await set(4,'2026-10-15T13:00:00Z')
 const form=()=>all(env.container).find(n=>n.tagName==='FORM');let pending;await act(async()=>{pending=props(form()).onSubmit({preventDefault(){}})});await act(async()=>{props(form()).onSubmit({preventDefault(){}})});assert.equal(calls.length,1);assert.equal(calls[0].organization_id,'org');assert.equal(calls[0].unit_max_charge_microusd,600000)
 await act(async()=>{resolve({error:Error('transport'),data:null});await pending});assert.match(env.container.textContent,/Save was not confirmed/);assert.equal(props(inputs()[0]).value,'exact-model');const save=all(env.container).find(n=>n.tagName==='BUTTON'&&n.textContent==='Save reviewed rate');assert.equal(props(save).disabled,true)
 await act(async()=>abort.abort());assert.equal(Boolean(form()),false);assert.match(env.container.textContent,/Organization access changed/)
})

