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
 const render=()=>React.act(async()=>root.render(React.createElement(C,{},bridge=>React.createElement('div',{},bridge.toolbar,bridge.starters))))
 const buttons=()=>all(env.container).filter(n=>n.tagName==='BUTTON'),button=text=>buttons().find(n=>n.textContent===text)
 await render();const existing=all(env.container).find(n=>props(n)?.['aria-label']==='Existing private brief');await React.act(async()=>props(existing).onChange({target:{value:'brief'}}))
 assert.equal(props(button('Prepare generation')).disabled,false)
 await React.act(async()=>props(button('Prepare generation')).onClick());let pending;await React.act(async()=>{pending=props(button('Start pending fixture')).onClick()})
 for(const label of ['Edit brief','Start with the editable brief']){assert.equal(props(button(label)).disabled,true);await React.act(async()=>props(button(label)).onClick());assert.ok(button('Start pending fixture'))}
 await React.act(async()=>{finish();await pending});await React.act(async()=>props(button('Back to editable brief')).onClick());await React.act(async()=>props(button('Edit draft fixture')).onClick());assert.equal(props(button('Prepare generation')).disabled,true)
})
