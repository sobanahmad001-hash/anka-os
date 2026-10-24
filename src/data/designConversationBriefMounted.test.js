import test from 'node:test'
import assert from 'node:assert/strict'
import * as React from 'react'
import {createRoot} from 'react-dom/client'
import {readFileSync} from 'node:fs'
import {transformSync} from 'esbuild'
import {mountedEnvironment} from './testSupport/n1bMountedDom.js'
const all=n=>[n,...n.childNodes.flatMap(all)],props=n=>n?.[Object.keys(n).find(k=>k.startsWith('__reactProps$'))]
test('conversation brief preserves media lock and requires clean latest confirmed version',async t=>{
 const env=mountedEnvironment(),before={};for(const [k,v] of Object.entries({document:env.document,window:env.window,Event:env.window.Event,Node:env.window.Node,HTMLElement:env.window.HTMLElement,IS_REACT_ACT_ENVIRONMENT:true})){before[k]=globalThis[k];globalThis[k]=v}
 const source=readFileSync(new URL('../components/DesignUnifiedWorkspace.jsx',import.meta.url),'utf8').replace(/^import .*\n/gm,'').replace('export default function','function')
 const code=transformSync(source,{loader:'jsx',jsxFactory:'React.createElement'}).code
 const brief={id:'brief',created_by:'actor',visibility:'private',frozen_version_id:'v1'},version={id:'v1',creative_brief_id:'brief',version_number:1,content:{title:'Confirmed',purpose:'Purpose',instructions:'Direction'}}
 const studio={loadPrivateBriefs:async()=>({briefs:[brief],versions:[version],sources:[],sourceVersions:[],jobs:[]})}
 const Editor=({onDirtyChange})=>React.createElement('button',{onClick:()=>onDirtyChange(true)},'Edit draft fixture')
 let finish;const Media=({onBusyChange})=>React.createElement('button',{onClick:()=>{onBusyChange(true);return new Promise(resolve=>{finish=()=>{onBusyChange(false);resolve()}})}},'Start pending fixture')
 const signal=new AbortController().signal
 const C=new Function('React','useCallback','useEffect','useMemo','useRef','useState','useAuth','useOrganization','designWorkshop','designCapabilities','creativeBriefForContext','latestBriefVersion','eligibleDesignVersions','DesignCreativeBriefWorkspace','DesignUnifiedMediaComposer',code+';return DesignUnifiedWorkspace')(React,React.useCallback,React.useEffect,React.useMemo,React.useRef,React.useState,()=>({user:{id:'actor'}}),()=>({activeOrganizationId:'org',scopeRevision:1,activeMembership:{},requestSignal:signal}),{forOrganization:()=>studio},()=>({createDraft:true}),()=>brief,()=>version,()=>[],Editor,Media)
 const root=createRoot(env.container);t.after(async()=>{await React.act(async()=>root.unmount());Object.assign(globalThis,before)})
 const render=()=>React.act(async()=>root.render(React.createElement(C,{},bridge=>React.createElement('div',{},bridge.toolbar,bridge.starters,React.createElement('button',{onClick:()=>bridge.onConversationChange({id:'saved-chat',organization_id:'org',owner_id:'actor',department_id:'design',context_kind:'department_private',state:'active'},()=>{})},'Choose saved chat fixture')))))
 const buttons=()=>all(env.container).filter(n=>n.tagName==='BUTTON'),button=text=>buttons().find(n=>n.textContent===text)
 await render();await React.act(async()=>props(button('Choose saved chat fixture')).onClick());const existing=all(env.container).find(n=>props(n)?.['aria-label']==='Existing private brief');await React.act(async()=>props(existing).onChange({target:{value:'brief'}}))
 assert.equal(props(button('Prepare generation')).disabled,false)
 await React.act(async()=>props(button('Prepare generation')).onClick());let pending;await React.act(async()=>{pending=props(button('Start pending fixture')).onClick()})
 for(const label of ['Edit brief','Start with the editable brief']){assert.equal(props(button(label)).disabled,true);await React.act(async()=>props(button(label)).onClick());assert.ok(button('Start pending fixture'))}
 await React.act(async()=>{finish();await pending});await React.act(async()=>props(button('Back to editable brief')).onClick());await React.act(async()=>props(button('Edit draft fixture')).onClick());assert.equal(props(button('Prepare generation')).disabled,true)
})


