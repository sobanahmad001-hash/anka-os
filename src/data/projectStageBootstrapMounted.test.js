import {createFoundationCheckpointRepository} from './foundationCheckpointRepository.js'
import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {createRequire} from 'node:module'
import {buildSync} from 'esbuild'
import React,{act} from 'react'
import {createRoot} from 'react-dom/client'
import {mountedEnvironment,elements} from './testSupport/designVideoDom.js'

const require=createRequire(import.meta.url)
const native=JSON.parse(readFileSync(new URL('../../tools/project-stage-native-fixture.json',import.meta.url)))
const bundled=buildSync({entryPoints:['src/components/ProjectStagePlanPanel.jsx'],bundle:true,write:false,platform:'node',format:'cjs',jsx:'automatic',external:['react','react/jsx-runtime','../lib/supabase.js'],loader:{'.css':'empty'}})
const module={exports:{}}
new Function('require','module','exports',bundled.outputFiles[0].text)(name=>name.endsWith('supabase.js')?{supabase:{}}:require(name),module,module.exports)
const Panel=module.exports.default
const props=node=>node?.[Object.keys(node).find(k=>k.startsWith('__reactProps$'))]

async function mount(t,header,extra={}){
 const env=mountedEnvironment(),keys=['window','document','sessionStorage','requestAnimationFrame','IS_REACT_ACT_ENVIRONMENT']
 const storage=new Map()
 const previous=Object.fromEntries(keys.map(k=>[k,globalThis[k]]))
 Object.assign(globalThis,{window:env.window,document:env.document,sessionStorage:{getItem:k=>storage.get(k)??null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)},requestAnimationFrame:fn=>fn(),IS_REACT_ACT_ENVIRONMENT:true})
 const calls=[],scope={organizationId:header.organization_id,projectId:header.project_id,engagementId:header.engagement_id}
 const repository={read:async()=>header,listPartitions:async()=>({items:[{title:'Home',partition:native.unit.partition}],offset:0,total:1,limit:25}),readPartition:async()=>native.unit}
 const root=createRoot(env.container)
 await act(async()=>root.render(React.createElement(Panel,{scope,actorId:'actor',repository,onOpenBrief:()=>calls.push('brief'),onBootstrapSetup:()=>calls.push('setup'),onManualSetup:()=>calls.push('manual'),onContinue:value=>calls.push(value),...extra})))
 t.after(async()=>{await act(async()=>root.unmount());Object.assign(globalThis,previous)})
 const button=prefix=>elements(env.container,'button').find(n=>n.textContent.startsWith(prefix))
 const click=async prefix=>{const node=button(prefix);assert.ok(node,prefix);await act(async()=>props(node).onClick())}
 return {env,calls,button,click,storage}
}

test('empty foundation opens project setup directly, without creating a Chat selection',async t=>{
 const ui=await mount(t,{...native.header,state:'unconfigured',plan_id:null,groups:[],bindings:[]})
 assert.equal(ui.button('Continue in Chat'),undefined)
 await ui.click('Open project setup')
 assert.deepEqual(ui.calls,['setup'])
})
test('foundation with saved mappable steps opens the existing mapping editor',async t=>{
 const group={...native.header.groups[0],kind:'branding'}
 const ui=await mount(t,{...native.header,can_manage:true,groups:[group],bindings:[]})
 await ui.click('Map saved pipeline steps')
 assert.ok(elements(ui.env.container,'section').some(n=>props(n)['aria-label']==='Stage mapping'))
 assert.deepEqual(ui.calls,[])
})
test('a mapped stage requires loaded evidence and then continues with the exact partition checksum',async t=>{
 const ui=await mount(t,native.header)
 await ui.click('Website')
 const binding=native.header.bindings[0]
 const {PROJECT_STAGE_PHASES}=await import('./projectStagePlan.js')
 const label=PROJECT_STAGE_PHASES.find(p=>p.key===binding.phase).label
 const stageButton=elements(ui.env.container,'button').find(n=>n.textContent.includes(label)&&props(n)['aria-controls'])
 await act(async()=>props(stageButton).onClick())
 assert.equal(ui.button('Continue in Chat'),undefined)
 await ui.click('Choose a saved pipeline item')
 const select=elements(ui.env.container,'select').find(n=>props(n)['aria-label']==='Saved pipeline')
 await act(async()=>props(select).onChange({target:{value:binding.group_id}}))
 await ui.click('Browse saved items');await ui.click('Load progress');await ui.click('Continue in Chat')
 const selection=ui.calls[0].item?.context||ui.calls[0].stage.context
 assert.equal(selection.context_sha256,native.unit.context_sha256)
 assert.deepEqual(selection.partition,native.unit.partition)
})

