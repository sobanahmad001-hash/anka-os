import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { transformSync } from 'esbuild'
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { mountedEnvironment } from './testSupport/designVideoDom.js'

const require = createRequire(import.meta.url)
test('private video busy blocks real router, organization switch and unload until recovery', async t => {
  const env = mountedEnvironment()
  const previous = { window: globalThis.window, document: globalThis.document, IS_REACT_ACT_ENVIRONMENT: globalThis.IS_REACT_ACT_ENVIRONMENT }
  const listeners = new Map()
  env.window.addEventListener = (type, fn) => listeners.set(type, [...(listeners.get(type) || []), fn])
  env.window.removeEventListener = (type, fn) => listeners.set(type, (listeners.get(type) || []).filter(item => item !== fn))
  Object.assign(globalThis, { window: env.window, document: env.document, IS_REACT_ACT_ENVIRONMENT: true })
  let controls
  const source = readFileSync(new URL('../components/PrivateDesignVideoTools.jsx', import.meta.url), 'utf8')
  const compiled = transformSync(source, { loader: 'jsx', format: 'cjs', jsxFactory: 'React.createElement' }).code
  const module = { exports: {} }
  new Function('require', 'module', 'exports', 'React', compiled)(name => {
    if (name.endsWith('DesignVideoCapabilities.jsx')) return { __esModule: true, default: props => { controls = props; return null } }
    if (name.endsWith('OrganizationContext.jsx')) return { useOrganization: () => ({ activeOrganizationId: 'org-a' }) }
    return require(name)
  }, module, module.exports, React)
  const reports = []
  const router = createMemoryRouter([
    { path: '/private', element: React.createElement(module.exports.default, { conversationId: 'saved-private', onNavigationBusyChange: value => reports.push(value) }) },
    { path: '/elsewhere', element: React.createElement('p', null, 'Elsewhere') },
  ], { initialEntries: ['/private'] })
  const root = createRoot(env.container)
  t.after(async () => { await act(async () => root.unmount()); router.dispose(); Object.assign(globalThis, previous) })
  await act(async () => root.render(React.createElement(RouterProvider, { router })))
  const dispatch = (type, organizationId) => {
    const event = { detail: { organizationId }, defaultPrevented: false, preventDefault() { this.defaultPrevented = true } }
    for (const fn of listeners.get(type) || []) fn(event)
    return event
  }
  // Canonical child reports true for pending/unknown generation and uncertain promotion.
  await act(async () => controls.onNavigationBusyChange(true))
  await act(async () => router.navigate('/elsewhere'))
  assert.equal(router.state.location.pathname, '/private')
  assert.match(env.container.textContent, /needs recovery before leaving/)
  assert.equal(dispatch('anka:organization-change', 'org-b').defaultPrevented, true)
  assert.equal(dispatch('anka:organization-change', 'org-a').defaultPrevented, false)
  const unload = dispatch('beforeunload')
  assert.equal(unload.defaultPrevented, true)
  assert.equal(unload.returnValue, '')
  assert.equal(reports.at(-1), true)
  await act(async () => controls.onNavigationBusyChange(false))
  assert.equal(router.state.location.pathname, '/private', 'recovery cancels, never silently replays a blocked navigation')
  assert.equal(dispatch('anka:organization-change', 'org-b').defaultPrevented, false)
  assert.equal(dispatch('beforeunload').defaultPrevented, false)
  await act(async () => router.navigate('/elsewhere'))
  assert.equal(router.state.location.pathname, '/elsewhere')
  assert.equal((listeners.get('beforeunload') || []).length, 0)
})
