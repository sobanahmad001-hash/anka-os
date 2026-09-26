import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import React, { act, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { transformSync } from 'esbuild'
import { mountedEnvironment, elements } from './testSupport/designVideoDom.js'
const nativeRequire = createRequire(import.meta.url)
const props = node => node[Object.keys(node).find(key => key.startsWith('__reactProps$'))]

test('Design history disclosure retains mounted search and chat draft, with scope visibility always present', async t => {
  const env = mountedEnvironment(), previous = { document: globalThis.document, window: globalThis.window, IS_REACT_ACT_ENVIRONMENT: globalThis.IS_REACT_ACT_ENVIRONMENT }
  Object.assign(globalThis, { document: env.document, window: env.window, IS_REACT_ACT_ENVIRONMENT: true })
  const source = readFileSync(new URL('../components/WorkshopChatWorkspace.jsx', import.meta.url), 'utf8')
  const compiled = transformSync(source, { loader: 'jsx', format: 'cjs', jsxFactory: 'React.createElement' }).code
  const module = { exports: {} }
  new Function('require','module','exports','React',compiled)(name=>name.endsWith('.css')?{}:nativeRequire(name),module,module.exports,React)
  const Component = module.exports.default
  let mounts = 0
  // Use createElement so this Node test itself does not require a JSX loader.
  const HistoryComponent = () => { const [query,setQuery] = useState(''); useEffect(()=>{mounts++},[]); return React.createElement('input', { 'aria-label':'Fixture search', value:query, onChange:event=>setQuery(event.target.value) }) }
  const root = createRoot(env.container)
  t.after(async()=>{await act(async()=>root.unmount());Object.assign(globalThis,previous)})
  await act(async()=>root.render(React.createElement(Component,{presentation:'design',mode:'chat',departmentName:'Design',projectName:'Exact project',engagementName:'Exact engagement',conversationList:()=>React.createElement(HistoryComponent)},React.createElement('textarea',{'aria-label':'Unsent draft',defaultValue:'Keep this draft'}))))
  const toggle = elements(env.container,'button').find(node=>node.textContent==='Conversations')
  const disclosure = elements(env.container,'div').find(node=>props(node)?.id===props(toggle)['aria-controls'])
  assert.equal(props(disclosure).hidden,true)
  const search=elements(env.container,'input')[0], draft=elements(env.container,'textarea')[0]
  await act(async()=>props(toggle).onClick())
  await act(async()=>props(search).onChange({target:{value:'Exact history'}}))
  await act(async()=>props(toggle).onClick())
  await act(async()=>props(toggle).onClick())
  assert.equal(mounts,1)
  assert.equal(elements(env.container,'input')[0].value,'Exact history')
  assert.equal(elements(env.container,'textarea')[0],draft)
  assert.match(env.container.textContent,/Exact project · Exact engagement/)
  assert.match(env.container.textContent,/creator-private unless explicitly shared/)
})

test('Design-only layout opts in without changing media jobs or shared chat transport',()=>{
  const css=readFileSync(new URL('../components/designWorkshopPresentation.css',import.meta.url),'utf8')
  const parent=readFileSync(new URL('../apps/DepartmentWorkshop.jsx',import.meta.url),'utf8')
  assert.match(css,/@container \(min-width: 1000px\)/)
  assert.match(css,/object-fit: contain/)
  assert.match(css,/var\(--anka-focus\)/)
  assert.match(css,/max-width: 600px/)
  assert.doesNotMatch(css,/filter:|!important|position: fixed/)
  assert.match(parent,/presentation=\{departmentId === 'design' \? 'design' : undefined\}/)
  assert.match(parent,/externalNavigationBusy=\{designNavigationBusy\}/)
  assert.match(parent,/key=\{designPaneKey\}/)
  assert.match(parent,/\['design', 'content', 'marketing'\]\.includes\(departmentId\) \? 'design-workshop-surface h-full overflow-y-auto'/)
  assert.match(css,/\.design-workshop-surface \{ background: var\(--anka-canvas\); color: var\(--anka-ink\); \}/)
  assert.match(parent,/Video · how to open Higgsfield tools/)
  assert.match(parent,/Generation is not available in private exploration/)
  assert.match(parent,/does not share or move this private conversation/)
  assert.match(parent,/Higgsfield is a video connection, not a text-chat model/)
  assert.match(parent,/draft tools · how to open/)
  assert.match(parent,/Campaign brief suggestions are applied selectively/)
  assert.match(parent,/Project draft tools are not enabled in this private context/)
})
