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
test('appearance control presents native System Light Dark and explains browser-only System persistence', async t => {
  const env = mountedEnvironment(), previous = { document: globalThis.document, window: globalThis.window, IS_REACT_ACT_ENVIRONMENT: globalThis.IS_REACT_ACT_ENVIRONMENT }
  Object.assign(globalThis, { document: env.document, window: env.window, IS_REACT_ACT_ENVIRONMENT: true })
  const choices = [], api = { theme: 'system', setTheme: value => choices.push(value), persistenceMessage: '' }
  const compiled = transformSync(readFileSync(new URL('../components/AppearanceSelector.jsx', import.meta.url), 'utf8'), { loader: 'jsx', format: 'cjs', jsxFactory: 'React.createElement' }).code
  const module = { exports: {} }, require = name => name.includes('useTheme') ? { useTheme: () => api } : nativeRequire(name)
  new Function('require', 'module', 'exports', 'React', compiled)(require, module, module.exports, React)
  const root = createRoot(env.container)
  t.after(async () => { await act(async () => root.unmount()); Object.assign(globalThis, previous) })
  await act(async () => root.render(React.createElement(module.exports.default)))
  assert.deepEqual(nodes(env.container).filter(n => n.tagName === 'OPTION').map(n => n.textContent), ['System', 'Light', 'Dark'])
  assert.match(env.container.textContent, /browser only/)
  const select = nodes(env.container).find(n => n.tagName === 'SELECT')
  const props = select[Object.keys(select).find(k => k.startsWith('__reactProps$'))]
  await act(async () => props.onChange({ target: { value: 'dark' } })); assert.deepEqual(choices, ['dark'])
})
test('semantic text and action tokens meet normal text contrast in both palettes', () => {
  const css = readFileSync(new URL('../index.css', import.meta.url), 'utf8')
  const luminance = hex => {
    const rgb = hex.match(/[a-f\d]{2}/gi).map(v => parseInt(v, 16) / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4)
    return rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722
  }
  for (const block of [css.match(/:root \{([^}]+)\}/)[1], css.match(/:root\[data-theme="dark"\] \{([^}]+)\}/)[1]]) {
    const tokens = Object.fromEntries([...block.matchAll(/--anka-([\w-]+): (#[\da-f]+);/gi)].map(m => [m[1], m[2]]))
    for (const [foreground, background] of [['ink', 'canvas'], ['muted', 'canvas'], ['on-violet', 'violet'], ['success', 'success-soft'], ['warning', 'warning-soft'], ['danger', 'danger-soft']]) {
      const [low, high] = [luminance(tokens[foreground]), luminance(tokens[background])].sort((a, b) => a - b)
      assert.ok((high + .05) / (low + .05) >= 4.5, `${foreground}/${background}`)
    }
  }
})
