import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { transformSync } from 'esbuild'
const require = createRequire(import.meta.url)
const source = readFileSync(new URL('../components/MarketingToolNavigation.jsx', import.meta.url), 'utf8')
const module = { exports: {} }
new Function('require', 'module', 'exports', 'React', transformSync(source, { loader: 'jsx', format: 'cjs', jsxFactory: 'React.createElement' }).code)(require, module, module.exports, React)
const Navigation = module.exports.default

test('grouped Marketing navigation keeps every existing tool reachable once with its unchanged value', () => {
  const host = readFileSync(new URL('../apps/MarketingStudio.jsx', import.meta.url), 'utf8')
  const block = host.match(/const MARKETING_TABS = Object.freeze\(\[([\s\S]*?)\]\)/)[1]
  const tabs = [...block.matchAll(/\['([^']+)', '([^']+)'\]/g)].map(match => match.slice(1, 3))
  assert.equal(tabs.length, 13)
  const html = renderToStaticMarkup(React.createElement(Navigation, { tabs, value: 'reports', onChange: () => assert.fail('render must not navigate') }))
  assert.equal((html.match(/<option /g) || []).length, 13)
  for (const [id] of tabs) assert.equal((html.match(new RegExp(`value="${id}"`, 'g')) || []).length, 1)
  assert.match(html, /aria-label="Marketing tool"/)
  assert.match(html, /value="reports" selected=""/)
  assert.equal((html.match(/<optgroup /g) || []).length, 3)
})

test('an additional host-authorized tool is preserved rather than silently hidden by presentation groups', () => {
  const html = renderToStaticMarkup(React.createElement(Navigation, { tabs: [['future', 'Future tool']], value: 'future', onChange: () => {} }))
  assert.match(html, /value="future" selected=""/)
  assert.match(html, /Future tool/)
})
