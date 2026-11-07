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

async function mount(t,header){
 const env=mountedEnvironment(),keys=['window','document','sessionStorage','requestAnimationFrame','IS_REACT_ACT_ENVIRONMENT']
 const previous=Object.fromEntries(keys.map(k=>[k,globalThis[k]]))
 Object.assign(globalThis,{window:env.window,document:env.document,sessionStorage:{getItem:()=>null},requestAnimationFrame:fn=>fn(),IS_REACT_ACT_ENVIRONMENT:true})
 const calls=[],scope={organizationId:header.organization_id,projectId:header.project_id,engagementId:header.engagement_id}
 const repository={read:async()=>header,listPartitions:async()=>({items:[{title:'Home',partition:native.unit.partition}],offset:0,total:1,limit:25}),readPartition:async()=>native.unit}
 const root=createRoot(env.container)
 await act(async()=>root.render(React.createElement(Panel,{scope,actorId:'actor',repository,onBootstrapSetup:()=>calls.push('setup'),onManualSetup:()=>calls.push('manual'),onContinue:value=>calls.push(value)})))
 t.after(async()=>{await act(async()=>root.unmount());Object.assign(globalThis,previous)})
 const button=prefix=>elements(env.container,'button').find(n=>n.textContent.startsWith(prefix))
 const click=async prefix=>{const node=button(prefix);assert.ok(node,prefix);await act(async()=>props(node).onClick())}
 return {env,calls,button,click}
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
