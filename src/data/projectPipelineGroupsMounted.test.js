import assert from 'node:assert/strict'
import test from 'node:test'
import {act,createElement} from 'react'
import {createRoot} from 'react-dom/client'
import {createServer} from 'vite'
import {mountedEnvironment,elements} from './testSupport/designVideoDom.js'
const org='a0000000-0000-4000-8000-000000000001',actor='a0000000-0000-4000-8000-000000000002',engagement='a0000000-0000-4000-8000-000000000003',website='a0000000-0000-4000-8000-000000000004',marketing='a0000000-0000-4000-8000-000000000005',preset='a0000000-0000-4000-8000-000000000006'
const props=node=>node?.[Object.keys(node).find(key=>key.startsWith('__reactProps$'))]
async function mount(t,{lost=false,initialStorage=new Map(),panel='configuration',hideRecent=false}={}) {
 const records={available:[],publishedDefinitions:[{id:'a0000000-0000-4000-8000-000000000007',definition:{name:'Published Website',version_number:1,preset_publication_id:preset,steps:[]}}],groups:[{id:website,name:'Website',kind:'website',preset_publication_id:preset},{id:marketing,name:'Marketing',kind:'marketing',preset_publication_id:preset}],configurations:[{id:'legacy',revision:9,selected_steps:[{key:'Legacy',quantity:1}],max_ai_cost_microusd:0},{id:'web',pipeline_group_id:website,revision:10,group_revision:2,selected_steps:[{key:'Website',quantity:1}],max_ai_cost_microusd:0},{id:'mkt',pipeline_group_id:marketing,revision:11,group_revision:3,selected_steps:[{key:'Marketing',quantity:1}],max_ai_cost_microusd:0}],activations:[{configuration_id:'mkt',pipeline_group_id:marketing,activation_number:11,group_activation_number:3},{configuration_id:'legacy',activation_number:9},{configuration_id:'web',pipeline_group_id:website,activation_number:10,group_activation_number:2}]}
 const calls=[],reads=[];let release=null,gate=null
 const repository={list:async(...args)=>{reads.push(args);return structuredClone(records)},createGroup:async input=>{calls.push(structuredClone(input));if(gate)await gate;const group={id:'a0000000-0000-4000-8000-000000000008',preset_publication_id:input.presetPublicationId,created_by:actor,kind:input.kind,name:input.name,request_id:input.requestId};records.groups.push(group);if(lost)throw new Error('Lost original response');return {group}}}
 const runRows=[],runCalls=[],runReads=[]
 const runRepository={list:async()=>hideRecent ? [] : structuredClone(runRows),findRequest:async input=>{runReads.push(input);return runRows.find(row=>row.request_id===input.requestId && row.requested_by===input.actorId)||null},start:async input=>{runCalls.push(input);if(gate)await gate;const row={id:'a0000000-0000-4000-8000-000000000020',request_id:input.requestId,requested_by:actor,pipeline_group_id:input.pipelineGroupId,status:'awaiting_review',requested_at:new Date().toISOString(),input_sha256:'a'.repeat(64),input_manifest:{pipeline:{version_id:preset},assets:[]}};runRows.push(row);if(lost)throw new Error('Lost run response');return {run_intent_id:row.id}}}
 repository.listGroups=async()=>structuredClone(records.groups)
 const previousFixture=globalThis.__pipelineGroupFixture;globalThis.__pipelineGroupFixture={repository,runRepository,actor}
 const server=await createServer({server:{middlewareMode:true},appType:'custom',logLevel:'silent',plugins:[{name:'isolated-pipeline-groups',enforce:'pre',resolveId(source){if(source.endsWith('/projectPipelineConfigurations.js'))return '\0pipeline-repository';if(source.endsWith('/pipelineRunIntents.js'))return '\0run-repository';if(source.endsWith('/AuthContext.jsx'))return '\0pipeline-auth'},load(id){if(id==='\0pipeline-repository')return 'export const projectPipelineConfigurations=globalThis.__pipelineGroupFixture.repository';if(id==='\0run-repository')return 'export const pipelineRunIntents=globalThis.__pipelineGroupFixture.runRepository';if(id==='\0pipeline-auth')return 'export function useAuth(){return {user:{id:globalThis.__pipelineGroupFixture.actor}}}'}}]})
 const {default:Panel}=await server.ssrLoadModule(panel==='run' ? '/src/components/PipelineRunIntentPanel.jsx' : '/src/components/ProjectPipelineConfigurationPanel.jsx'),env=mountedEnvironment(),storage=initialStorage
 const names=['document','window','Event','Node','HTMLElement','IS_REACT_ACT_ENVIRONMENT','sessionStorage','fetch'];const previous=Object.fromEntries(names.map(name=>[name,globalThis[name]]));Object.assign(globalThis,{document:env.document,window:env.window,Event:env.window.Event,Node:env.window.Node,HTMLElement:env.window.HTMLElement,IS_REACT_ACT_ENVIRONMENT:true,sessionStorage:{getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,value),removeItem:key=>storage.delete(key)},fetch:()=>{throw new Error('Network forbidden')}})
 const root=createRoot(env.container);const render=async()=>act(async()=>root.render(createElement(Panel,{organizationId:org,engagement:{id:engagement,status:'active'},services:[],assets:[],membership:{role:'operations_admin'}})));await render()
 t.after(async()=>{await act(async()=>root.unmount());await server.close();Object.assign(globalThis,previous);globalThis.__pipelineGroupFixture=previousFixture})
 const button=name=>elements(env.container,'button').find(node=>node.textContent===name),field=name=>['select','input'].flatMap(tag=>elements(env.container,tag)).find(node=>props(node)?.['aria-label']===name)
 const click=async name=>act(async()=>{const node=button(name);assert.ok(node,name);assert.notEqual(props(node).disabled,true);props(node).onClick()})
 const change=async(name,value)=>act(async()=>props(field(name)).onChange({target:{value}}))
 const prepare=async()=>{await change('Pipeline name','Second Website');await change('Independent pipeline preset',preset);await click('Review pipeline creation')}
 return {env,storage,records,calls,reads,runCalls,runReads,runRows,button,field,click,change,prepare,setGate(){gate=new Promise(done=>{release=done})},release:async()=>act(async()=>release())}
}
test('actual panel selects Website, Marketing and Legacy independently with no latest-global fallback',async t=>{
 const ui=await mount(t);assert.match(ui.env.container.textContent,/Active revision 9 · Legacy/)
 await ui.change('Pipeline selection',website);assert.match(ui.env.container.textContent,/Active revision 2 · Website/);assert.doesNotMatch(ui.env.container.textContent,/Revision 3 · activated/)
 await ui.change('Pipeline selection',marketing);assert.match(ui.env.container.textContent,/Active revision 3 · Marketing/);assert.doesNotMatch(ui.env.container.textContent,/Revision 2 · activated/)
 await ui.change('Pipeline selection','');assert.match(ui.env.container.textContent,/Active revision 9 · Legacy/);assert.equal(ui.calls.length,0)
})
test('creation review writes nothing, edits invalidate it, and a double Confirm writes one scoped group',async t=>{
 const ui=await mount(t);await ui.prepare();assert.equal(ui.calls.length,0)
 await ui.change('Pipeline name','Edited Website');assert.equal(ui.button('Confirm independent pipeline'),undefined)
 await ui.click('Review pipeline creation');ui.setGate();const click=props(ui.button('Confirm independent pipeline')).onClick;await act(async()=>{void click();void click()});assert.equal(ui.calls.length,1);assert.equal(ui.calls[0].organizationId,org);assert.equal(ui.calls[0].engagementId,engagement);assert.equal(ui.calls[0].name,'Edited Website');assert.equal(ui.calls[0].presetPublicationId,preset);assert.equal(ui.storage.size,1)
 await ui.release();assert.equal(ui.calls.length,1);assert.equal(ui.storage.size,0);assert.match(ui.env.container.textContent,/Choose steps and review activation separately/)
})
test('lost group response stays blocked until read-only exact immutable request recovery',async t=>{
 const ui=await mount(t,{lost:true});await ui.prepare();await ui.click('Confirm independent pipeline');assert.equal(ui.calls.length,1);assert.equal(ui.storage.size,1);assert.equal(props(ui.field('Pipeline selection')).disabled,true)
 const stored=[...ui.storage.values()][0];assert.equal(stored.includes('Second Website'),false);assert.equal(JSON.parse(stored).requestId,ui.calls[0].requestId)
 await ui.click('Refresh');assert.equal(ui.calls.length,1);assert.equal(ui.storage.size,0);assert.equal(props(ui.field('Pipeline selection')).disabled,false);assert.match(ui.env.container.textContent,/Original command recovered/)
})

