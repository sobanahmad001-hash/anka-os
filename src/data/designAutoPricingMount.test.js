import test from 'node:test'
import assert from 'node:assert/strict'
import {act,createElement} from 'react'
import {createRoot} from 'react-dom/client'
import {createServer} from 'vite'
import {mountedEnvironment} from './testSupport/n1bMountedDom.js'
const all=n=>[n,...n.childNodes.flatMap(all)],props=n=>n?.[Object.keys(n).find(k=>k.startsWith('__reactProps$'))]
async function fixture(t){
 const env=mountedEnvironment(),before={},storage=new Map();for(const [key,value] of Object.entries({document:env.document,window:env.window,Event:env.window.Event,Node:env.window.Node,HTMLElement:env.window.HTMLElement,IS_REACT_ACT_ENVIRONMENT:true,sessionStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)}})){before[key]=globalThis[key];globalThis[key]=value}
 const vite=await createServer({server:{middlewareMode:true},appType:'custom',logLevel:'silent'}),root=createRoot(env.container);t.after(async()=>{await act(async()=>root.unmount());await vite.close();Object.assign(globalThis,before)});
 const {default:Panel}=await vite.ssrLoadModule('/src/components/DesignUnifiedMediaComposer.jsx');
 const context={kind:'private',id:'chat'},selection={organization_id:'org',context,creative_brief_version_id:'v1',connector_connection_id:'connector',provider:'openai',model_id:'gpt-image-1',settings:{size:'1024x1024',quality:'medium',background:'opaque',output_format:'png'},output_count:1,input_versions:[],prompt_checksum:'a'.repeat(64)};
 const state={unit:1000000,quotes:[],submits:[],quote:null,reply:request=>({request,quote:{id:'quote-'+state.quotes.length,request,currency:'USD',unit_max_charge_microusd:state.unit,total_max_charge_microusd:state.unit*request.output_count,request_checksum:'b'.repeat(64),verified_at:new Date(Date.now()-1000).toISOString(),valid_until:new Date(Date.now()+60000).toISOString()}})};
 const studio={listMediaChoices:async()=>({choices:[{id:'choice',label:'Model',kind:'image',selection}]}),quoteMediaRequest:async({selection:r})=>{state.quotes.push(r);const result=state.quote?await state.quote(r):state.reply(r);state.lastQuote=result.quote;return result},generateMediaRequest:async body=>{state.submits.push(body);return {operation_key:body.operation_key,status:'outcome_unknown'}}};
 const base={studio,mode:'image',organizationId:'org',userId:'actor',context,brief:{id:'brief',frozen_version_id:'v1'}};
 const render=async extra=>{await act(async()=>root.render(createElement(Panel,{...base,...extra})));const d=all(env.container).find(n=>n.tagName==='DIALOG');if(d){d.showModal=()=>{d.open=true};d.close=()=>{d.open=false}}};
 const button=text=>all(env.container).find(n=>n.tagName==='BUTTON'&&n.textContent===text),click=text=>act(async()=>props(button(text)).onClick()),field=name=>all(env.container).find(n=>props(n)?.['aria-label']===name),change=(name,value)=>act(async()=>props(field(name)).onChange({target:{value}}));
 await render();await click('Load available models');await change('Model','choice');return {state,env,button,click,change,render,storage};
}
test('Generate auto-quotes once and multiple outputs require exact total confirmation',async t=>{
 const f=await fixture(t);assert.equal(f.button('Refresh price'),undefined);assert.equal(f.state.quotes.length,0);await f.change('Outputs','4');assert.equal(f.state.submits.length,0);await f.click('Generate');assert.equal(f.state.quotes.length,1);assert.equal(f.state.submits.length,0);assert.match(f.env.container.textContent,/\$4.00/);await f.click('Confirm and generate');assert.equal(f.state.quotes.length,1);assert.equal(f.state.submits.length,1);assert.equal(f.state.submits[0].acceptance.total_max_charge_microusd,4000000);assert.equal(f.state.submits[0].acceptance.confirm_above_threshold,true)
})
test('expired high-price confirmation cannot refresh and charge silently',async t=>{
 const f=await fixture(t);f.state.unit=3000000;await f.click('Generate');f.state.lastQuote.valid_until=new Date(Date.now()-1).toISOString();await f.click('Confirm and generate');assert.equal(f.state.submits.length,0);assert.equal(f.state.quotes.length,1);assert.match(f.env.container.textContent,/price expired/);await f.click('Generate');assert.equal(f.state.quotes.length,2);assert.equal(f.state.submits.length,0)
})
test('in-flight quote is single-flight and changing the brief discards its result',async t=>{
 const f=await fixture(t);let resolve;f.state.quote=r=>new Promise(done=>{resolve=()=>done(f.state.reply(r))});let pending;await act(async()=>{pending=props(f.button('Generate')).onClick()});await act(async()=>props(f.button('Generate')).onClick());assert.equal(f.state.quotes.length,1);await f.render({brief:{id:'brief',frozen_version_id:'v2'}});await act(async()=>{resolve();await pending});assert.equal(f.state.submits.length,0);assert.equal(f.storage.size,0)
})
test('missing rate blocks without reserving a recovery identity and offers admin setup only to admins',async t=>{
 const f=await fixture(t);f.state.quote=async()=>{throw Object.assign(Error('Admin pricing setup required'),{code:'MEDIA_RATE_UNAVAILABLE'})};await f.click('Generate');assert.equal(f.state.submits.length,0);assert.equal(f.storage.size,0);assert.match(f.env.container.textContent,/Ask an organization administrator/);assert.equal(all(f.env.container).some(n=>n.tagName==='A'),false);await f.render({canManagePricing:true});assert.ok(all(f.env.container).some(n=>n.tagName==='A'&&props(n).href==='/sphere/settings#design-media-pricing'))
})
test('changing output count invalidates the prior expensive confirmation',async t=>{
 const f=await fixture(t);await f.change('Outputs','4');await f.click('Generate');await f.change('Outputs','1');await f.click('Confirm and generate');assert.equal(f.state.submits.length,0);await f.click('Generate');assert.equal(f.state.submits.length,1);assert.equal(f.state.submits[0].selection.output_count,1);assert.equal(f.state.submits[0].acceptance.confirm_above_threshold,undefined)
})


