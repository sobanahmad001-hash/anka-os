import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { transformSync } from 'esbuild'
import { mountedEnvironment, elements } from './testSupport/designVideoDom.js'
import { organizationId, projectId, actor, threadId, requestId, humanId, assistantId } from '../../tools/direct-chat-fixture.js'
const nativeRequire = createRequire(import.meta.url)
const props = node => node?.[Object.keys(node).find(key => key.startsWith('__reactProps$'))]
const scope = () => ({ activeOrganizationId: organizationId, scopeRevision: 1, requestSignal: new AbortController().signal, handleOrganizationAccessError() {} })
const workspace = () => ({ engagement: { id: threadId, organization_id: organizationId, project_id: projectId, brand_id: actor }, organizationSettings: { default_language: 'English' }, stages: [], approvals: [], copyRoots: [],
  artifacts: [{ id: requestId, organization_id: organizationId, engagement_id: threadId, artifact_type: 'content', title: 'Existing article' }],
  versions: [{ id: humanId, organization_id: organizationId, artifact_id: requestId, version_number: 1, content: { schema_version: 2, output_type: 'blog_article', working_title: 'Existing article', destination: 'Launch article', objective: 'Explain', audience: 'Team', language: 'English', body: 'Keep alpha and omega.', exclusions: [] }, data_classification: 'internal' }] })
async function mount(t, overrides = {}) {
  const env = mountedEnvironment(), previous = { document: globalThis.document, window: globalThis.window, confirm: globalThis.confirm, IS_REACT_ACT_ENVIRONMENT: globalThis.IS_REACT_ACT_ENVIRONMENT }
  Object.assign(globalThis, { document: env.document, window: env.window, confirm: () => true, IS_REACT_ACT_ENVIRONMENT: true })
  let organization = scope()
  const calls = [], states = [], components = {}
  const data = workspace()
  const studio = { saveArtifact: async command => { calls.push(command); return { version_id: assistantId } }, copyContentWriterVersion: assert.fail, ...overrides.studio }
  let refreshes = 0
  const input = { workspace: data, studio, refresh: async () => { refreshes++; return true }, onStateChange: state => states.push(state), ...overrides.input }
  function load(name) {
    if (components[name]) return components[name]
    const compiled = transformSync(readFileSync(new URL(`../components/${name}.jsx`, import.meta.url), 'utf8'), { loader: 'jsx', format: 'cjs', jsxFactory: 'React.createElement' }).code
    const module = { exports: {} }
    const require = source => source.includes('OrganizationContext') ? { useOrganization: () => organization } : source === './ContentWriterEditor.jsx' ? { __esModule: true, default: load('ContentWriterEditor') } : nativeRequire(source)
    new Function('require', 'module', 'exports', 'React', compiled)(require, module, module.exports, React)
    return (components[name] = module.exports.default)
  }
  const root = createRoot(env.container), Component = load('ContentChatWriterPane')
  t.after(async () => { await act(async () => root.unmount()); Object.assign(globalThis, previous) })
  const render = () => act(async () => root.render(React.createElement(Component, input)))
  const button = label => elements(env.container, 'button').find(node => node.textContent === label)
  const click = node => act(async () => props(node).onClick({ preventDefault() {} }))
  const field = label => elements(env.container, 'label').find(node => node.textContent.startsWith(label))
  const textarea = label => elements(field(label), 'textarea')[0]
  await render(); await click(button('Continue from exact v1'))
  return { env, calls, data, studio, states, input, render, button, click, textarea, organization: () => organization, setOrganization: value => { organization = value }, refreshes: () => refreshes }
}
test('canonical side writer applies only a selected range and appends the exact unapproved parent version once', async t => {
  const f = await mount(t)
  const body = f.textarea('Draft text'); body.selectionStart = 5; body.selectionEnd = 10
  await f.click(f.button('Use selected text'))
  await act(async () => props(f.textarea('Replacement')).onChange({ target: { value: 'beta' } }))
  await f.click(f.button('Apply to working draft'))
  assert.equal(props(f.textarea('Draft text')).value, 'Keep beta and omega.')
  assert.equal(f.data.versions[0].content.body, 'Keep alpha and omega.')
  assert.equal(f.calls.length, 0)
  assert(f.states.some(state => state.dirty))
  await act(async () => props(elements(f.env.container, 'form')[0]).onSubmit({ preventDefault() {} }))
  const confirm = props(f.button('Confirm unapproved draft')).onClick
  await act(async () => Promise.all([confirm(), confirm()]))
  assert.equal(f.calls.length, 1)
  assert.equal(f.calls[0].artifact_id, requestId)
  assert.equal(f.calls[0].expected_parent_version_id, humanId)
  assert.equal(f.calls[0].engagement_id, threadId)
  assert.equal(f.calls[0].content.body, 'Keep beta and omega.')
  assert.equal(f.calls[0].ai_use_allowed, false)
  assert.equal(f.refreshes(), 1)
  assert.match(f.env.container.textContent, /unapproved immutable version/)
})
test('save uncertainty blocks retained confirmation without a blind retry or approval mutation', async t => {
  let calls = 0
  const f = await mount(t, { studio: { saveArtifact: async () => { calls++; throw new Error('Response lost') } } })
  await act(async () => props(elements(f.env.container, 'form')[0]).onSubmit({ preventDefault() {} }))
  const confirm = props(f.button('Confirm unapproved draft')).onClick
  await act(async () => confirm())
  assert.equal(calls, 1)
  assert.match(f.env.container.textContent, /save outcome needs review/)
  await act(async () => confirm())
  assert.equal(calls, 1)
  assert.equal(props(f.button('Confirm unapproved draft')).disabled, true)
})
test('aborted or foreign scope rejects retained saves before the canonical repository is called', async t => {
  const f = await mount(t)
  await act(async () => props(elements(f.env.container, 'form')[0]).onSubmit({ preventDefault() {} }))
  const confirm = props(f.button('Confirm unapproved draft')).onClick
  f.setOrganization({ ...f.organization(), activeOrganizationId: actor, scopeRevision: 2 })
  await f.render()
  await act(async () => confirm())
  assert.equal(f.calls.length, 0)
  assert.match(f.env.container.textContent, /unavailable in this context/)
})
