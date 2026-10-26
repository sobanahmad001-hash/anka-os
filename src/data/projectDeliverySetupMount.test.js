import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { transformSync } from 'esbuild'
import { mountedEnvironment } from './testSupport/n1bMountedDom.js'
const nativeRequire = createRequire(import.meta.url)
const nodes = node => [node, ...node.childNodes.flatMap(nodes)]
const props = node => node?.[Object.keys(node).find(key => key.startsWith('__reactProps$'))]

test('delivery guide retains exact project scope and existing controllers; focus choices never mutate or dispatch', async t => {
  const env = mountedEnvironment(), previous = {document:globalThis.document,window:globalThis.window,IS_REACT_ACT_ENVIRONMENT:globalThis.IS_REACT_ACT_ENVIRONMENT}
  Object.assign(globalThis,{document:env.document,window:env.window,IS_REACT_ACT_ENVIRONMENT:true})
  const compiled=transformSync(readFileSync(new URL('../components/ProjectDeliverySetup.jsx',import.meta.url),'utf8'),{loader:'jsx',format:'cjs',jsxFactory:'React.createElement'}).code
  const module={exports:{}}, bridges={}, opened=[], reported=[]
  const require=name=>name.includes('ProjectServiceScopePanel')||name.includes('ProjectPipelineConfigurationPanel')?{__esModule:true,default:input=>{bridges[name]=input;return React.createElement('span',null,name)}}:nativeRequire(name)
  new Function('require','module','exports','React',compiled)(require,module,module.exports,React)
  const root=createRoot(env.container),Component=module.exports.default
  t.after(async()=>{await act(async()=>root.unmount());Object.assign(globalThis,previous)})
  const workspace={project:{id:'project-a'},engagement:{id:'engagement-a'},services:[{service_id:'service-a',status:'planned'}],pipelineGroups:[{id:'exact-a',organization_id:'org',project_id:'project-a',engagement_id:'engagement-a',kind:'website'},{id:'foreign',organization_id:'org',project_id:'foreign',engagement_id:'engagement-a',kind:'marketing'}]}
  const input={workspace,organizationId:'org',membership:{role:'operations_admin'},scopeRevision:1,requestSignal:new AbortController().signal,onOpen:id=>opened.push(id),onNavigationBusyChange:value=>reported.push(value)}
  const render=()=>act(async()=>root.render(React.createElement(Component,input)))
  const all=()=>nodes(env.container),button=text=>all().find(node=>node.tagName==='BUTTON'&&node.textContent===text)
  const click=text=>act(async()=>props(button(text)).onClick())
  await render()
  const service=bridges['../apps/ProjectServiceScopePanel.jsx'];assert.equal(service.project.id,'project-a');assert.equal(service.organizationId,'org')
  const both=all().find(node=>props(node)?.type==='radio'&&props(node).value==='both');await act(async()=>props(both).onChange())
  assert.match(env.container.textContent,/Each retains its own stages/)
  await click('2. Review pipelines & stages')
  const pipeline=bridges['./ProjectPipelineConfigurationPanel.jsx'];assert.equal(pipeline.engagement.id,'engagement-a');assert.equal(pipeline.services,input.workspace.services);assert.equal(pipeline.initialKind,'website')
  await act(async()=>pipeline.onNavigationBusyChange(true));await act(async()=>service.onNavigationBusyChange(false));assert.equal(button('1. Select services').disabled,true);assert.equal(reported.at(-1),true);await click('1. Select services');assert.ok(env.container.textContent.includes('Choose a saved pipeline'))
  await act(async()=>pipeline.onNavigationBusyChange(false));await click('3. Open work')
  assert.ok(button('Open Website work'));assert.equal(button('Open Marketing work'),undefined)
  await click('Open all work');assert.deepEqual(opened,['work'])
  input.workspace={...workspace,project:{id:'project-b'},engagement:null,pipelineGroups:[]};input.scopeRevision=2;await render()
  assert.equal(all().filter(node=>props(node)?.type==='radio'&&props(node).checked).length,0)
  await click('2. Review pipelines & stages');assert.match(env.container.textContent,/no engagement extension/)
  assert.equal(opened.length,1)
})