test('estimated quote requires risk consent, shows honest price and binds acceptance',async t=>{
 const f=await fixture(t);const original=f.state.reply;f.state.reply=request=>{const result=original(request);result.quote={...result.quote,price_basis:'estimated',reviewed_at:result.quote.verified_at,verified_at:null};return result};await f.click('Generate');assert.equal(f.state.submits.length,0);assert.equal(f.storage.size,0);assert.match(f.env.container.textContent,/Actual charges can exceed/);const checkbox=all(all(f.env.container).find(n=>n.tagName==='LABEL'&&n.textContent.startsWith('Allow reference-price estimates'))).find(n=>props(n)?.type==='checkbox');await act(async()=>props(checkbox).onChange({target:{checked:true}}));await f.click('Generate');assert.equal(f.state.submits.length,1);assert.equal(f.state.submits[0].acceptance.accept_estimated_price_risk,true);assert.match(f.env.container.textContent,/Estimated total/)
})
test('estimated expensive quote cannot generate without above-threshold confirmation',async t=>{
 const f=await fixture(t);f.state.unit=3000000;const original=f.state.reply;f.state.reply=request=>{const result=original(request);result.quote={...result.quote,price_basis:'estimated',reviewed_at:result.quote.verified_at,verified_at:null};return result};const checkbox=all(all(f.env.container).find(n=>n.tagName==='LABEL'&&n.textContent.startsWith('Allow reference-price estimates'))).find(n=>props(n)?.type==='checkbox');await act(async()=>props(checkbox).onChange({target:{checked:true}}));await f.click('Generate');assert.equal(f.state.submits.length,0);assert.match(f.env.container.textContent,/actual charges may be higher/);await f.click('Confirm and generate');assert.equal(f.state.submits.length,1);assert.equal(f.state.submits[0].acceptance.confirm_above_threshold,true)
})
