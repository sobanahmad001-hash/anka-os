import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { createServer } from 'vite'
import { mountedEnvironment, elements } from './testSupport/designVideoDom.js'

// Optional read-only snapshot root. No production source is copied or modified.
const sourceRoot = process.env.ANKA_DESIGN_TEST_SOURCE_ROOT || process.cwd()
const paths = ['src/components/DesignVideoCapabilities.jsx', 'src/data/designVideoQuoteTransport.js']
const snapshots = new Map(paths.map(path => [path, readFileSync(resolve(sourceRoot, path), 'utf8')]))
for (const [path, source] of snapshots) console.log('Test source SHA256', path, createHash('sha256').update(source).digest('hex'))
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no }); return { promise, resolve, reject } }
const propsOf = node => node[Object.keys(node).find(key => key.startsWith('__reactProps$'))]
const button = (container, text) => elements(container, 'button').find(node => node.textContent.includes(text))
const connection = { id: 'connection', display_name: 'Offline fixture', provider: 'higgsfield', status: 'verified', secret_configured: true, organization_level: true, department_ids: [], secret_name: 'ANKA_HIGGSFIELD_TEST' }
let fixture
test('mounted video submission context and uncertainty regressions', async t => {
  const server = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent',
    plugins: [{ name: 'design-offline-fixture', enforce: 'pre', load(id) {
      const path = id.replaceAll('\\', '/').split('?')[0]
      for (const [relative, source] of snapshots) if (path.endsWith('/' + relative)) return source
      if (path.endsWith('/src/data/designWorkshopRepository.js')) return 'export const designWorkshop = { forOrganization: (...args) => globalThis.__designVideoFixture.studio };'
      if (path.endsWith('/src/data/integrationRepository.js')) return 'export const integrations = { listForOrganization: async organization_id => ({ organization_id, connections: globalThis.__designVideoFixture.connections }) };'
      if (path.endsWith('/src/context/OrganizationContext.jsx')) return 'export const useOrganization = () => globalThis.__designVideoFixture.scope;'
    } }] })
  t.after(() => server.close())
  const { default: Component } = await server.ssrLoadModule('/src/components/DesignVideoCapabilities.jsx')
  async function mount(t, { historyError = false } = {}) {
    const env = mountedEnvironment()
    const names = ['document', 'window', 'Event', 'Node', 'HTMLElement', 'IS_REACT_ACT_ENVIRONMENT', '__designVideoFixture', 'fetch']
    const previous = Object.fromEntries(names.map(name => [name, globalThis[name]]))
    const submit = deferred()
    const calls = []
    fixture = { scope: { activeOrganizationId: 'org-a', scopeRevision: 1, requestSignal: new AbortController().signal }, connections: [connection], rows: [], historyError }
    fixture.studio = {
      listVideoJobs: async () => { if (fixture.historyError) throw new Error('offline history failure'); return fixture.rows },
      getVideoQuote: async input => ({ paid_execution_enabled: true, organization_cap_configured: true, spend_tracking_configured: true, spend_guard_mode: 'local_monthly_cap',
        quote: { ...input, id: 'quote', provider: 'higgsfield', model_id: 'bytedance/seedance-2.5/text-to-video', currency: 'USD', max_charge_microusd: 1000000, verified_at: new Date(Date.now() - 1000).toISOString(), valid_until: new Date(Date.now() + 60000).toISOString() } }),
      generateVideo: input => { calls.push(input); return submit.promise },
    }
    Object.assign(globalThis, { document: env.document, window: env.window, Event: env.window.Event, Node: env.window.Node, HTMLElement: env.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true, __designVideoFixture: fixture,
      fetch: () => { throw new Error('Network forbidden in mounted video tests') } })
    const root = createRoot(env.container)
    t.after(async () => { await act(async () => root.unmount()); Object.assign(globalThis, previous) })
    const render = async direction => act(async () => root.render(createElement(Component, { directionVersionId: direction })))
    await render('direction-a')
    const change = async (node, value, checked) => act(async () => propsOf(node).onChange({ target: { value, checked } }))
    async function prepare() {
      await act(async () => propsOf(button(env.container, 'Check exact quote')).onClick())
      await change(elements(env.container, 'textarea')[0], 'Offline prompt')
      await change(elements(env.container, 'select').at(-1), 'connection')
      await change(elements(env.container, 'input').at(-1), undefined, true)
    }
    const submitNow = () => propsOf(elements(env.container, 'form')[0]).onSubmit({ preventDefault() {} })
    return { env, submit, calls, render, prepare, submitNow }
  }
  for (const kind of ['direction', 'organization', 'scope revision']) await t.test(kind + ' switch clears consent/prompt and old pending busy', async t => {
    const m = await mount(t); await m.prepare()
    assert.equal(propsOf(button(m.env.container, 'Generate one video')).disabled, false)
    await act(async () => { void m.submitNow() })
    assert.equal(m.calls.length, 1)
    if (kind === 'organization') fixture.scope = { ...fixture.scope, activeOrganizationId: 'org-b', requestSignal: new AbortController().signal }
    if (kind === 'scope revision') fixture.scope = { ...fixture.scope, scopeRevision: 2 }
    await m.render(kind === 'direction' ? 'direction-b' : 'direction-a')
    assert.equal(elements(m.env.container, 'textarea')[0].value, '')
    assert.equal(elements(m.env.container, 'input').at(-1).checked, false)
    assert.doesNotMatch(m.env.container.textContent, /Recording original request/)
    await act(async () => m.submit.resolve({ status: 'queued' }))
    assert.doesNotMatch(m.env.container.textContent, /Original video request recorded/)
    await m.prepare()
    assert.equal(propsOf(button(m.env.container, 'Generate one video')).disabled, false, 'new scope must not stay busy')
  })
  await t.test('rapid double submit invokes one mocked request', async t => {
    const m = await mount(t); await m.prepare()
    await act(async () => { void m.submitNow(); void m.submitNow() })
    assert.equal(m.calls.length, 1)
    assert.ok(m.calls[0].operation_key)
    await act(async () => m.submit.resolve({ status: 'queued' }))
  })
  await t.test('unknown outcome remains blocked after fresh quote and remount with unresolved history', async t => {
    const m = await mount(t); await m.prepare()
    await act(async () => { void m.submitNow() })
    fixture.rows = [{ id: 'job', status: 'outcome_unknown', mode: 'explore', duration_seconds: 5, resolution: '720p', created_at: new Date().toISOString() }]
    await act(async () => m.submit.reject(new Error('lost response')))
    await m.prepare()
    assert.equal(propsOf(button(m.env.container, 'Generate one video')).disabled, true)
    fixture.scope = { ...fixture.scope, scopeRevision: 2 }
    await m.render('direction-a'); await m.prepare()
    assert.equal(propsOf(button(m.env.container, 'Generate one video')).disabled, true)
    await act(async () => { void m.submitNow() })
    assert.equal(m.calls.length, 1)
  })
  await t.test('unavailable history fails closed despite quote and consent', async t => {
    const m = await mount(t, { historyError: true }); await m.prepare()
    assert.match(m.env.container.textContent, /history is unavailable/)
    assert.equal(propsOf(button(m.env.container, 'Generate one video')).disabled, true)
    await act(async () => { void m.submitNow() })
    assert.equal(m.calls.length, 0)
  })
})
