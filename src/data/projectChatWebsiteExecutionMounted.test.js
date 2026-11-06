import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {createRequire} from 'node:module'
import React,{act} from 'react'
import {createRoot} from 'react-dom/client'
import {transformSync} from 'esbuild'
import {mountedEnvironment,elements} from './testSupport/designVideoDom.js'
import {createChatExecutionFixture} from '../../tools/project-chat-execution-fixture.js'
const native=createRequire(import.meta.url),props=n=>n?.[Object.keys(n).find(k=>k.startsWith('__reactProps$'))]
async function mount(t,options={}){
 const f=await createChatExecutionFixture(),env=mountedEnvironment(),names=['window','document','sessionStorage','IS_REACT_ACT_ENVIRONMENT'],old=Object.fromEntries(names.map(k=>[k,globalThis[k]])),storage=new Map()
 Object.assign(globalThis,{window:env.window,document:env.document,IS_REACT_ACT_ENVIRONMENT:true,sessionStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)}})
 function load(filename){const module={exports:{}},code=transformSync(readFileSync(filename,'utf8'),{loader:'jsx',format:'cjs',jsxFactory:'React.createElement'}).code
 new Function('require','module','exports','React',code)(name=>name.endsWith('.css')?{}:name.includes('OrganizationContext')?{}:name.includes('/lib/supabase')?{supabase:{}}:name.includes('websiteBlocks')?{websiteBlocks:f.props.buildRepository}:name.includes('websiteStagingClient')?{websiteStaging:f.props.stagingRepository}:name.endsWith('WebsiteQaReviewPanel.jsx')||name.endsWith('WebsiteStagingConnectionLink.jsx')?{__esModule:true,default:()=>null}:name.endsWith('.jsx')?load(new URL(name,filename)):native(name),module,module.exports,React);return module.exports}
 const Component=load(new URL('../components/ProjectWebsiteExecution.jsx',import.meta.url)).Execution
 let root=createRoot(env.container),current={...f.props,...options}
 async function render(next={}){current={...current,...next};await act(async()=>{root.render(React.createElement(Component,current));await new Promise(r=>setTimeout(r,0))})}
 async function remount(next={}){await act(async()=>root.unmount());root=createRoot(env.container);await render({request:null,...next})}
 await render();t.after(async()=>{await act(async()=>root.unmount());Object.assign(globalThis,old)})
 const button=name=>elements(env.container,'button').find(n=>n.textContent===name),click=name=>act(async()=>{const b=button(name);assert.ok(b,'Missing button '+name);assert.equal(props(b).disabled,false,'Disabled '+name);await props(b).onClick()}),select=(label,value)=>act(async()=>props(elements(env.container,'select').find(n=>props(n)['aria-label']===label)).onChange({target:{value}}))
 const buildKey=['anka:block-build',f.r.actor_id,f.r.organization_id,f.r.project_id,f.r.engagement_id].join(':'),stageKey=buildKey.replace('anka:block-build','anka:staging')
 async function reviewBuild(){await click('Use this exact Chat Design');await click('Review native package')}
 async function reviewStage(){await click('Use this exact built package');await click('Use tracked package for staging');await select('Bound staging site',f.uuid(79));await click('Dry run staging')}
 return {...f,env,storage,buildKey,stageKey,button,click,select,render,remount,reviewBuild,reviewStage}
}
test('single existing controller continues exact Design through reviewed Chat package and verified private preview',async t=>{
 const ui=await mount(t);assert.equal(elements(ui.env.container,'section').filter(n=>props(n)['aria-label']==='Native WordPress build').length,1)
 await ui.reviewBuild();assert.equal(ui.calls.filter(c=>c.body?.action==='build_chat').length,0)
 await ui.click('Build private review package');assert.equal(ui.storage.has(ui.buildKey),false)
 const build=ui.calls.find(c=>c.body?.action==='build_chat').body
 assert.equal(build.context.design_request_id,ui.r.request_id);assert.equal(build.context.selection.phase,'website.content');assert.equal(build.context.selection.context_sha256,'a'.repeat(64));assert.equal(build.context.selection.group_id,ui.r.selection.group_id)
 await ui.reviewStage();assert.equal(ui.calls.filter(c=>c.body?.action==='deploy-chat').length,0)
 await ui.click('Deploy reviewed staging preview');assert.equal(ui.storage.has(ui.stageKey),false)
 const stage=ui.calls.find(c=>c.body?.action==='deploy-chat').body
 assert.equal(stage.context.build_request_id,build.request_id);assert.equal(stage.context.previous_run_id,null)
 const link=elements(ui.env.container,'a').find(n=>n.textContent==='Open verified private Chat preview');assert.equal(props(link).href,'https://staging.example.test/?anka_staging_preview='+stage.request_id)
 assert.equal(ui.calls.filter(c=>c.body?.action==='build_chat').length,1);assert.equal(ui.calls.filter(c=>c.body?.action==='deploy-chat').length,1)
})
test('lost build retains complete original proposal across reload; absent and expiry checks never resend',async t=>{
 const ui=await mount(t);await ui.reviewBuild();ui.state.loseBuild=true;await ui.click('Build private review package')
 const original=ui.storage.get(ui.buildKey);assert.equal(JSON.parse(original).kind,'chat-build')
 await ui.remount();ui.state.absent=true;await ui.click('Recover original native build');assert.equal(ui.storage.get(ui.buildKey),original)
 ui.state.absent=false;ui.state.expire=true;await ui.click('Recover original native build');assert.equal(ui.storage.get(ui.buildKey),original);assert.match(ui.env.container.textContent,/Expiry does not authorize/)
 ui.state.expire=false;await ui.click('Recover original native build');assert.equal(ui.storage.has(ui.buildKey),false)
 assert.equal(ui.calls.filter(c=>c.body?.action==='build_chat').length,1)
})
test('another conversation cannot adopt pending Chat identity and cannot replace it with another Design',async t=>{
 const ui=await mount(t);await ui.reviewBuild();ui.state.loseBuild=true;await ui.click('Build private review package');const original=ui.storage.get(ui.buildKey),before=ui.calls.length
 await ui.remount({conversationId:ui.uuid(999),request:{id:ui.uuid(998),receipt:{...ui.r,conversation_id:ui.uuid(999)}}});await ui.click('Recover original native build')
 assert.equal(ui.storage.get(ui.buildKey),original);assert.match(ui.env.container.textContent,/original conversation/)
 assert.equal(ui.calls.slice(before).filter(c=>c.name==='recover_project_chat_native_build_action').length,0)
 assert.equal(props(ui.button('Review native package')).disabled,true)
})
test('uncertain staging distinguishes local check from explicit remote reconciliation with zero redeploy',async t=>{
 const ui=await mount(t);await ui.reviewBuild();await ui.click('Build private review package');await ui.reviewStage();ui.state.loseStage=true;ui.state.stageStatus='uncertain';await ui.click('Deploy reviewed staging preview')
 const original=ui.storage.get(ui.stageKey);await ui.remount();await ui.click('2. Stage and review');await ui.click('Recover original staging request')
 assert.equal(ui.storage.get(ui.stageKey),original);assert.equal(ui.calls.filter(c=>c.body?.action==='recover-chat').length,0)
 assert.equal(elements(ui.env.container,'a').some(n=>n.textContent==='Open verified private Chat preview'),false)
 await ui.click('Reconcile original remote staging result');assert.equal(ui.storage.get(ui.stageKey),original)
 assert.equal(ui.calls.filter(c=>c.body?.action==='recover-chat').length,1);assert.equal(ui.calls.filter(c=>c.body?.action==='deploy-chat').length,1)
})
test('verified preclaim rollback requires a fresh review, while retained-claim contradiction keeps original pending',async t=>{
 const ui=await mount(t);await ui.reviewBuild();ui.state.rollback=true;await ui.click('Build private review package');assert.equal(ui.storage.has(ui.buildKey),false);assert.equal(ui.button('Build private review package'),undefined)
 await ui.click('Review native package');ui.state.retained=true;await ui.click('Build private review package');assert.equal(ui.storage.has(ui.buildKey),true)
})
test('recorded claim history restores original recovery after browser pending storage is missing',async t=>{
 const ui=await mount(t);await ui.reviewBuild();ui.state.loseBuild=true;await ui.click('Build private review package');const identity=JSON.parse(ui.storage.get(ui.buildKey)).proposal.identity
 ui.storage.delete(ui.buildKey);await ui.remount();await ui.click('Open original package recovery');assert.equal(JSON.parse(ui.storage.get(ui.buildKey)).receipt.request_id,identity.request_id)
 await ui.click('Recover original native build');assert.equal(ui.storage.has(ui.buildKey),false);assert.equal(ui.calls.filter(c=>c.body?.action==='build_chat').length,1)
})
test('legacy engagement pending survives contextual continuation and remains visible without Chat adoption',async t=>{
 const ui=await mount(t);ui.storage.set(ui.buildKey,'legacy-original-request');await ui.remount({request:{id:ui.uuid(991),receipt:ui.r}})
 assert.equal(ui.storage.get(ui.buildKey),'legacy-original-request');assert.equal(props(ui.button('Review native package')).disabled,true)
 assert.match(ui.env.container.textContent,/Original pending execution/);assert.equal(ui.calls.filter(c=>c.body?.action==='build_chat').length,0)
})
test('retained confirmation cannot gain authority after membership changes',async t=>{
 const ui=await mount(t);await ui.reviewBuild();const handler=props(ui.button('Build private review package')).onClick
 await ui.render({membership:{organizationId:ui.r.organization_id,role:'member',department_id:'content'}});await act(async()=>handler())
 assert.equal(ui.calls.filter(c=>c.body?.action==='build_chat').length,0)
})
test('bounded timeout and late response preserve the original request until an explicit local check',async t=>{
 const ui=await mount(t);await ui.render({chatRepositories:{...ui.chatRepositories,timeoutMs:10}});await ui.reviewBuild();ui.state.never=true;await ui.click('Build private review package')
 const original=ui.storage.get(ui.buildKey);assert.ok(original);assert.match(ui.env.container.textContent,/outcome is uncertain/)
 await ui.remount();await act(async()=>ui.state.release());assert.equal(ui.storage.get(ui.buildKey),original)
 await ui.click('Recover original native build');assert.equal(ui.storage.has(ui.buildKey),false);assert.equal(ui.calls.filter(c=>c.body?.action==='build_chat').length,1)
})
test('both engagement pending records keep their original recovery controls reachable',async t=>{
 const ui=await mount(t);await ui.reviewBuild();ui.state.loseBuild=true;await ui.click('Build private review package');const buildPending=ui.storage.get(ui.buildKey);await ui.click('Recover original native build')
 await ui.reviewStage();ui.state.loseStage=true;await ui.click('Deploy reviewed staging preview');ui.storage.set(ui.buildKey,buildPending);await ui.remount()
 assert.equal(props(ui.button('Recover original native build')).disabled,false);assert.equal(props(ui.button('Recover original staging request')).disabled,false)
 await ui.click('Recover original native build');await ui.click('Recover original staging request');assert.equal(ui.storage.has(ui.buildKey),false);assert.equal(ui.storage.has(ui.stageKey),false)
})
