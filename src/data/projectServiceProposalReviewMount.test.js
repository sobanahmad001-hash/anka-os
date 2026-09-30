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

test('mounted service proposals require exact-value review, preserve uncertain retry, and reject stale authority', async t => {
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
  const button = label => elements(env.container, 'button').find(node => node.textContent === label)
  const click = node => act(async () => props(node).onClick(event))
  const review = () => act(async () => props(elements(env.container, 'form')[0]).onSubmit(event))
  await render()
  for (const checkbox of elements(env.container, 'input').filter(node => props(node).type === 'checkbox')) await act(async () => props(checkbox).onChange({ target: { checked: true } }))
  assert.equal(calls.length, 0)
  await review()
  const staleConfirm = props(button('Confirm and save reviewed proposals')).onClick
  assert.match(env.container.textContent, /Review proposed scope/)
  assert.match(env.container.textContent, /Website design/)
  assert.match(env.container.textContent, /Saving does not activate services/)
  assert.equal(calls.length, 0)
  const quantity = elements(env.container, 'input').find(node => props(node).type === 'number')
  await act(async () => props(quantity).onChange({ target: { value: '3' } }))
  assert.equal(button('Confirm and save reviewed proposals'), undefined)
  // A retained confirmation cannot dispatch values whose review was invalidated.
  await act(async () => staleConfirm(event))
  assert.equal(calls.length, 0)
  await review()
  assert.match(env.container.textContent, /Quantity 3/)
  await click(button('Confirm and save reviewed proposals'))
  assert.equal(calls.length, 2)
  assert.deepEqual(calls.map(command => command.action), ['add', 'add'])
  assert.equal(calls[0].quantity, 3)
  assert.equal(calls[0].unit, 'page')
  assert.equal(calls[1].recurrence, 'monthly')
  assert.equal(calls[1].quantity, 1)
  assert.match(env.container.textContent, /Response uncertain/)
  const original = calls[1]
  assert.equal(elements(env.container, 'fieldset').some(node => props(node).disabled && node.textContent.includes('Article content')), true)
  await review()
  failBeta = false
  await click(button('Confirm safe retry of reviewed proposals'))
  assert.equal(calls.length, 3)
  assert.equal(calls[2], original)
  assert.equal(button('Confirm and save reviewed proposals'), undefined)
  // Authority changes remount the scoped component. Retained handlers cannot mutate.
  membership = { organizationId: 'org', role: 'contributor' }
  await render()
  await act(async () => staleConfirm(event))
  assert.equal(calls.length, 3)
  assert.equal(elements(env.container, 'form').length, 0)
})
