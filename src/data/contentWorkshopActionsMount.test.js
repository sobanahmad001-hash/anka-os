import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { transformSync } from 'esbuild'
import { mountedEnvironment } from './testSupport/n1bMountedDom.js'
import { contentWorkshopActionTarget } from './contentWorkshopActions.js'
const nativeRequire = createRequire(import.meta.url)
const nodes = n => [n, ...n.childNodes.flatMap(nodes)]
const propsOf = n => n[Object.keys(n).find(key => key.startsWith('__reactProps$'))]
test('mounted Content handoff requires confirmation, respects busy, and clears cross-scope intent', async t => {
  const env = mountedEnvironment(), previous = { document: globalThis.document, window: globalThis.window, IS_REACT_ACT_ENVIRONMENT: globalThis.IS_REACT_ACT_ENVIRONMENT }
  Object.assign(globalThis, { document: env.document, window: env.window, IS_REACT_ACT_ENVIRONMENT: true })
  const navigations = []
  let props = { organizationId: 'org', projectId: 'project', engagement: { id: 'engagement', organization_id: 'org', project_id: 'project', brand_id: 'brand' }, services: [{ id: 'service', organization_id: 'org', engagement_id: 'engagement', status: 'active', service_catalog: { department_id: 'content' } }] }
  const compiled = transformSync(readFileSync(new URL('../components/ContentWorkshopActions.jsx', import.meta.url), 'utf8'), { loader: 'jsx', format: 'cjs', jsxFactory: 'React.createElement' }).code
  const module = { exports: {} }, require = name => name === 'react-router-dom' ? { useNavigate: () => destination => navigations.push(destination) } : name.includes('contentWorkshopActions') ? { contentWorkshopActionTarget } : nativeRequire(name)
  new Function('require', 'module', 'exports', 'React', compiled)(require, module, module.exports, React)
  const root = createRoot(env.container), Component = module.exports.default
  t.after(async () => { await act(async () => root.unmount()); Object.assign(globalThis, previous) })
  const render = () => act(async () => root.render(React.createElement(Component, props)))
  const button = text => nodes(env.container).find(n => n.tagName === 'BUTTON' && n.textContent === text)
  const click = text => act(async () => propsOf(button(text)).onClick())
  await render(); await click('Open Content writer')
  assert.equal(navigations.length, 0); assert.match(env.container.textContent, /unsaved chat text/)
  await click('Stay in chat'); assert.equal(button('Open editor'), undefined)
  await click('Prepare Content request')
  props = { ...props, busy: true }; await render(); await click('Open editor'); assert.equal(navigations.length, 0)
  props = { ...props, busy: false }; await render(); await click('Open editor')
  assert.match(navigations[0], /ctxWorkshopTab=requests/)
  await click('Open Content writer')
  props = { ...props, organizationId: 'org-b' }; await render()
  assert.equal(button('Open editor'), undefined); assert.equal(propsOf(button('Open Content writer')).disabled, true)
  props = { ...props, organizationId: 'org', unavailable: true }; await render()
  assert.equal(button('Open editor'), undefined); assert.equal(navigations.length, 1)
  props = { ...props, unavailable: false }; await render()
  assert.equal(button('Open editor'), undefined)
  const parent = readFileSync(new URL('../apps/DepartmentWorkshop.jsx', import.meta.url), 'utf8')
  assert.match(parent, /departmentId === 'content' && <ContentWorkshopActions key=\{chatScopeKey\}/)
  assert.match(parent, /busy=\{chatNavigationBusy\}/)
})
