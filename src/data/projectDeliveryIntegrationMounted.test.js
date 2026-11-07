import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {createRequire} from 'node:module'
import React,{act} from 'react'
import {createRoot} from 'react-dom/client'
import {transformSync} from 'esbuild'
import {mountedEnvironment,elements} from './testSupport/designVideoDom.js'
import * as setup from './projectSetup.js'
import * as serviceLineDraft from '../components/serviceLineDraft.js'
import {SERVICE_CATALOGUE,SERVICE_CADENCES} from './serviceCatalogue.js'
const native=createRequire(import.meta.url),props=n=>n?.[Object.keys(n).find(k=>k.startsWith('__reactProps$'))],id=n=>`c0000000-0000-4000-8000-${String(n).padStart(12,'0')}`
async function mount(t){
 const env=mountedEnvironment(),keys=['window','document','sessionStorage','IS_REACT_ACT_ENVIRONMENT'],old=Object.fromEntries(keys.map(k=>[k,globalThis[k]])),storage=new Map();Object.assign(globalThis,{window:env.window,document:env.document,IS_REACT_ACT_ENVIRONMENT:true,sessionStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)}})
 const leaf=SERVICE_CATALOGUE.find(x=>x.name==='New website copy'),calls=[],state={lost:false,receipt:null,choices:[]},scope={organization_id:id(1),project_id:id(2)},snapshot={...scope,token:'a'.repeat(32),leaves:[leaf],catalog:[leaf],scopes:[],can_manage:true,state:null}
 const repository={snapshot:async()=>structuredClone(snapshot),delivery:{review:async(_s,p,options)=>{calls.push('review');state.lastReviewed=p;state.choices.push(options.choices);return {data:{...scope,engagement_id:id(3),review_sha256:'b'.repeat(64),draft:{groups:[{bucket_key:'website',kind:'website',cadence:'once',contributions:[{name:leaf.name,quantity:p.items[0].quantity}],stages:[{key:'copy',label:'Page copy',depends_on:[]}],group_options:[{id:'retained-pipeline',name:'Original pipeline history'}],binding_locked:false}],unmapped:[]}}}},apply:async(_s,_r,requestId)=>{calls.push('apply');state.receipt={atomic:true,request_id:requestId};if(state.lost)throw Error('Response lost');return state.receipt},recover:async()=>{calls.push('recover');return state.receipt||{status:'not_applied'}}}}
 const fields={exports:{}};new Function('module','exports','React',transformSync(readFileSync(new URL('../components/ServiceLineFields.jsx',import.meta.url),'utf8'),{loader:'jsx',format:'cjs',jsxFactory:'React.createElement'}).code)(fields,fields.exports,React)
 const code=transformSync(readFileSync(new URL('../components/ProjectSetupPanel.jsx',import.meta.url),'utf8'),{loader:'jsx',format:'cjs',jsxFactory:'React.createElement'}).code,module={exports:{}};new Function('require','module','exports','React',code)(n=>n.includes('ProjectFoundationFields')?{__esModule:true,default:input=>{state.foundationProps=input;return null},FoundationReview:()=>null}:n.endsWith('.css')?{}:n.includes('ProjectDeliveryPlanPanel')?{default:()=>null,__esModule:true}:n.includes('ServiceLineFields')?fields.exports:n.includes('serviceLineDraft')?serviceLineDraft:n.includes('projectSetupRepository')?{projectSetupRepository:repository}:n.includes('projectSetup.js')?setup:n.includes('serviceCatalogue')?{SERVICE_CADENCES}:native(n),module,module.exports,React)
 const root=createRoot(env.container),Component=module.exports.default,controller=new AbortController();await act(async()=>{root.render(React.createElement(Component,{organizationId:id(1),projectId:id(2),actorId:id(4),repository,signal:controller.signal,onAssist:async disclosure=>{state.disclosure=disclosure;return JSON.stringify({items:[{...setup.defaultSetupItem(leaf),service_id:undefined,service_index:0,quantity:3}],pipelines:[],questions:[],explanation:'Service-only suggestion'})}}));await new Promise(r=>setTimeout(r,0))})
 t.after(async()=>{await act(async()=>root.unmount());Object.assign(globalThis,old)})
 const button=name=>elements(env.container,'button').find(n=>n.textContent===name),click=name=>act(async()=>props(button(name)).onClick()),change=(tag,predicate,value)=>act(async()=>props(elements(env.container,tag).find(predicate)).onChange({target:{value,checked:true}}))
 async function review(){await change('input',n=>props(n)?.type==='checkbox'&&!['website','marketing'].includes(props(n)?.value),true);await change('input',n=>props(n)?.['aria-label']==='Quantity New website copy','2');await click('Review combined setup')}
 return {env,calls,state,storage,button,click,change,review}
}
test('mounted combined setup review performs no write and applies both domains once',async t=>{const ui=await mount(t);await ui.review();assert.deepEqual(ui.calls,['review']);assert.equal(ui.button('Apply setup').disabled,false);await ui.click('Apply setup');assert.deepEqual(ui.calls,['review','apply']);assert.match(ui.env.container.textContent,/saved together/);assert.equal(ui.storage.size,0)})
test('mounted uncertain save retains original request and recovery never reapplies',async t=>{const ui=await mount(t);await ui.review();ui.state.lost=true;await ui.click('Apply setup');assert.equal(ui.storage.size,1);assert.equal(Boolean(props(ui.button('Review combined setup')).disabled),true);await ui.click('Recover original setup save');assert.deepEqual(ui.calls,['review','apply','recover']);assert.equal(ui.storage.size,0)})
test('stale retained Apply handler cannot save an edited proposal',async t=>{const ui=await mount(t);await ui.review();const retained=props(ui.button('Apply setup')).onClick;await ui.change('input',n=>props(n)?.['aria-label']==='Quantity New website copy','3');await act(async()=>retained());assert.equal(ui.calls.includes('apply'),false)})

