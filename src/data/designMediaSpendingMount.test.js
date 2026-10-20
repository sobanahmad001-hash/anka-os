import test from 'node:test'
import assert from 'node:assert/strict'
import {act,createElement} from 'react'
import {createRoot} from 'react-dom/client'
import {createServer} from 'vite'
import {mountedEnvironment} from './testSupport/n1bMountedDom.js'
const all=n=>[n,...n.childNodes.flatMap(all)],props=n=>n?.[Object.keys(n).find(k=>k.startsWith('__reactProps$'))]
test('spending is explicit read-only, single-flight and discards revoked or switched organization responses',async t=>{
 const env=mountedEnvironment(),before={};for(const [key,value] of Object.entries({document:env.document,window:env.window,Event:env.window.Event,Node:env.window.Node,HTMLElement:env.window.HTMLElement,IS_REACT_ACT_ENVIRONMENT:true})){before[key]=globalThis[key];globalThis[key]=value}
 const vite=await createServer({server:{middlewareMode:true},appType:'custom',logLevel:'silent',plugins:[{name:'offline-spending',enforce:'pre',resolveId(source){if(source.endsWith('/lib/supabase.js'))return '/offline-spending'},load(id){if(id==='/offline-spending')return 'export const supabase = null'}}]}),root=createRoot(env.container);t.after(async()=>{await act(async()=>root.unmount());await vite.close();Object.assign(globalThis,before)})
 const {default:Panel,mediaSpendUSD}=await vite.ssrLoadModule('/src/components/DesignMediaSpendingSettings.jsx');assert.equal(mediaSpendUSD('12345678901234567'),'$12,345,678,901.234567');let resolve,calls=[];const client={functions:{invoke:(name,options)=>{calls.push(options.body);return new Promise(r=>resolve=r)}}},abort=new AbortController();
 const render=(org,canManage=true)=>act(async()=>root.render(createElement(Panel,{organizationId:org,canManage,requestSignal:abort.signal,client})));const button=()=>all(env.container).find(n=>n.tagName==='BUTTON');
 await render('one',false);assert.equal(env.container.textContent,'');await render('one');assert.equal(calls.length,0);let pending;await act(async()=>{pending=props(button()).onClick()});await act(async()=>props(button()).onClick());assert.equal(calls.length,1);assert.equal(calls[0].action,'get_media_spending');
 await render('two');await act(async()=>{resolve({data:{data:{organization_id:'one',month:calls[0].month,scope:'design_media_reservations',groups:[]}},error:null});await pending});assert.doesNotMatch(env.container.textContent,/recorded requests/);
 await act(async()=>{pending=props(button()).onClick()});await act(async()=>abort.abort());await act(async()=>{resolve({data:{data:{organization_id:'two',month:calls[1].month,scope:'design_media_reservations',groups:[]}},error:null});await pending});assert.match(env.container.textContent,/access changed/);assert.equal(props(button()).disabled,true);assert.equal(calls.length,2);
})
