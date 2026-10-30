import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import * as controller from './websiteExecutionController.js'
import {createRequire} from 'node:module'
import React,{act} from 'react'
import {createRoot} from 'react-dom/client'
import {transformSync} from 'esbuild'
import {mountedEnvironment,elements} from './testSupport/designVideoDom.js'
const native=createRequire(import.meta.url),props=n=>n?.[Object.keys(n).find(k=>k.startsWith('__reactProps$'))]
test('restored staging recovery remains reachable from default build step; dirty revision locks parent navigation',async t=>{
 const env=mountedEnvironment(),keys=['window','document','sessionStorage','IS_REACT_ACT_ENVIRONMENT'],old=Object.fromEntries(keys.map(k=>[k,globalThis[k]])),storage=new Map([['anka:staging:actor:org:project:eng',JSON.stringify({kind:'deploy',requestId:'original'})]])
 Object.assign(globalThis,{window:env.window,document:env.document,IS_REACT_ACT_ENVIRONMENT:true,sessionStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)}})
 const workspace={project:{id:'project',organization_id:'org'},engagement:{id:'eng',organization_id:'org',project_id:'project'},activeServices:[]},calls=[],activity=[]
 const buildRepository={workspace:async()=>({designs:[],jobs:[],design_total:0,job_total:0})},stagingRepository={workspace:async()=>({targets:[],jobs:[],runs:[{id:'run',status:'staged'}],issues:[],connections:[]}),recover:async(_s,id)=>{calls.push(id);return {status:'staged'}}}
 function load(filename){const module={exports:{}};const code=transformSync(readFileSync(filename,'utf8'),{loader:'jsx',format:'cjs',jsxFactory:'React.createElement'}).code
  new Function('require','module','exports','React',code)(name=>name.endsWith('.css')?{}:name.includes('OrganizationContext')?{}:name.includes('/lib/supabase')?{supabase:{}}:name.includes('websiteBlocks')?{websiteBlocks:buildRepository}:name.includes('websiteStagingClient')?{websiteStaging:stagingRepository}:name.includes('websiteExecutionController')?controller:name.endsWith('WebsiteQaReviewPanel.jsx')?{__esModule:true,default:()=>null}:name.endsWith('WebsiteStagingConnectionLink.jsx')?{__esModule:true,default:()=>null}:name.endsWith('.jsx')?load(new URL(name,filename)):native(name),module,module.exports,React);return module.exports}
 const Component=load(new URL('../components/ProjectWebsiteExecution.jsx',import.meta.url)).Execution,root=createRoot(env.container)
 await act(async()=>{root.render(React.createElement(Component,{workspace,conversationId:'conversation',actorId:'actor',owner:true,membership:{organizationId:'org',role:'operations_admin'},buildRepository,stagingRepository,onStateChange:s=>activity.push(s)}));await new Promise(r=>setTimeout(r,0))})
 t.after(async()=>{await act(async()=>root.unmount());Object.assign(globalThis,old)})
 const button=name=>elements(env.container,'button').find(n=>n.textContent===name)
 assert.equal(activity.at(-1).busy,true);assert.equal(props(button('2. Stage and review')).disabled,false)
 await act(async()=>props(button('2. Stage and review')).onClick())
 await act(async()=>props(button('Recover original staging request')).onClick());assert.deepEqual(calls,['original']);assert.equal(activity.at(-1).busy,false)
 await act(async()=>props(elements(env.container,'textarea')[0]).onChange({target:{value:'Retained revision draft'}}));assert.equal(activity.at(-1).dirty,true)
 assert.equal(props(button('2. Stage and review')).disabled,false);assert.equal(props(button('1. Review and build')).disabled,false)
 await act(async()=>props(button('1. Review and build')).onClick());assert.equal(props(button('Review native package')).disabled,true)
 await act(async()=>props(button('2. Stage and review')).onClick());assert.equal(props(elements(env.container,'textarea')[0]).value,'Retained revision draft')
})
