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
const workspace = title => ({ tasks: [], workItems: [], requests: [], deliverables: [], releaseVersions: [],
  reviewVersions: [{ id: title, title, version_number: 1, review_status: 'ready_for_internal_review', capabilities: { can_review: true } }] })

test('mounted My Work preserves review deeplink but resets review targets and rejects stale organization responses', async t => {
  const env = mountedEnvironment()
  const previous = { document: globalThis.document, window: globalThis.window, IS_REACT_ACT_ENVIRONMENT: globalThis.IS_REACT_ACT_ENVIRONMENT }
  Object.assign(globalThis, { document: env.document, window: env.window, IS_REACT_ACT_ENVIRONMENT: true })
  const controllerA = new AbortController()
  const onAccessError = () => false
  let organization = { activeOrganizationId: 'org-a', scopeRevision: 1, requestSignal: controllerA.signal,
    loading: false, selectionRequired: false, handleOrganizationAccessError: onAccessError }
  const params = new URLSearchParams('tab=review')
  let callsA = 0, delayedA
  const delivery = { getMyWork: async (_user, org) => {
    if (org === 'org-b') return workspace('Organization B review')
    if (++callsA === 1) return workspace('Organization A review')
    return new Promise(resolve => { delayedA = resolve })
  } }
  const source = readFileSync(new URL('../apps/MyWork.jsx', import.meta.url), 'utf8')
  const compiled = transformSync(source, { loader: 'jsx', format: 'cjs', jsxFactory: 'React.createElement' }).code
  const module = { exports: {} }
  const require = name => {
    if (name.includes('AuthContext')) return { useAuth: () => ({ user: { id: 'user-a' } }) }
    if (name.includes('OrganizationContext')) return { useOrganization: () => organization }
    if (name.endsWith('/delivery.js')) return { delivery }
    if (name.endsWith('/deliveryRepository.js')) return { TASK_TRANSITIONS: {} }
    if (name === 'react-router-dom') return { Link: props => React.createElement('a', { href: props.to }, props.children),
      useSearchParams: () => [params, next => { params.delete('tab'); params.set('tab', next.get('tab')) }] }
    return nativeRequire(name)
  }
  new Function('require', 'module', 'exports', 'React', compiled)(require, module, module.exports, React)
  const MyWork = module.exports.default
  const root = createRoot(env.container)
  t.after(async () => { await act(async () => root.unmount()); Object.assign(globalThis, previous) })
  const render = () => act(async () => { root.render(React.createElement(MyWork)); await new Promise(resolve => setTimeout(resolve, 0)) })
  await render()
  assert.match(env.container.textContent, /Internal quality review/)
  assert.match(env.container.textContent, /Organization A review/)
  const click = async text => {
    const node = nodes(env.container).find(node => node.tagName === 'BUTTON' && node.textContent === text)
    assert.ok(node, text)
    const props = node[Object.keys(node).find(key => key.startsWith('__reactProps$'))]
    await act(async () => props.onClick())
  }
  await click('Open assigned review')
  assert.match(env.container.textContent, /Record human decision/)
  organization = { ...organization, scopeRevision: 2 }
  await render()
  assert.equal(typeof delayedA, 'function')
  controllerA.abort()
  organization = { ...organization, activeOrganizationId: 'org-b', scopeRevision: 3, requestSignal: new AbortController().signal }
  await render()
  assert.match(env.container.textContent, /Organization B review/)
  assert.doesNotMatch(env.container.textContent, /Organization A review|Record human decision/)
  assert.equal(params.get('tab'), 'review')
  await act(async () => delayedA(workspace('Stale organization A response')))
  assert.match(env.container.textContent, /Organization B review/)
  assert.doesNotMatch(env.container.textContent, /Stale organization A response/)
})
