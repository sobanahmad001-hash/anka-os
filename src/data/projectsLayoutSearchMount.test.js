import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { transformSync } from 'esbuild'
import { mountedEnvironment, elements } from './testSupport/designVideoDom.js'
import * as proposalQueue from './projectServiceProposalQueue.js'
import * as authority from './authorityAdministration.js'
const nativeRequire = createRequire(import.meta.url)
const props = node => node?.[Object.keys(node).find(key => key.startsWith('__reactProps$'))]
const event = { preventDefault() {} }

test('Projects service search retains selected scope and never dispatches mutations', async t => {
  const env = mountedEnvironment()
  const previous = { document: globalThis.document, window: globalThis.window, IS_REACT_ACT_ENVIRONMENT: globalThis.IS_REACT_ACT_ENVIRONMENT }
  Object.assign(globalThis, { document: env.document, window: env.window, IS_REACT_ACT_ENVIRONMENT: true })
  const calls = []
  let failBeta = true
  const snapshot = { catalog: [{ id: 'alpha', name: 'Website design', unit: 'page', recurrence: 'one-time', department_id: 'design' }, { id: 'beta', name: 'Article content', unit: 'article', recurrence: 'monthly', department_id: 'content' }], scopes: [], members: [{ id: 'owner', name: 'Existing owner' }], impact: {} }
  const compiled = transformSync(readFileSync(new URL('../apps/ProjectServiceScopePanel.jsx', import.meta.url), 'utf8'), { loader: 'jsx', format: 'cjs', jsxFactory: 'React.createElement' }).code
  const module = { exports: {} }
  const require = name => {
    if (name.includes('AuthContext')) return { useAuth: () => ({ user: { id: 'actor' } }) }
    if (name.includes('authorityAdministration')) return authority
    if (name.includes('projectServiceProposalQueue')) return proposalQueue
    if (name.includes('projectDraftRepository')) return { projectDraftRepository: { hasOwnManagerBinding: async () => false } }
    if (name.includes('projectServiceScopeRepository')) return { projectServiceScopeRepository: { snapshot: async () => snapshot, change: async command => { calls.push(command); if (command.serviceId === 'beta' && failBeta) throw new Error('Response uncertain') } } }
    return nativeRequire(name)
  }
  new Function('require', 'module', 'exports', 'React', compiled)(require, module, module.exports, React)
  const root = createRoot(env.container), Component = module.exports.default
  t.after(async () => { await act(async () => root.unmount()); Object.assign(globalThis, previous) })
  let membership = { organizationId: 'org', role: 'operations_admin' }
  const input = { project: { id: 'project', status: 'active' }, organizationId: 'org', scopeRevision: 1, requestSignal: new AbortController().signal, onChanged() {} }
  const render = () => act(async () => { root.render(React.createElement(Component, { ...input, membership })); await new Promise(resolve => setTimeout(resolve, 0)) })
  const review = () => act(async () => props(elements(env.container, 'form')[0]).onSubmit(event))
  await render()
  const changeSearch = value => act(async () => props(elements(env.container, 'input').find(node => props(node).type === 'search')).onChange({ target: { value } }))
  await changeSearch('website')
  let choices = elements(env.container, 'input').filter(node => props(node).type === 'checkbox')
  assert.equal(choices.length, 1)
  await act(async () => props(choices[0]).onChange({ target: { checked: true } }))
  await changeSearch('content')
  assert.match(env.container.textContent, /1 selected/)
  assert.equal(elements(env.container, 'input').filter(node => props(node).type === 'checkbox').length, 1)
  assert.match(env.container.textContent, /Website design/)
  await changeSearch('no matching phrase')
  assert.match(env.container.textContent, /No matching services/)
  assert.match(env.container.textContent, /1 selected/)
  await review()
  assert.match(env.container.textContent, /Review proposed scope/)
  assert.equal(calls.length, 0)
  await changeSearch('')
  assert.equal(elements(env.container, 'input').filter(node => props(node).type === 'checkbox').length, 2)
  assert.equal(calls.length, 0)
})