test('reload with an unresolved original operation blocks new commands and never guesses another group',async t=>{
 const stored=new Map([[`anka-pipeline-command:${actor}:${org}:${engagement}`,JSON.stringify({kind:'group',requestId:'a0000000-0000-4000-8000-000000000009'})]])
 const ui=await mount(t,{initialStorage:stored});assert.equal(props(ui.field('Pipeline selection')).disabled,true);assert.equal(ui.calls.length,0);await ui.click('Refresh');assert.equal(ui.calls.length,0);assert.equal(ui.storage.size,1);assert.equal(props(ui.field('Pipeline selection')).disabled,true)
})

test('actual manual run selector binds the chosen Website group; double request pins one immutable review request',async t=>{
 const ui=await mount(t,{panel:'run'});await ui.change('Run pipeline',website);ui.setGate();const click=props(ui.button('Request manual run review')).onClick;await act(async()=>{void click();void click()});assert.equal(ui.runCalls.length,1);assert.equal(ui.runCalls[0].pipelineGroupId,website);assert.equal(ui.runCalls[0].organizationId,org);assert.equal(ui.runCalls[0].engagementId,engagement);assert.deepEqual(ui.runCalls[0].assetIds,[]);assert.equal(ui.storage.size,1)
 await ui.release();assert.equal(ui.runCalls.length,1);assert.equal(ui.storage.size,0);assert.match(ui.env.container.textContent,/Pipeline: Website/);assert.equal(ui.calls.length,0)
})
test('lost run response recovers the exact actor/request beyond recent history, with no duplicate or provider submission',async t=>{
 const ui=await mount(t,{panel:'run',lost:true,hideRecent:true});await ui.change('Run pipeline',marketing);await ui.click('Request manual run review');assert.equal(ui.runCalls.length,1);assert.equal(ui.storage.size,1);assert.equal(props(ui.field('Run pipeline')).disabled,true)
 await ui.click('Check original run request');assert.equal(ui.runCalls.length,1);assert.equal(ui.storage.size,0);assert.equal(ui.runReads.at(-1).actorId,actor);assert.equal(ui.runReads.at(-1).requestId,ui.runCalls[0].requestId);assert.match(ui.env.container.textContent,/Original run request recovered/)
})
