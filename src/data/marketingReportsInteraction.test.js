import assert from 'node:assert/strict'
import test from 'node:test'
import { act, createElement, StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { createServer } from 'vite'

import { marketingReportContentChecksum } from './marketingReports.js'

class TestEvent { constructor(type) { this.type = type; this.bubbles = true; this.defaultPrevented = false } preventDefault() { this.defaultPrevented = true } stopPropagation() {} }
class TestNode {
  constructor(type, name, document = null) { this.nodeType = type; this.nodeName = name; this.ownerDocument = document; this.parentNode = null; this.childNodes = []; this.listeners = new Map() }
  appendChild(node) { node.parentNode = this; this.childNodes.push(node); return node }
  insertBefore(node, before) { const index = this.childNodes.indexOf(before); if (index < 0) return this.appendChild(node); node.parentNode = this; this.childNodes.splice(index, 0, node); return node }
  removeChild(node) { this.childNodes.splice(this.childNodes.indexOf(node), 1); node.parentNode = null; return node }
  addEventListener(type, listener) { this.listeners.set(type, [...(this.listeners.get(type) || []), listener]) }
  removeEventListener(type, listener) { this.listeners.set(type, (this.listeners.get(type) || []).filter(item => item !== listener)) }
  contains(node) { return node === this || this.childNodes.some(child => child.contains?.(node)) }
  get firstChild() { return this.childNodes[0] || null }
  get lastChild() { return this.childNodes.at(-1) || null }
  get nextSibling() { return this.parentNode?.childNodes[this.parentNode.childNodes.indexOf(this) + 1] || null }
  get textContent() { return this.nodeType === 3 ? this.data : this.childNodes.map(node => node.textContent).join('') }
  set textContent(value) { if (this.nodeType === 3) this.data = String(value); else { this.childNodes = []; if (value) this.appendChild(this.ownerDocument.createTextNode(value)) } }
}
class TestElement extends TestNode {
  constructor(tag, document, namespaceURI = 'http://www.w3.org/1999/xhtml') { super(1, tag.toUpperCase(), document); this.tagName = this.nodeName; this.namespaceURI = namespaceURI; this.attributes = new Map(); this.style = { setProperty() {}, removeProperty() {} }; this._value = ''; this.selected = false; this.disabled = false }
  get options() { return this.tagName === 'SELECT' ? this.childNodes.filter(node => node.tagName === 'OPTION') : undefined }
  get value() { return this.tagName === 'SELECT' ? this.options.find(option => option.selected)?.value ?? this._value : this._value }
  set value(value) { this._value = String(value); if (this.tagName === 'SELECT') for (const option of this.options) option.selected = option.value === this._value }
  setAttribute(name, value) { this.attributes.set(name, String(value)); if (name === 'value') this.value = value; if (name === 'disabled') this.disabled = true }
  getAttribute(name) { return this.attributes.get(name) ?? null }
  removeAttribute(name) { this.attributes.delete(name); if (name === 'disabled') this.disabled = false }
  focus() { this.ownerDocument.activeElement = this }
}
class TestText extends TestNode { constructor(data, document) { super(3, '#text', document); this.data = String(data) } get nodeValue() { return this.data } set nodeValue(value) { this.data = String(value) } }
class TestDocument extends TestNode {
  constructor() { super(9, '#document'); this.ownerDocument = this; this.documentElement = new TestElement('html', this); this.body = new TestElement('body', this); this.documentElement.appendChild(this.body); this.appendChild(this.documentElement); this.activeElement = this.body; this.oninput = null }
  createElement(tag) { return new TestElement(tag, this) }
  createElementNS(namespace, tag) { return new TestElement(tag, this, namespace) }
  createTextNode(data) { return new TestText(data, this) }
}

const elements = (node, tag) => [
  ...(node.tagName === tag.toUpperCase() ? [node] : []),
  ...(node.childNodes || []).flatMap(child => elements(child, tag)),
]
const reactProps = node => node[Object.keys(node).find(key => key.startsWith('__reactProps$'))]
const reportContent = summary => ({
  period_start: '2026-08-01', period_end: '2026-08-31', sources: ['Evidence v1'],
  executive_summary: summary, insights: ['Evidence-backed insight'], recommended_actions: ['Review evidence'],
})

function reportWorkspace(scope, versions = null) {
  const artifact = { id: `report-${scope}`, organization_id: `org-${scope}`, engagement_id: `eng-${scope}`, brand_id: `brand-${scope}`, artifact_type: 'marketing_report', title: `Report ${scope}` }
  const v1 = { id: `v1-${scope}`, organization_id: artifact.organization_id, artifact_id: artifact.id, version_number: 1, created_at: '2026-09-01', content: reportContent('Saved summary') }
  const v2 = { ...v1, id: `v2-${scope}`, version_number: 2, created_at: '2026-09-02' }
  return {
    artifact, v1, v2,
    workspace: {
      engagement: { id: artifact.engagement_id, organization_id: artifact.organization_id, brand_id: artifact.brand_id, brands: { name: 'Brand' } },
      artifacts: [artifact], versions: versions || [v2, v1], approvals: [],
    },
  }
}

test('mounted MB07 report lifecycle preserves drafts, exact identity, reconciliation locks, and late-review scope', async t => {
  const approvalStub = {
    name: 'mb07-approval-stub', enforce: 'pre',
    transform(code, id) {
      if (id.replaceAll('\\', '/').endsWith('/src/components/ArtifactApprovalPanel.jsx')) {
        return 'export default function ApprovalStub(props){ globalThis.__mb07ApprovalProps = props; return null }'
      }
      return null
    },
  }
  const server = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent', plugins: [approvalStub] })
  t.after(() => server.close())
  const { default: MarketingReports } = await server.ssrLoadModule('/src/components/MarketingReports.jsx')
  const document = new TestDocument()
  const window = { document, navigator: { userAgent: 'mb07-test' }, Node: TestNode, HTMLElement: TestElement, HTMLIFrameElement: class extends TestElement {} }
  document.defaultView = window
  const stored = new Map()
  const sessionStorage = { getItem: key => stored.get(key) ?? null, setItem: (key, value) => stored.set(key, String(value)), removeItem: key => stored.delete(key) }
  const previous = { document: globalThis.document, window: globalThis.window, Event: globalThis.Event, Node: globalThis.Node, HTMLElement: globalThis.HTMLElement, sessionStorage: globalThis.sessionStorage, act: globalThis.IS_REACT_ACT_ENVIRONMENT, approval: globalThis.__mb07ApprovalProps }
  Object.assign(globalThis, { document, window, Event: TestEvent, Node: TestNode, HTMLElement: TestElement, sessionStorage, IS_REACT_ACT_ENVIRONMENT: true })
  t.after(() => Object.assign(globalThis, {
    document: previous.document, window: previous.window, Event: previous.Event,
    Node: previous.Node, HTMLElement: previous.HTMLElement, sessionStorage: previous.sessionStorage,
    IS_REACT_ACT_ENVIRONMENT: previous.act, __mb07ApprovalProps: previous.approval,
  }))

  async function mount(input, extra = {}) {
    const container = document.createElement('div')
    const root = createRoot(container)
    const base = { studio: { saveMarketingReport: async () => ({}) }, saving: false, act: async callback => callback(), actorId: 'actor-test', onRefresh: async () => {}, ...extra }
    const view = props => createElement(StrictMode, null, createElement(MarketingReports, props))
    await act(async () => root.render(view({ ...base, workspace: input })))
    return { container, root, base, render: patch => act(async () => root.render(view({ ...base, workspace: input, ...patch }))), close: () => act(async () => root.unmount()) }
  }

  await t.test('same-scope refresh preserves a dirty draft while a denied scope clears it', async () => {
    const first = reportWorkspace('draft')
    const mounted = await mount(first.workspace)
    try {
      const summary = elements(mounted.container, 'textarea')[1]
      await act(async () => reactProps(summary).onChange({ target: { value: 'UNSAVED REVISION' } }))
      await mounted.render({ workspace: { ...first.workspace, versions: [...first.workspace.versions] } })
      assert.equal(elements(mounted.container, 'textarea')[1].value, 'UNSAVED REVISION')
      await mounted.render({ actorId: 'other-actor', workspace: reportWorkspace('denied').workspace })
      assert.doesNotMatch(mounted.container.textContent, /UNSAVED REVISION/)
    } finally { await mounted.close() }
  })

  await t.test('same-tick writes are serialized and an ambiguous result stays locked despite a checksum match', async () => {
    const input = reportWorkspace('ambiguous')
    let calls = 0
    let firstRequestId = ''
    const extra = { studio: { saveMarketingReport: async payload => {
      calls += 1
      if (!firstRequestId) firstRequestId = payload.request_id
      assert.equal(payload.request_id, firstRequestId)
      if (calls === 1) throw new Error('Response lost')
      return { ...input.v2, id: 'v3-ambiguous', version_number: 3, request_id: payload.request_id,
        content: payload.content, content_checksum: await marketingReportContentChecksum(payload.content) }
    } }, act: async callback => { try { return await callback() } catch { return null } } }
    let mounted = await mount(input.workspace, extra)
    const form = elements(mounted.container, 'form')[0]
    const submit = reactProps(form).onSubmit
    await act(async () => Promise.all([submit({ preventDefault() {} }), submit({ preventDefault() {} })]))
    assert.equal(calls, 1)
    assert.match(mounted.container.textContent, /Save locked/)
    await mounted.render({ actorId: 'another-actor' })
    assert.doesNotMatch(mounted.container.textContent, /Save locked/)
    await mounted.render({ actorId: 'actor-test' })
    assert.match(mounted.container.textContent, /Save locked/)
    await mounted.close()
    mounted = await mount(input.workspace, extra)
    try {
      assert.match(mounted.container.textContent, /Save locked/)
      const content = reportContent('Saved summary')
      const checksum = await marketingReportContentChecksum(content)
      const v3 = { ...input.v2, id: 'v3-ambiguous', version_number: 3, created_at: '2026-09-03', content, content_checksum: checksum }
      await mounted.render({ workspace: { ...input.workspace, versions: [v3, input.v2, input.v1] } })
      assert.match(mounted.container.textContent, /Save locked/)
      assert.match(mounted.container.textContent, /matching content alone cannot clear/i)
      const retry = elements(mounted.container, 'button').find(button => button.textContent === 'Retry exact report request')
      assert.ok(retry)
      await act(async () => reactProps(retry).onClick())
      assert.equal(calls, 2)
      assert.doesNotMatch(mounted.container.textContent, /Save locked/)
    } finally { await mounted.close() }
  })

  await t.test('service conflict keeps an uncertain report request locked', async () => {
    const input = reportWorkspace('service-conflict')
    let calls = 0
    const mounted = await mount(input.workspace, {
      studio: { saveMarketingReport: async () => {
        calls += 1
        if (calls === 1) throw new Error('Response lost')
        throw Object.assign(new Error('Marketing service is paused'), { status: 409 })
      } },
      act: async callback => { try { return await callback() } catch { return null } },
    })
    try {
      await act(async () => reactProps(elements(mounted.container, 'form')[0]).onSubmit({ preventDefault() {} }))
      const retry = elements(mounted.container, 'button').find(button => button.textContent === 'Retry exact report request')
      await act(async () => reactProps(retry).onClick())
      assert.equal(calls, 2)
      assert.match(mounted.container.textContent, /Save locked/)
    } finally { await mounted.close() }
  })
  await t.test('authoritative stale rejection clears only the exact pending request', async () => {
    const input = reportWorkspace('stale')
    let calls = 0
    let refreshes = 0
    const mounted = await mount(input.workspace, {
      studio: { saveMarketingReport: async () => {
        calls += 1
        if (calls === 1) throw new Error('Response lost')
        throw Object.assign(new Error('Report changed'), { status: 412 })
      } },
      act: async callback => { try { return await callback() } catch { return null } },
      onRefresh: async () => { refreshes += 1 },
    })
    try {
      await act(async () => reactProps(elements(mounted.container, 'form')[0]).onSubmit({ preventDefault() {} }))
      assert.match(mounted.container.textContent, /Save locked/)
      const retry = elements(mounted.container, 'button').find(button => button.textContent === 'Retry exact report request')
      await act(async () => reactProps(retry).onClick())
      assert.equal(calls, 2)
      assert.equal(refreshes, 1)
      assert.doesNotMatch(mounted.container.textContent, /Save locked/)
      assert.match(mounted.container.textContent, /changed before this request could save/)
    } finally { await mounted.close() }
  })
  await t.test('unavailable durable recovery storage prevents any report write', async () => {
    const input = reportWorkspace('storage-failure')
    let calls = 0
    const availableStorage = globalThis.sessionStorage
    globalThis.sessionStorage = { getItem() { throw new Error('Storage denied') }, setItem() { throw new Error('Storage denied') }, removeItem() {} }
    const mounted = await mount(input.workspace, { studio: { saveMarketingReport: async () => { calls += 1 } } })
    try {
      const form = elements(mounted.container, 'form')[0]
      await act(async () => reactProps(form).onSubmit({ preventDefault() {} }))
      assert.equal(calls, 0)
      assert.match(mounted.container.textContent, /Storage denied|saving is disabled/i)
    } finally {
      await mounted.close()
      globalThis.sessionStorage = availableStorage
    }
  })

  await t.test('selected stored metric row is pinned in the exact saved version and receipt', async () => {
    const input = reportWorkspace('metric-pin')
    const snapshotId = '44444444-4444-4444-8444-444444444444'
    let savedInput = null
    const mounted = await mount(input.workspace, {
      studio: {
        listReportMetricSources: async () => ({
          adCampaigns: [{ id: 'campaign-a', campaign_name: 'Search campaign' }],
          adSnapshots: [{ id: snapshotId, ad_campaign_id: 'campaign-a', snapshot_date: '2026-08-15' }],
          trackedKeywords: [], rankSnapshots: [], metaConnections: [], metaSnapshots: [],
        }),
        saveMarketingReport: async payload => {
          savedInput = payload
          const content = { ...payload.content, metric_snapshots: [{
            source: 'google_ads', source_record_id: snapshotId, snapshot_date: '2026-08-15',
            retrieved_at: '2026-08-16T10:00:00Z', pinned_at: '2026-09-21T12:00:00Z',
            account_id: '123', label: 'Search campaign', metrics: { impressions: 120 },
            definitions: { currency: null, reporting_timezone: null },
          }] }
          return { ...input.v2, id: 'v3-metric-pin', version_number: 3,
            request_id: payload.request_id, content, content_checksum: await marketingReportContentChecksum(content) }
        },
      },
    })
    try {
      await act(async () => {})
      const checkbox = elements(mounted.container, 'input').find(node => reactProps(node)?.type === 'checkbox')
      assert.ok(checkbox)
      await act(async () => reactProps(checkbox).onChange({ target: { checked: true } }))
      await act(async () => reactProps(elements(mounted.container, 'form')[0]).onSubmit({ preventDefault() {} }))
      assert.deepEqual(savedInput.content.metric_snapshot_refs, [{ source: 'google_ads', snapshot_id: snapshotId }])
      assert.doesNotMatch(mounted.container.textContent, /Save locked/)
    } finally { await mounted.close() }
  })

  await t.test('successful save selects returned exact version and late prior-version review callbacks are ignored', async () => {
    const input = reportWorkspace('success')
    const v3 = { ...input.v2, id: 'v3-success', version_number: 3, created_at: '2026-09-03', content: reportContent('Revision') }
    let mounted
    let refreshes = 0
    const nextWorkspace = { ...input.workspace, versions: [v3, input.v2, input.v1] }
    const extra = {
      studio: { saveMarketingReport: async payload => ({ ...v3, content: payload.content, request_id: payload.request_id,
        content_checksum: await marketingReportContentChecksum(payload.content) }) },
      onRefresh: async () => { refreshes += 1 },
      act: async callback => { const result = await callback(); mounted.root.render(createElement(StrictMode, null, createElement(MarketingReports, { ...mounted.base, workspace: nextWorkspace }))); return result },
    }
    mounted = await mount(input.workspace, extra)
    try {
      const oldReviewCallback = globalThis.__mb07ApprovalProps.onChanged
      await act(async () => reactProps(elements(mounted.container, 'textarea')[1]).onChange({ target: { value: 'Revision' } }))
      await act(async () => reactProps(elements(mounted.container, 'form')[0]).onSubmit({ preventDefault() {} }))
      assert.equal(elements(mounted.container, 'select')[1].value, v3.id)
      await act(async () => oldReviewCallback())
      assert.equal(refreshes, 0)
    } finally { await mounted.close() }
  })
})
