import assert from 'node:assert/strict'
import test from 'node:test'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { createServer } from 'vite'
import { mountedEnvironment, elements } from './testSupport/designVideoDom.js'
const propsOf = node => node[Object.keys(node).find(key => key.startsWith('__reactProps$'))]
const button = (root, text) => elements(root, 'button').find(node => node.textContent.includes(text))
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no }); return { promise, resolve, reject } }
test('private image explicit project promotion stays bound to exact context and intent', async t => {
  const server = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent' })
  t.after(() => server.close())
  const { default: Panel } = await server.ssrLoadModule('/src/components/DesignPrivateImagePanel.jsx')
  async function setup(t) {
    const env = mountedEnvironment()
    const names = ['document', 'window', 'Event', 'Node', 'HTMLElement', 'IS_REACT_ACT_ENVIRONMENT', 'fetch']
    const previous = Object.fromEntries(names.map(name => [name, globalThis[name]]))
    Object.assign(globalThis, { document: env.document, window: env.window, Event: env.window.Event, Node: env.window.Node, HTMLElement: env.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true, fetch: () => { throw new Error('Network forbidden') } })
    const preview = deferred(), promotion = deferred(), calls = []
    let attempts = 0
    const props = {
      brief: { id: 'brief-a', organization_id: 'org-a', frozen_version_id: 'v1' },
      records: { versions: [{ id: 'v1', version_number: 1 }], jobs: [{ id: 'job-a', status: 'succeeded', creative_brief_version_id: 'v1' }], models: [], connections: [], promotions: [] },
      engagements: ['a', 'b'].map(id => ({ id, name: id, engagement_services: [{ id: 'service-' + id, status: 'active', service_catalog: { department_id: 'design', name: 'Design' } }] })),
      canGenerate: false, onReload: async () => {},
      studio: { previewPrivatePromotion: async input => { calls.push(['preview', input]); return preview.promise },
        promotePrivateImage: input => { calls.push(['confirm', input]); return ++attempts === 1 ? promotion.promise : Promise.resolve({}) } },
    }
    const root = createRoot(env.container)
    t.after(async () => { await act(async () => root.unmount()); Object.assign(globalThis, previous) })
    const render = async next => act(async () => root.render(createElement(Panel, next || props)))
    await render()
    const select = async (index, value) => act(async () => propsOf(elements(env.container, 'select').at(index)).onChange({ target: { value } }))
    async function choose() { await select(-3, 'job-a'); await select(-2, 'a'); await select(-1, 'service-a') }
    const previewClick = () => propsOf(button(env.container, 'Preview exact promotion')).onClick()
    const confirmClick = () => propsOf(button(env.container, 'Confirm unapproved') || button(env.container, 'Retry exact')).onClick()
    const previewValue = { checksum: 'exact-checksum', job: { id: 'job-a' }, engagement: { name: 'a' }, name: 'draft' }
    return { env, props, render, select, choose, preview, promotion, calls, previewClick, confirmClick, previewValue }
  }
  await t.test('target change during preview discards the late result', async t => {
    const m = await setup(t); await m.choose()
    await act(async () => { void m.previewClick() })
    await m.select(-2, 'b')
    await act(async () => m.preview.resolve(m.previewValue))
    assert.equal(button(m.env.container, 'Confirm unapproved'), undefined)
    assert.equal(m.calls.filter(([kind]) => kind === 'confirm').length, 0)
    await m.select(-1, 'service-b')
    assert.equal(propsOf(button(m.env.container, 'Preview exact promotion')).disabled, false)
  })
  await t.test('brief context change cannot restore old preview', async t => {
    const m = await setup(t); await m.choose()
    await act(async () => { void m.previewClick() })
    await m.render({ ...m.props, brief: { ...m.props.brief, id: 'brief-b' } })
    await act(async () => m.preview.resolve(m.previewValue))
    assert.equal(button(m.env.container, 'Confirm unapproved'), undefined)
    assert.equal(elements(m.env.container, 'select').at(-2).value, '')
  })
  await t.test('double confirmation sends once and lost response retries exact key and target', async t => {
    const m = await setup(t); await m.choose()
    await act(async () => { void m.previewClick(); m.preview.resolve(m.previewValue) })
    await act(async () => { void m.confirmClick(); void m.confirmClick() })
    assert.equal(m.calls.filter(([kind]) => kind === 'confirm').length, 1)
    await m.select(-2, 'b')
    assert.equal(propsOf(elements(m.env.container, 'select').at(-2)).value, 'a')
    await act(async () => m.promotion.reject(new Error('lost response')))
    await act(async () => m.confirmClick())
    const requests = m.calls.filter(([kind]) => kind === 'confirm').map(([, input]) => input)
    assert.equal(requests.length, 2); assert.deepEqual(requests[1], requests[0])
    assert.equal(requests[0].expected_preview_checksum, 'exact-checksum')
    assert.equal(requests[0].target_engagement_id, 'a')
    assert.ok(requests[0].operation_key)
  })
  await t.test('context change during confirmation drops old completion and busy state', async t => {
    const m = await setup(t); await m.choose()
    await act(async () => { void m.previewClick(); m.preview.resolve(m.previewValue) })
    await act(async () => { void m.confirmClick() })
    await m.render({ ...m.props, brief: { ...m.props.brief, organization_id: 'org-b' } })
    await act(async () => m.promotion.resolve({}))
    assert.equal(button(m.env.container, 'Confirm unapproved'), undefined)
    await m.choose()
    assert.equal(propsOf(button(m.env.container, 'Preview exact promotion')).disabled, false)
    assert.equal(m.calls.filter(([kind]) => kind === 'confirm').length, 1)
  })
})
