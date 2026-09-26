import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { transformSync } from 'esbuild'
import * as navigation from '../config/environmentNav.js'
import { mountedEnvironment, elements } from './testSupport/designVideoDom.js'

const nativeRequire = createRequire(import.meta.url)
const props = node => node[Object.keys(node).find(key => key.startsWith('__reactProps$'))]

test('shell preserves scoped routes, collapse state, mobile navigation and Escape focus recovery', async t => {
  const env = mountedEnvironment()
  const previous = { document: globalThis.document, window: globalThis.window, IS_REACT_ACT_ENVIRONMENT: globalThis.IS_REACT_ACT_ENVIRONMENT }
  Object.assign(globalThis, { document: env.document, window: env.window, IS_REACT_ACT_ENVIRONMENT: true })
  let location = { pathname: '/sphere/design' }
  let profile = { role: 'member', full_name: 'Test User' }
  let membership = { organizationId: 'org-a', role: 'member', departmentId: 'design' }
  const navigated = []
  let signedOut = 0
  const components = {}
  function load(name) {
    if (components[name]) return components[name]
    const source = readFileSync(new URL(`../components/${name}.jsx`, import.meta.url), 'utf8')
    const compiled = transformSync(source, { loader: 'jsx', format: 'cjs', jsxFactory: 'React.createElement' }).code
    const module = { exports: {} }
    const require = name => {
      if (name.includes('AuthContext')) return { useAuth: () => ({ profile, signOut: () => signedOut++ }) }
      if (name.includes('OrganizationContext')) return { useOrganization: () => ({ activeMembership: membership, memberships: [], activeOrganizationId: 'org-a', selectOrganization() {} }) }
      if (name.includes('environmentNav')) return navigation
      if (name.includes('featureFlags')) return { featureFlags: { aiAssistance: true } }
      if (name.includes('useNotifications')) return { useNotifications: () => ({ notifications: [], unread: 0, markRead() {}, markAllRead() {} }) }
      if (name.includes('AppearanceSelector')) return { __esModule: true, default: () => React.createElement('select', { 'aria-label': 'Appearance' }, ...['System', 'Light', 'Dark'].map(value => React.createElement('option', { key: value }, value))) }
      if (name.includes('OrganizationGate')) return { __esModule: true, default: ({ children }) => children }
      if (name.includes('AssistantFloat')) return { __esModule: true, default: () => null }
      if (name.endsWith('.css')) return {}
      if (name === './Header' || name === './Sidebar') return { __esModule: true, default: load(name.slice(2)) }
      if (name === 'react-router-dom') return { useLocation: () => location, useNavigate: () => path => navigated.push(path), Outlet: () => React.createElement('p', null, 'Actual workspace'), Link: ({ to, ...rest }) => React.createElement('a', { ...rest, href: to }) }
      return nativeRequire(name)
    }
    new Function('require', 'module', 'exports', 'React', compiled)(require, module, module.exports, React)
    return (components[name] = module.exports.default)
  }
  const Layout = load('Layout')
  const root = createRoot(env.container)
  t.after(async () => { await act(async () => root.unmount()); Object.assign(globalThis, previous) })
  const render = () => act(async () => root.render(React.createElement(Layout)))
  const button = label => elements(env.container, 'button').find(node => props(node)['aria-label'] === label)
  const click = node => act(async () => props(node).onClick())
  const escape = () => act(async () => { const event = new env.window.Event('keydown'); event.key = 'Escape'; env.document.dispatchEvent(event) })
  await render()
  assert.equal(elements(env.container, 'select').some(node => props(node)['aria-label'] === 'Appearance'), true)
  assert.equal(elements(env.container, 'a').some(node => props(node).href === '#main-workspace'), true)
  const sidebar = () => elements(env.container, 'aside')[0]
  const links = () => elements(sidebar(), 'a').map(node => props(node).href)
  assert.ok(links().includes('/sphere/design'))
  assert.ok(!links().includes('/sphere/content'))
  assert.ok(!links().includes('/settings'))
  const originalLinks = links()
  await click(button('Collapse sidebar'))
  assert.equal(props(button('Expand sidebar'))['aria-expanded'], false)
  assert.doesNotMatch(props(sidebar()).className, /md:flex/)
  assert.deepEqual(links(), originalLinks)
  await click(button('Expand sidebar'))
  assert.match(props(sidebar()).className, /md:flex/)
  const mobileToggle = button('Open workspace navigation')
  await click(mobileToggle)
  assert.equal(props(mobileToggle)['aria-expanded'], true)
  await escape()
  assert.equal(props(mobileToggle)['aria-expanded'], false)
  assert.equal(env.document.activeElement, mobileToggle)
  await click(mobileToggle)
  const mobileNav = elements(env.container, 'nav').find(node => props(node).id === 'workspace-mobile-navigation')
  const design = elements(mobileNav, 'button').find(node => node.textContent === 'Design Workshop')
  assert.equal(props(design)['aria-current'], 'page')
  await click(design)
  assert.equal(navigated.at(-1), '/sphere/design')
  assert.equal(props(mobileToggle)['aria-expanded'], false)
  const notificationToggle = button('Open notifications')
  await click(notificationToggle)
  assert.match(env.container.textContent, /No notifications yet/)
  await escape()
  assert.equal(props(notificationToggle)['aria-expanded'], false)
  assert.equal(env.document.activeElement, notificationToggle)
  await click(button('Sign out'))
  assert.equal(signedOut, 1)
  profile = { ...profile, role: 'admin' }
  membership = { ...membership, role: 'system_owner' }
  location = { pathname: '/sphere/workspace' }
  await render()
  assert.ok(links().includes('/settings'))
  assert.ok(links().includes('/sphere/content'))
  assert.ok(elements(env.container, 'button').some(node => node.textContent === 'Administration'))
})

test('responsive shell styles are scoped and semantic without recoloring workspace content', () => {
  const css = readFileSync(new URL('../components/workspaceShell.css', import.meta.url), 'utf8')
  assert.match(css, /max-width: 767px/)
  assert.match(css, /100dvh/)
  assert.match(css, /focus-visible/)
  assert.match(css, /prefers-reduced-motion/)
  assert.match(css, /var\(--anka-surface\)/)
  assert.doesNotMatch(css, /filter\s*:|\.anka-workspace\s|!important/)
})
