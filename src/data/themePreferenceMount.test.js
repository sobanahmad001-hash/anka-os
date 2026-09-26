import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { transformSync } from 'esbuild'
import { mountedEnvironment } from './testSupport/n1bMountedDom.js'
import * as utilities from './themePreference.js'
const nativeRequire = createRequire(import.meta.url)
test('mounted theme isolates account preferences, rejects late reads, honors OS only in system and serializes explicit writes', async t => {
  const env = mountedEnvironment(), keys = ['document', 'window', 'IS_REACT_ACT_ENVIRONMENT', 'localStorage', 'matchMedia']
  const previous = Object.fromEntries(keys.map(key => [key, globalThis[key]]))
  const attributes = new Map(); env.document.documentElement = { setAttribute: (key, value) => attributes.set(key, value) }
  const stored = new Map(), listeners = new Set(), media = { matches: false, addEventListener: (_, fn) => listeners.add(fn), removeEventListener: (_, fn) => listeners.delete(fn) }
  Object.assign(globalThis, { document: env.document, window: env.window, IS_REACT_ACT_ENVIRONMENT: true,
    localStorage: { getItem: key => stored.get(key), setItem: (key, value) => stored.set(key, value) }, matchMedia: () => media })
  let user = null, api
  const reads = new Map(), writes = [], writeResolvers = []
  const supabase = { from: () => ({ select: () => ({ eq: (_, id) => ({ maybeSingle: () => new Promise(resolve => reads.set(id, resolve)) }) }),
    upsert: value => { writes.push(value); return new Promise(resolve => writeResolvers.push(resolve)) } }) }
  const compiled = transformSync(readFileSync(new URL('../hooks/useTheme.jsx', import.meta.url), 'utf8'), { loader: 'jsx', format: 'cjs', jsxFactory: 'React.createElement' }).code
  const module = { exports: {} }, require = name => name.includes('AuthContext') ? { useAuth: () => ({ user }) } : name.includes('/supabase') ? { supabase } : name.includes('themePreference') ? utilities : nativeRequire(name)
  new Function('require', 'module', 'exports', 'React', compiled)(require, module, module.exports, React)
  const { ThemeProvider, useTheme } = module.exports
  function Probe() { api = useTheme(); return React.createElement('p', null, `${api.theme}/${api.resolvedTheme}`) }
  const root = createRoot(env.container)
  t.after(async () => { await act(async () => root.unmount()); Object.assign(globalThis, previous) })
  const tick = () => new Promise(resolve => setTimeout(resolve, 0))
  const render = () => act(async () => { root.render(React.createElement(ThemeProvider, null, React.createElement(Probe))); await tick() })
  await render(); assert.equal(api.theme, 'system'); assert.equal(api.resolvedTheme, 'light'); assert.equal(listeners.size, 1)
  await act(async () => { media.matches = true; listeners.forEach(fn => fn()) }); assert.equal(api.resolvedTheme, 'dark')
  await act(async () => { await api.setTheme('light') }); assert.equal(api.resolvedTheme, 'light'); assert.equal(listeners.size, 0)
  user = { id: 'a' }; await render(); assert.equal(api.theme, 'system')
  await act(async () => { await api.setTheme('system'); reads.get('a')({ data: { theme: 'dark' } }) }); assert.equal(api.theme, 'system')
  user = { id: 'b' }; await render()
  await act(async () => { reads.get('a')({ data: { theme: 'light' } }); reads.get('b')({ data: null }); await tick() })
  assert.equal(api.theme, 'system')
  await act(async () => { void api.setTheme('dark'); void api.setTheme('light'); await tick() })
  assert.equal(writes.length, 1); assert.equal(writes[0].user_id, 'b'); assert.equal(writes[0].theme, 'dark')
  await act(async () => { writeResolvers[0]({ error: null }); await tick() }); assert.equal(writes.length, 2)
  await act(async () => { writeResolvers[1]({ error: Error('save failed') }); await tick() })
  assert.match(api.persistenceMessage, /could not be saved/); assert.equal(api.theme, 'light')
  await act(async () => { await api.setTheme('system') }); assert.equal(writes.some(row => row.theme === 'system'), false)
  assert.equal(attributes.get('data-theme'), 'dark'); assert.equal(attributes.get('data-theme-preference'), 'system')
  user = null; await render(); assert.equal(api.theme, 'light'); assert.equal(api.persistenceMessage, '')
  globalThis.localStorage = { getItem() { throw Error('blocked') }, setItem() { throw Error('blocked') } }
  await act(async () => { await api.setTheme('dark') }); assert.match(api.persistenceMessage, /storage is unavailable/)
  await act(async () => { assert.equal(await api.setTheme('invalid'), false) }); assert.equal(api.theme, 'dark')
})
