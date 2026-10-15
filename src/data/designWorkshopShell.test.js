import test from 'node:test'
import assert from 'node:assert/strict'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { readFileSync } from 'node:fs'
import { transformSync } from 'esbuild'
const source = readFileSync(new URL('../components/WorkshopContextShell.jsx', import.meta.url), 'utf8')
const compiled = transformSync(source, { loader: 'jsx', format: 'cjs', jsxFactory: 'React.createElement' }).code
const module = { exports: {} }
const require = name => name === 'react-router-dom' ? { Link: ({ to, children }) => React.createElement('a', { href: to }, children) } : { navigationRecoveryMessage: reason => `Recovery: ${reason}` }
new Function('require', 'module', 'exports', 'React', compiled)(require, module, module.exports, React)
const Shell = module.exports.default
const render = validation => renderToStaticMarkup(React.createElement(Shell, { compact: true, navigation: { status: 'present', projectId: 'p' }, validation, projectName: 'Exact project', returnTarget: '/back' }, React.createElement('div', null, 'Authorized chat')))
test('compact Design reference retains canonical pointers without repeating an outer context card', () => {
  const html = render({ status: 'ready', context: { projectId: 'p', workRecord: { kind: 'task', id: 'exact-task' }, output: { kind: 'version', id: 'exact-version' } } })
  assert.match(html, /<details class="design-navigation-reference">/)
  assert.doesNotMatch(html, /details[^>]* open/)
  assert.match(html, /exact-task/); assert.match(html, /exact-version/)
  assert.match(html, /href="\/back"/); assert.match(html, /Authorized chat/)
})
test('compact Design context never hides stale warnings or opens invalid authority', () => {
  const stale = render({ status: 'stale', reason: 'changed', context: { projectId: 'p' } })
  assert.match(stale, /role="status"/); assert.match(stale, /Recovery: changed/)
  const invalid = render({ status: 'error', reason: 'denied' })
  assert.match(invalid, /Workshop context not opened/); assert.match(invalid, /Recovery: denied/)
  assert.doesNotMatch(invalid, /Authorized chat/)
})