for (const configurationCurrent of [false,null]) {
 test('loaded completed evidence is withheld when pipeline configuration becomes '+configurationCurrent,async t=>{
  const header=structuredClone(native.header)
  const binding=header.bindings[0],group=header.groups.find(row=>row.id===binding.group_id)
  const ui=await mount(t,header)
  await ui.click('Website')
  const {PROJECT_STAGE_PHASES,projectStagePlan}=await import('./projectStagePlan.js')
  const label=PROJECT_STAGE_PHASES.find(p=>p.key===binding.phase).label
  const stageButton=elements(ui.env.container,'button').find(n=>n.textContent.includes(label)&&props(n)['aria-controls'])
  await act(async()=>props(stageButton).onClick())
  const select=elements(ui.env.container,'select').find(n=>props(n)['aria-label']==='Saved pipeline')
  await act(async()=>props(select).onChange({target:{value:binding.group_id}}))
  await ui.click('Browse saved items');await ui.click('Load progress')
  assert.ok(ui.button('Continue in Chat'))
  assert.match(ui.env.container.textContent,/2 of 2/)
  // Reproject the same previously returned unit under the newly observed header.
  group.configuration_current=configurationCurrent
  await ui.click('Load progress')
  const stage=projectStagePlan(header,[native.unit]).tracks.flatMap(track=>track.stages).find(row=>row.id===binding.phase)
  assert.equal(stage.configured,false);assert.equal(stage.context,null);assert.equal(stage.status,null)
  assert.equal(stage.progress,null);assert.deepEqual(stage.items,[]);assert.deepEqual(stage.outputs,[])
  assert.doesNotMatch(ui.env.container.textContent,/2 of 2/);assert.equal(ui.button('Continue in Chat'),undefined)
  await ui.click('Open project setup');assert.deepEqual(ui.calls,['setup'])
 })
}

test('empty branding exposes the brief and positioning without a mapping or Chat continuation',async t=>{
 const ui=await mount(t,{...native.header,state:'unconfigured',can_manage:true,plan_id:null,groups:[],bindings:[]})
 assert.equal(props(ui.button('Map stages')).disabled,true)
 await ui.click('Open business brief')
 await ui.click('Go to Brand positioning')
 assert.match(ui.env.container.textContent,/Brand positioning/)
 assert.equal(ui.button('Open business brief'),undefined)
 assert.equal(ui.button('Continue in Chat'),undefined)
 assert.deepEqual(ui.calls,['brief'])
})

const actorId='00000000-0000-4000-8000-000000000101'
const checkpoint='00000000-0000-4000-8000-000000000102'
async function foundation(t,mode){
 const header={...native.header,state:'unconfigured',can_manage:true,plan_id:null,groups:[],bindings:[]}
 const writes=[], reads=[], handed=[]
 let binding=null, original=null, matches=true, recoveryCount=0
 const repo=createFoundationCheckpointRepository({auth:{getUser:async()=>({data:{user:{id:actorId}}})},rpc(name,args){
  assert.equal(args.p_organization_id,header.organization_id);assert.equal(args.p_project_id,header.project_id);assert.equal(args.p_engagement_id,header.engagement_id)
  return {async abortSignal(){
   if(name==='bind_project_foundation_brief'){
    writes.push(args)
    assert.equal(args.p_expected_binding_id,null)
    if(mode!=='uncertain')binding={request_id:args.p_request_id,checkpoint_id:checkpoint,source_version:2,brief_sha256:'a'.repeat(64)}
    original=binding
    if(['lost','uncertain','superseded','denied'].includes(mode))throw Error('response lost')
    return {data:binding}
   }
   if(name==='recover_project_foundation_brief'){
    assert.equal(args.p_request_id,writes[0].p_request_id)
    recoveryCount++
    if(mode==='denied')return {error:{code:'42501',message:'Recovery access denied'}}
    if(mode==='superseded'&&recoveryCount===1)return {data:null}
    return {data:original}
   }
   assert.equal(name,'read_project_foundation_brief');reads.push(args.p_checkpoint_id)
   return {data:{organization_id:header.organization_id,project_id:header.project_id,engagement_id:header.engagement_id,actor_id:mode==='foreign'?checkpoint:actorId,
    current_binding:binding,options:[{checkpoint_id:checkpoint,source_version:2}],has_more:false,
    selected:args.p_checkpoint_id?{checkpoint_id:checkpoint,source_version:2,brief_sha256:'a'.repeat(64),brief_text:'Synthetic internal brief',matches_current_brief:matches}:null}}
  }}
 }})
 const ui=await mount(t,header,{actorId,foundationRepository:repo,onContinueFoundationPositioning:b=>handed.push(b)})
 return {...ui,writes,reads,handed,supersede:()=>{binding={...original,checkpoint_id:'00000000-0000-4000-8000-000000000103',request_id:crypto.randomUUID()}},changeBrief:()=>{matches=false},async inspect(){
  await ui.click('Browse internal checkpoints')
  const select=elements(ui.env.container,'select').find(n=>props(n).value==='')
  await act(async()=>props(select).onChange({target:{value:checkpoint}}))
  assert.doesNotMatch(ui.env.container.textContent,/Synthetic internal brief/)
  await ui.click('Review selected checkpoint')
 }}
}
for(const mode of ['saved','lost','uncertain','changed']){
 test('unconfigured foundation checkpoint '+mode,async t=>{
  const ui=await foundation(t,mode)
  assert.deepEqual(ui.reads,[])
  await ui.inspect()
  assert.match(ui.env.container.textContent,/Synthetic internal brief/)
  assert.equal(ui.writes.length,0)
  await ui.click('Bind reviewed checkpoint')
  assert.equal(ui.writes.length,1)
  if(mode==='uncertain'){
   await ui.click('Check original checkpoint binding')
   assert.equal(ui.storage.size,1)
   assert.equal(ui.writes.length,1)
   assert.equal(ui.button('Bind reviewed checkpoint'),undefined)
   return
  }
  assert.equal(ui.storage.size,0)
  await ui.click('Go to Brand positioning')
  await ui.click('Check bound brief')
  if(mode==='changed')ui.changeBrief()
  await ui.click('Continue in Chat for Brand positioning')
  assert.equal(ui.writes.length,1);assert.deepEqual(ui.calls,[])
  if(mode==='changed'){assert.deepEqual(ui.handed,[]);assert.match(ui.env.container.textContent,/changed/)}
  else assert.deepEqual(ui.handed,[{request_id:ui.writes[0].p_request_id,checkpoint_id:checkpoint,source_version:2,brief_sha256:'a'.repeat(64)}])
 })
}
test('foreign actor cannot disclose a selected checkpoint',async t=>{
 const ui=await foundation(t,'foreign')
 await ui.click('Browse internal checkpoints')
 assert.match(ui.env.container.textContent,/scope changed/)
 assert.deepEqual(ui.writes,[]);assert.deepEqual(ui.handed,[])
})

