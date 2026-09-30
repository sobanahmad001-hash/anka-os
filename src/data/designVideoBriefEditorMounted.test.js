import assert from 'node:assert/strict'
import test from 'node:test'
import { act, createElement, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { createServer } from 'vite'
import { mountedEnvironment, elements } from './testSupport/designVideoDom.js'
import { emptyVideoBrief, videoBriefCreativeContent } from '../../supabase/functions/_shared/designVideoBrief.js'
const actor='a0000000-0000-4000-8000-000000000001',organizationId='a0000000-0000-4000-8000-000000000002',context={private_conversation_id:'a0000000-0000-4000-8000-000000000005'}
const props=node=>node?.[Object.keys(node).find(key=>key.startsWith('__reactProps$'))]
const defer=()=>{let resolve;const promise=new Promise(done=>{resolve=done});return {resolve,promise}}
const clean={...emptyVideoBrief(),purpose:'Explain the launch',audience:'Returning clients',channel:'Organic social',assets:'None — text-to-video only',script_storyboard:'Show the product, then three benefits',brand_constraints:'No unlicensed marks',required_text:'No required text'}
async function mount(t,{historyError=false,afterSaveError=false}={}){
 const server=await createServer({server:{middlewareMode:true},appType:'custom',logLevel:'silent'})
 const {default:Editor}=await server.ssrLoadModule('/src/components/DesignVideoBriefEditor.jsx'),env=mountedEnvironment(),storage=new Map(),writes=[],reads=[],confirmed=[],busy=[],dirty=[]
 const names=['document','window','Event','Node','HTMLElement','IS_REACT_ACT_ENVIRONMENT','sessionStorage','fetch'];const previous=Object.fromEntries(names.map(name=>[name,globalThis[name]]))
 Object.assign(globalThis,{document:env.document,window:env.window,Event:env.window.Event,Node:env.window.Node,HTMLElement:env.window.HTMLElement,IS_REACT_ACT_ENVIRONMENT:true,sessionStorage:{getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,value),removeItem:key=>storage.delete(key)},fetch:()=>{throw new Error('Network forbidden')}})
 let saved=null, gate=null,hiddenSaved=false,superseded=false,changedOperation=false
 const studio={getVideoBrief:async input=>{reads.push(structuredClone(input));if(historyError)throw new Error('Offline history unavailable');return hiddenSaved ? {} : saved ? {...saved,brief:{...saved.brief,...(superseded ? {frozen_version_id:'a0000000-0000-4000-8000-000000000091'} : {})},version:{...saved.version,...(changedOperation ? {operation_key:'a0000000-0000-4000-8000-000000000092'} : {})}} : {}},confirmVideoBrief:async input=>{writes.push(structuredClone(input));if(gate)await gate.promise;assert.deepEqual(Object.fromEntries(Object.entries(input).filter(([key])=>['private_conversation_id','direction_version_id'].includes(key))),context);saved={brief:{id:'a0000000-0000-4000-8000-000000000030',organization_id:organizationId,created_by:actor,visibility:'private',revision:2,frozen_version_id:'a0000000-0000-4000-8000-000000000031'},version:{id:'a0000000-0000-4000-8000-000000000031',creative_brief_id:'a0000000-0000-4000-8000-000000000030',organization_id:organizationId,created_by:actor,version_number:1,operation_key:input.operation_key,validation_snapshot:{valid:true,video_confirmation:{action:'confirm_video_brief',actor_id:actor,expected_revision:0,requested_root_id:null}},content:videoBriefCreativeContent(input.video_brief,context)}};if(afterSaveError)throw new Error('Offline lost confirmation response');return saved}}
 function Harness(){const [script,setScript]=useState(''),[settings,setSettings]=useState(emptyVideoBrief);return createElement(Editor,{studio,context,actorId:actor,organizationId,settings,script,onScriptChange:setScript,onRestoreSettings:setSettings,onConfirmed:value=>confirmed.push(value),onNavigationBusyChange:value=>busy.push(value),onDraftDirtyChange:value=>dirty.push(value)})}
 const root=createRoot(env.container);await act(async()=>root.render(createElement(Harness)))
 t.after(async()=>{await act(async()=>root.unmount());await server.close();Object.assign(globalThis,previous)})
 const button=name=>elements(env.container,'button').find(node=>node.textContent===name),field=name=>elements(env.container,'textarea').find(node=>props(node)['aria-label']===name)
 const click=async name=>{const node=button(name);assert.ok(node,name);assert.equal(props(node).disabled,false);await act(async()=>props(node).onClick())}
 const change=async(name,value)=>act(async()=>props(field(name)).onChange({target:{value}}))
 const prepare=async()=>{for(const [name,value] of [['Purpose',clean.purpose],['Audience',clean.audience],['Channel / placement',clean.channel],['Source assets / reuse plan',clean.assets],['Script / storyboard',clean.script_storyboard],['Brand constraints',clean.brand_constraints],['Required text',clean.required_text]])await change(name,value);await click('Preview complete video brief')}
 return {env,storage,writes,reads,confirmed,busy,dirty,button,field,click,change,prepare,reload:async()=>{await act(async()=>root.render(null));await act(async()=>root.render(createElement(Harness)))},setGate:value=>{gate=value},setHistoryError:value=>{historyError=value},setAfterSaveError:value=>{afterSaveError=value},setHiddenSaved:value=>{hiddenSaved=value},setSuperseded:value=>{superseded=value},setChangedOperation:value=>{changedOperation=value}}
}
test('complete preview performs zero writes; double Confirm saves one exact owner-private canonical version without generation',async t=>{
 const ui=await mount(t);assert.equal(props(ui.button('Preview complete video brief')).disabled,true);await ui.prepare();assert.equal(ui.writes.length,0);assert.match(ui.env.container.textContent,/Review this exact version/)
 const gate=defer();ui.setGate(gate);const click=props(ui.button('Confirm video brief version')).onClick
 await act(async()=>{void click();void click()});assert.equal(ui.writes.length,1);assert.equal(ui.busy.at(-1),true)
 assert.deepEqual(ui.writes[0].video_brief,clean);assert.equal(ui.writes[0].creative_brief_id,null);assert.equal(ui.writes[0].expected_revision,0)
 await act(async()=>gate.resolve());assert.equal(ui.storage.size,0);assert.equal(ui.confirmed.at(-1).version.id,'a0000000-0000-4000-8000-000000000031');assert.equal(ui.dirty.at(-1),false)
 await ui.change('Required text','New date');assert.equal(ui.confirmed.at(-1),null);assert.equal(ui.dirty.at(-1),true);assert.equal(ui.writes.length,1)
})
test('lost confirmation response reads its exact original operation; recovery performs no second write',async t=>{
 const ui=await mount(t,{afterSaveError:true});await ui.prepare();await ui.click('Confirm video brief version');assert.equal(ui.writes.length,1);assert.equal(ui.busy.at(-1),true);assert.equal(props(ui.button('Preview complete video brief')).disabled,true)
 const recovery=[...ui.storage.entries()].find(([key])=>key.startsWith('anka-video-brief-recovery:'));assert.ok(recovery);const record=JSON.parse(recovery[1]);assert.deepEqual(record.input.video_brief,clean);assert.equal(record.operation_key,ui.writes[0].operation_key);assert.equal(record.input.messages,undefined)
 await ui.click('Check saved brief');assert.equal(ui.writes.length,1);assert.equal(ui.reads.at(-1).operation_key,ui.writes[0].operation_key);assert.equal(ui.storage.size,0);assert.equal(ui.confirmed.at(-1).version.id,'a0000000-0000-4000-8000-000000000031')
})
test('unavailable history blocks confirmation until a successful scoped read',async t=>{
 const ui=await mount(t,{historyError:true});await ui.change('Purpose','Retain this draft');assert.equal(props(ui.button('Preview complete video brief')).disabled,true);assert.equal(ui.writes.length,0)
 ui.setHistoryError(false);await ui.click('Check saved brief');assert.equal(ui.field('Purpose').value,'Retain this draft');await ui.prepare();assert.equal(props(ui.button('Confirm video brief version')).disabled,false);assert.equal(ui.writes.length,0)
})

