import assert from 'node:assert/strict'
import test from 'node:test'
import { act, createElement } from 'react'
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
  const previous = { document: globalThis.document, window: globalThis.window, Event: globalThis.Event, Node: globalThis.Node, HTMLElement: globalThis.HTMLElement, act: globalThis.IS_REACT_ACT_ENVIRONMENT, approval: globalThis.__mb07ApprovalProps }
  Object.assign(globalThis, { document, window, Event: TestEvent, Node: TestNode, HTMLElement: TestElement, IS_REACT_ACT_ENVIRONMENT: true })
  t.after(() => Object.assign(globalThis, {
    document: previous.document, window: previous.window, Event: previous.Event,
    Node: previous.Node, HTMLElement: previous.HTMLElement,
    IS_REACT_ACT_ENVIRONMENT: previous.act, __mb07ApprovalProps: previous.approval,
  }))

  async function mount(input, extra = {}) {
    const container = document.createElement('div')
    const root = createRoot(container)
    const base = { studio: { saveArtifact: async () => ({}) }, saving: false, act: async callback => callback(), onRefresh: async () => {}, ...extra }
    await act(async () => root.render(createElement(MarketingReports, { ...base, workspace: input })))
    return { container, root, base, render: patch => act(async () => root.render(createElement(MarketingReports, { ...base, workspace: input, ...patch }))), close: () => act(async () => root.unmount()) }
  }

  await t.test('same-scope refresh preserves a dirty draft while a denied scope clears it', async () => {
    const first = reportWorkspace('draft')
    const mounted = await mount(first.workspace)
    try {
      const summary = elements(mounted.container, 'textarea')[1]
      await act(async () => reactProps(summary).onChange({ target: { value: 'UNSAVED REVISION' } }))
      await mounted.render({ workspace: { ...first.workspace, versions: [...first.workspace.versions] } })
      assert.equal(elements(mounted.container, 'textarea')[1].value, 'UNSAVED REVISION')
      await mounted.render({ workspace: reportWorkspace('denied').workspace })
      assert.doesNotMatch(mounted.container.textContent, /UNSAVED REVISION/)
    } finally { await mounted.close() }
  })

  await t.test('an ambiguous write remains locked across unmount until one authoritative checksum match appears', async () => {
    const input = reportWorkspace('ambiguous')
    let calls = 0
    const extra = { studio: { saveArtifact: async () => { calls += 1; throw new Error('Response lost') } }, act: async callback => { try { return await callback() } catch { return null } } }
    let mounted = await mount(input.workspace, extra)
    const form = elements(mounted.container, 'form')[0]
    await act(async () => reactProps(form).onSubmit({ preventDefault() {} }))
    await act(async () => reactProps(form).onSubmit({ preventDefault() {} }))
    assert.equal(calls, 1)
    assert.match(mounted.container.textContent, /Save locked/)
    await mounted.close()
    mounted = await mount(input.workspace, extra)
    try {
      assert.match(mounted.container.textContent, /Save locked/)
      const content = reportContent('Saved summary')
      const checksum = await marketingReportContentChecksum(content)
      const v3 = { ...input.v2, id: 'v3-ambiguous', version_number: 3, created_at: '2026-09-03', content, content_checksum: checksum }
      await mounted.render({ workspace: { ...input.workspace, versions: [v3, input.v2, input.v1] } })
      assert.equal(elements(mounted.container, 'select')[1].value, v3.id)
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
      studio: { saveArtifact: async () => ({ artifact_id: input.artifact.id, version: v3 }) },
      onRefresh: async () => { refreshes += 1 },
      act: async callback => { const result = await callback(); mounted.root.render(createElement(MarketingReports, { ...mounted.base, workspace: nextWorkspace })); return result },
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
