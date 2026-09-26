import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { transformSync } from 'esbuild'
import { mountedEnvironment, elements } from './testSupport/designVideoDom.js'
import * as guards from './designChatTools.js'
import { workspace } from './designChatTools.test.js'

const nativeRequire = createRequire(import.meta.url)
const props = node => node[Object.keys(node).find(key => key.startsWith('__reactProps$'))]
test('actual inline image controls preserve exact uncertain identity, idle mounting and stale-scope dispatch guards', async t => {
  const env = mountedEnvironment()
  const names = ['document', 'window', 'IS_REACT_ACT_ENVIRONMENT', 'fetch']
  const previous = Object.fromEntries(names.map(name => [name, globalThis[name]]))
  Object.assign(globalThis, { document: env.document, window: env.window, IS_REACT_ACT_ENVIRONMENT: true, fetch: () => { throw new Error('Network forbidden') } })
  let context = { activeOrganizationId: 'org-a', activeMembership: { departmentId: 'design' }, scopeRevision: 1, requestSignal: new AbortController().signal }
  let data = workspace(), fail = true, delayedLoad = null
  const calls = [], navigation = []
  const studio = { load: async () => delayedLoad ? delayedLoad.promise : data,
    generateImage: async (...args) => { calls.push(args); if (fail) throw new Error('Lost response'); return { id: 'durable-job' } },
    listVideoJobs: async () => [],
  }
  const modules = {}
  function load(name) {
    if (modules[name]) return modules[name]
    const source = readFileSync(new URL(`../components/${name}.jsx`, import.meta.url), 'utf8')
    const compiled = transformSync(source, { loader: 'jsx', format: 'cjs', jsxFactory: 'React.createElement' }).code
    const module = { exports: {} }
    const require = path => {
      if (path.includes('OrganizationContext')) return { useOrganization: () => context }
      if (path.includes('designWorkshopRepository')) return { designWorkshop: { forOrganization: () => studio } }
      if (path.includes('designWorkshopContext')) return { designCapabilities: membership => ({ executeGeneration: membership?.departmentId === 'design' }) }
      if (path.includes('designChatTools.js')) return guards
      if (path.includes('integrationRepository')) return { integrations: { listForOrganization: async organization_id => ({ organization_id, connections: [] }) } }
      if (path.startsWith('./Design')) return { __esModule: true, default: load(path.slice(2, -4)) }
      if (path.startsWith('../data/')) return nativeRequire(path.replace('../data/', './'))
      return nativeRequire(path)
    }
    new Function('require', 'module', 'exports', 'React', compiled)(require, module, module.exports, React)
    return (modules[name] = module.exports.default)
  }
  const Component = load('DesignChatTools'), root = createRoot(env.container)
  const report = value => navigation.push(value)
  const engagement = data.engagement
  const render = () => act(async () => root.render(React.createElement(Component, { engagement, onNavigationBusyChange: report })))
  t.after(async () => { await act(async () => root.unmount()); Object.assign(globalThis, previous) })
  const button = text => elements(env.container, 'button').find(node => node.textContent === text)
  const select = () => elements(env.container, 'select').find(node => props(node)['aria-label'] === 'Exact direction version')
  const click = node => act(async () => props(node).onClick())
  await render()
  assert.equal(calls.length, 0)
  assert.equal(elements(env.container, 'textarea').length, 0)
  await act(async () => props(select()).onChange({ target: { value: 'version-a' } }))
  await click(button('Image'))
  assert.equal(calls.length, 0)
  await click(button('Generate image'))
  assert.equal(calls.length, 1)
  assert.deepEqual(calls[0].slice(0, 3), ['version-a', 'model-a', 'Exact original prompt'])
  assert.equal(navigation.at(-1), true)
  assert.equal(props(select()).disabled, true)
  assert.equal(props(elements(env.container, 'textarea')[0]).disabled, true)
  await click(button('Video'))
  assert.match(env.container.textContent, /No current quote/)
  await click(button('Image'))
  fail = false
  await click(button('Reconcile request'))
  assert.equal(calls.length, 2)
  assert.deepEqual(calls[1], calls[0], 'reconcile must reuse model, prompt, version and operation key')
  assert.equal(navigation.at(-1), false)
  let resolve
  delayedLoad = { promise: new Promise(done => { resolve = done }) }
  await act(async () => { void props(button('Generate image')).onClick() })
  context = { ...context, activeOrganizationId: 'org-b', scopeRevision: 2, requestSignal: new AbortController().signal }
  await render()
  await act(async () => resolve(data))
  assert.equal(calls.length, 2, 'old exact scope must not dispatch after fresh load resolves')
  assert.equal(elements(env.container, 'option').length, 1, 'cross-org versions are not listed')
  delayedLoad = null; context = { ...context, activeOrganizationId: 'org-a', scopeRevision: 3 }
  await render()
  await act(async () => props(select()).onChange({ target: { value: 'version-a' } }))
  await click(button('Image'))
  data = { ...data, designServices: [] }
  await click(button('Generate image'))
  assert.equal(calls.length, 2, 'deactivated service blocks dispatch after fresh load')
})