test('lost A is confirmed by its original receipt while B remains the current binding',async t=>{
 const ui=await foundation(t,'superseded')
 await ui.inspect()
 await ui.click('Bind reviewed checkpoint')
 assert.equal(ui.storage.size,1)
 ui.supersede()
 await ui.click('Check original checkpoint binding')
 assert.equal(ui.storage.size,0)
 assert.match(ui.env.container.textContent,/Bound checkpoint 00000000-0000-4000-8000-000000000103/)
 assert.match(ui.env.container.textContent,/current binding has changed/)
 assert.equal(ui.writes.length,1)
 assert.deepEqual(ui.handed,[])
})
test('denied original receipt lookup retains pending request and never writes again',async t=>{
 const ui=await foundation(t,'denied')
 await ui.inspect()
 await ui.click('Bind reviewed checkpoint')
 await ui.click('Check original checkpoint binding')
 assert.equal(ui.storage.size,1)
 assert.match(ui.env.container.textContent,/Recovery access denied/)
 assert.equal(ui.writes.length,1)
})

const outputId='00000000-0000-4000-8000-000000000501'
const originalChat='00000000-0000-4000-8000-000000000502'
async function positioning(t,mode){
 const header={...native.header,state:'unconfigured',plan_id:null,groups:[],bindings:[]}
 const handed=[],requests=[]
 const output={version_id:outputId,version_number:7,wording_sha256:'d'.repeat(64),binding_id:checkpoint,conversation_id:mode==='foreign'?null:originalChat}
 const response={organization_id:header.organization_id,project_id:header.project_id,engagement_id:header.engagement_id,actor_id:actorId,binding_id:checkpoint,current:output,selected:null}
 const client={rpc(name,args){
  assert.equal(name,'read_project_positioning_output')
  assert.deepEqual(args,{p_organization_id:header.organization_id,p_project_id:header.project_id,p_engagement_id:header.engagement_id,p_conversation_id:null,p_version_id:null})
  requests.push(args)
  return {abortSignal:async()=>({data:structuredClone(response)})}
 }}
 const ui=await mount(t,header,{actorId,positioningClient:client,onContinueProductStructure:value=>handed.push(value)})
 await ui.click('Go to Brand positioning')
 assert.match(ui.env.container.textContent,/Saved version 7/)
 assert.ok(ui.env.container.textContent.includes(outputId))
 assert.equal(ui.button('Continue with this version'),undefined)
 const stage=elements(ui.env.container,'button').find(n=>n.textContent.includes('Product')&&n.textContent.includes('structure'))
 await act(async()=>props(stage).onClick())
 return {...ui,response,output,handed,requests}
}
for(const mode of ['current','foreign','new-version','new-binding']){
 test('unconfigured stage output and product structure continuation '+mode,async t=>{
  const ui=await positioning(t,mode)
  assert.deepEqual(ui.handed,[])
  if(mode==='foreign'){
   assert.equal(ui.button('Continue with this version'),undefined)
   assert.match(ui.env.container.textContent,/originating private Chat/)
   return
  }
  if(mode==='new-version')ui.response.current={...ui.output,version_id:actorId,version_number:8}
  if(mode==='new-binding')ui.response.binding_id=actorId
  await ui.click('Continue with this version')
  assert.equal(ui.requests.length,3)
  assert.deepEqual(ui.handed,mode==='current'?[ui.output]:[])
  assert.deepEqual(ui.calls,[])
  if(mode!=='current')assert.match(ui.env.container.textContent,/changed/)
 })
}