test('refresh retains only the current scoped working fields/settings and never substitutes saved content',async t=>{
 const ui=await mount(t);await ui.prepare();await ui.click('Confirm video brief version');await ui.change('Purpose','A new unsaved purpose');await ui.change('Script / storyboard','An unsaved storyboard')
 assert.equal(ui.writes.length,1);await ui.reload();assert.equal(ui.field('Purpose').value,'A new unsaved purpose');assert.equal(ui.field('Script / storyboard').value,'An unsaved storyboard');assert.equal(ui.confirmed.at(-1),null);assert.equal(ui.writes.length,1);assert.equal(ui.dirty.at(-1),true)
 await ui.click('Preview complete video brief');assert.match(ui.env.container.textContent,/A new unsaved purpose/);assert.equal(ui.writes.length,1)
})
test('unknown confirmation survives reload and explicit retry sends only the original immutable payload/key',async t=>{
 const ui=await mount(t,{afterSaveError:true});await ui.prepare();ui.setHiddenSaved(true);await ui.click('Confirm video brief version');const original=structuredClone(ui.writes[0]);await ui.reload();assert.equal(props(ui.button('Preview complete video brief')).disabled,true)
 ui.setAfterSaveError(false);await ui.click('Retry original brief confirmation');assert.equal(ui.writes.length,2);assert.deepEqual(ui.writes[1],original);assert.equal(ui.confirmed.at(-1).version.id,'a0000000-0000-4000-8000-000000000031');assert.equal(ui.storage.size,0)
})

test('original superseded confirmation settles without silently adopting the newer version or granting Generate',async t=>{
 const ui=await mount(t,{afterSaveError:true});await ui.prepare();await ui.click('Confirm video brief version');ui.setSuperseded(true);await ui.click('Check saved brief')
 assert.equal(ui.writes.length,1);assert.equal(ui.confirmed.at(-1),null);assert.match(ui.env.container.textContent,/historical version cannot Generate/);assert.equal([...ui.storage.keys()].some(key=>key.startsWith('anka-video-brief-recovery:')),false)
 assert.equal(ui.field('Purpose').value,clean.purpose);assert.equal(ui.dirty.at(-1),true)
})
test('a substituted recovery operation stays blocked even if its business brief matches',async t=>{
 const ui=await mount(t,{afterSaveError:true});await ui.prepare();await ui.click('Confirm video brief version');ui.setChangedOperation(true);await ui.click('Check saved brief')
 assert.equal(ui.writes.length,1);assert.equal(ui.confirmed.at(-1),null);assert.equal(props(ui.button('Preview complete video brief')).disabled,true);assert.match(ui.env.container.textContent,/Original operation does not match/)
 assert.equal([...ui.storage.keys()].some(key=>key.startsWith('anka-video-brief-recovery:')),true)
})