test('editing reviewed service scope clears transient pipeline choices without moving retained history',async t=>{const ui=await mount(t);await ui.review();await ui.change('select',n=>props(n)?.['aria-label']==='Combined pipeline website','retained-pipeline');assert.equal(ui.state.choices.at(-1).website,'retained-pipeline');await ui.change('input',n=>props(n)?.['aria-label']==='Quantity New website copy','3');await ui.click('Review combined setup');assert.deepEqual(ui.state.choices.at(-1),{});assert.equal(ui.calls.includes('apply'),false)})

test('unsaved foundation survives service-only AI and never enters disclosure',async t=>{const ui=await mount(t);await ui.review();const foundation={version:1,engagement_id:id(3),written:{mode:'minimum',guidance:'Private exact guidance',reason:'One page'},visual:null};await act(async()=>ui.state.foundationProps.onChange(foundation));await ui.click('Describe in Chat');await ui.change('textarea',n=>props(n)?.['aria-label']==='Project setup needs','Write three pages');await ui.click('Propose setup in Chat');assert.deepEqual(ui.state.foundationProps.value,foundation);assert.doesNotMatch(JSON.stringify(ui.state.disclosure),/Private exact guidance|foundation/);assert.equal(ui.button('Apply setup'),undefined);await ui.click('Review combined setup');assert.deepEqual(ui.state.foundationProps.value,foundation)})
test('guidance edits invalidate stale Apply and uncertain save retains the draft until recovery',async t=>{const ui=await mount(t);await ui.review();const stale=props(ui.button('Apply setup')).onClick,foundation={version:1,engagement_id:id(3),written:null,visual:{mode:'minimum',guidance:'Existing palette',reason:'Limited preview'}};await act(async()=>ui.state.foundationProps.onChange(foundation));await act(async()=>stale());assert.equal(ui.calls.includes('apply'),false);await ui.click('Review combined setup');ui.state.lost=true;await ui.click('Apply setup');assert.deepEqual(ui.state.foundationProps.value,foundation);assert.equal(ui.state.foundationProps.disabled,true);await ui.click('Recover original setup save');assert.equal(ui.calls.filter(x=>x==='apply').length,1)})

for(const action of ['accept','edit','dismiss']){
 test('mounted excerpt '+action+' uses selected service and existing review gates',async t=>{
  const ui=await mount(t)
  await ui.review()
  const previous=ui.state.lastReviewed, staleApply=props(ui.button('Apply setup')).onClick
  await ui.change('input',n=>props(n)?.type==='url','https://example.test/about')
  await ui.change('textarea',n=>props(n)?.['aria-label']==='Website excerpt','Garden design services.')
  await ui.click('Review website excerpt')
  assert.match(ui.env.container.textContent,/Garden design services/)
  assert.equal(props(ui.button('Accept excerpt as evidence')).disabled,true)
  if(action==='dismiss'){
   await ui.click('Dismiss excerpt')
   assert.equal(ui.button('Apply setup').disabled,false)
   assert.deepEqual(ui.calls,['review'])
   return
  }
  await ui.change('select',n=>props(n)?.['aria-label']==='Excerpt service',previous.items[0].service_id)
  if(action==='edit')await ui.change('textarea',n=>props(n)?.['aria-label']==='Excerpt interpretation','Offer reference')
  await ui.click(action==='edit'?'Add excerpt and interpretation':'Accept excerpt as evidence')
  assert.equal(ui.button('Apply setup'),undefined)
  await act(async()=>staleApply())
  assert.deepEqual(ui.calls,['review'])
  await ui.click('Review combined setup')
  const evidence=ui.state.lastReviewed.items[0].evidence
  assert.match(evidence,/Supporting extract: Garden design services\./)
  assert.match(evidence,/https:\/\/example.test\/about/)
  assert.equal(evidence.includes('Reviewed interpretation: Offer reference'),action==='edit')
  assert.deepEqual({...ui.state.lastReviewed.items[0],evidence:previous.items[0].evidence},previous.items[0])
  await ui.click('Apply setup')
  assert.deepEqual(ui.calls,['review','review','apply'])
 })
}

test('dismissing an excerpt keeps an incomplete service draft editable',async t=>{
 const ui=await mount(t)
 await ui.change('input',n=>props(n)?.type==='checkbox'&&!['website','marketing'].includes(props(n)?.value),true)
 const quantity=n=>props(n)?.['aria-label']==='Quantity New website copy'
 await ui.change('input',quantity,'')
 await ui.change('input',n=>props(n)?.type==='url','https://example.test/about')
 await ui.change('textarea',n=>props(n)?.['aria-label']==='Website excerpt','Garden design services.')
 await ui.click('Review website excerpt')
 await ui.click('Dismiss excerpt')
 assert.equal(ui.button('Dismiss excerpt'),undefined)
 assert.equal(props(elements(ui.env.container,'input').find(quantity)).value,'')
 assert.deepEqual(ui.calls,[])
 await ui.change('input',quantity,'3')
 await ui.click('Review combined setup')
 assert.equal(ui.state.lastReviewed.items[0].quantity,3)
 assert.doesNotMatch(ui.state.lastReviewed.items[0].evidence,/Garden design/)
})