test('chat saved baseline adopts once while manual edit-and-revert and scope changes remain protected',async t=>{
 const env=mountedEnvironment(),before={};for(const [k,v] of Object.entries({document:env.document,window:env.window,Event:env.window.Event,Node:env.window.Node,HTMLElement:env.window.HTMLElement,IS_REACT_ACT_ENVIRONMENT:true})){before[k]=globalThis[k];globalThis[k]=v}
 const source=readFileSync(new URL('../components/DesignCreativeBriefWorkspace.jsx',import.meta.url),'utf8').replace(/^import .*\n/gm,'').replace('export default DesignCreativeBriefWorkspace','')
 const code=transformSync(source,{loader:'jsx',jsxFactory:'React.createElement'}).code
 const empty=()=>({title:'Original',output_type:'image',purpose:'Purpose',audience:'',objective:'',placement_destination:'',requested_outputs:[],rights_notes:'',instructions:'',exclusions_constraints:'',media_references:[]})
 let brief={id:'b',organization_id:'org',visibility:'private',revision:1},version={id:'v1',creative_brief_id:'b',content:empty()}
 const C=new Function('React','forwardRef','useEffect','useImperativeHandle','useMemo','useRef','useState','CREATIVE_BRIEF_OUTPUTS','creativeBriefForContext','emptyCreativeBrief','latestBriefVersion','nextOperationKey','validateCreativeBrief','approvedDesignSystemReferences',code+';return DesignCreativeBriefWorkspace')(React,React.forwardRef,React.useEffect,React.useImperativeHandle,React.useMemo,React.useRef,React.useState,[['image','Image']],()=>brief,empty,()=>version,()=> 'operation',()=>({valid:true,missing:[]}),()=>[])
 const root=createRoot(env.container),ref=React.createRef();let saves=0,freezes=0,selectedId='b'
 t.after(async()=>{await React.act(async()=>root.unmount());Object.assign(globalThis,before)})
 const render=()=>React.act(async()=>root.render(React.createElement(C,{ref,workspace:{engagement:{organization_id:'org',id:''},creativeBriefs:[brief],creativeBriefVersions:[version],creativeBriefSources:[]},activeServiceId:'',visibility:'private',selectedPrivateBriefId:selectedId,canSave:true,onSave:()=>{saves++},onFreeze:()=>{freezes++}})))
 const title=()=>all(env.container).find(n=>n.tagName==='INPUT'&&props(n)?.maxLength==='200')||all(env.container).find(n=>n.tagName==='INPUT'&&props(n)?.maxLength===200)
 await render();const sent=ref.current.captureForChat();const receipt={status:'saved',result:{brief:{...brief,revision:2},version:{id:'v2',creative_brief_id:'b',content:{...empty(),title:'AI draft'}}}}
 await React.act(async()=>assert.equal(ref.current.adoptChatResult(sent,receipt),true));assert.equal(ref.current.isDirty(),false);assert.equal(props(title()).value,'AI draft')
 brief=receipt.result.brief;version=receipt.result.version;await render();assert.equal(ref.current.isDirty(),false)
 const next=ref.current.captureForChat();await React.act(async()=>props(title()).onChange({target:{value:'Manual'}}));await React.act(async()=>assert.equal(ref.current.adoptChatResult(sent,receipt),false));assert.equal(ref.current.isDirty(),true);assert.equal(props(title()).value,'Manual');await React.act(async()=>props(title()).onChange({target:{value:'AI draft'}}))
 const newer={status:'saved',result:{brief:{...brief,revision:3},version:{id:'v3',creative_brief_id:'b',content:{...empty(),title:'New AI'}}}}
 await React.act(async()=>assert.equal(ref.current.adoptChatResult(next,newer),false));assert.equal(props(title()).value,'AI draft');assert.match(env.container.textContent,/current edits were kept/)
 brief=newer.result.brief;version=newer.result.version;await render();assert.equal(props(title()).value,'AI draft');assert.match(env.container.textContent,/newer saved brief version/);await React.act(async()=>assert.equal(ref.current.adoptChatResult(null,newer),false));assert.equal(saves,0);assert.equal(freezes,0);selectedId='other';brief={...brief,id:'other'};version={...version,creative_brief_id:'other'};await render();assert.doesNotThrow(()=>ref.current.captureForChat());assert.doesNotMatch(env.container.textContent,/current edits were kept/)
})
