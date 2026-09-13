import assert from 'node:assert/strict'
import test from 'node:test'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { createServer } from 'vite'

class TestEvent {
  constructor(type, options = {}) { this.type = type; this.bubbles = options.bubbles !== false; this.cancelable = true; this.defaultPrevented = false; this.propagationStopped = false }
  preventDefault() { this.defaultPrevented = true }
  stopPropagation() { this.propagationStopped = true }
}

class TestNode {
  constructor(nodeType, nodeName, ownerDocument = null) { this.nodeType = nodeType; this.nodeName = nodeName; this.ownerDocument = ownerDocument; this.parentNode = null; this.childNodes = []; this.listeners = new Map() }
  appendChild(node) { node.parentNode = this; this.childNodes.push(node); return node }
  insertBefore(node, before) { const index = this.childNodes.indexOf(before); if (index < 0) return this.appendChild(node); node.parentNode = this; this.childNodes.splice(index, 0, node); return node }
  removeChild(node) { const index = this.childNodes.indexOf(node); if (index >= 0) this.childNodes.splice(index, 1); node.parentNode = null; return node }
  addEventListener(type, listener) { const listeners = this.listeners.get(type) || []; listeners.push(listener); this.listeners.set(type, listeners) }
  removeEventListener(type, listener) { this.listeners.set(type, (this.listeners.get(type) || []).filter(item => item !== listener)) }
  dispatchEvent(event) { Object.defineProperty(event, 'target', { configurable: true, value: this }); let node = this; while (node) { Object.defineProperty(event, 'currentTarget', { configurable: true, value: node }); for (const listener of node.listeners.get(event.type) || []) listener.call(node, event); if (!event.bubbles || event.propagationStopped) break; node = node.parentNode } return !event.defaultPrevented }
  contains(node) { return node === this || this.childNodes.some(child => child.contains?.(node)) }
  get firstChild() { return this.childNodes[0] || null }
  get lastChild() { return this.childNodes.at(-1) || null }
  get nextSibling() { if (!this.parentNode) return null; return this.parentNode.childNodes[this.parentNode.childNodes.indexOf(this) + 1] || null }
  get textContent() { return this.nodeType === 3 ? this.data : this.childNodes.map(node => node.textContent).join('') }
  set textContent(value) { if (this.nodeType === 3) this.data = String(value); else { this.childNodes = []; if (value !== '') this.appendChild(this.ownerDocument.createTextNode(String(value))) } }
}

class TestElement extends TestNode {
  constructor(tagName, ownerDocument, namespaceURI = 'http://www.w3.org/1999/xhtml') { super(1, tagName.toUpperCase(), ownerDocument); this.tagName = this.nodeName; this.namespaceURI = namespaceURI; this.attributes = new Map(); this.style = { setProperty(name, value) { this[name] = value }, removeProperty(name) { delete this[name] } }; this._value = ''; this.checked = false; this.selected = false; this.disabled = false }
  get options() { return this.tagName === 'SELECT' ? this.childNodes.filter(node => node.tagName === 'OPTION') : undefined }
  get value() { return this.tagName === 'SELECT' ? this.options.find(option => option.selected)?.value ?? this._value : this._value }
  set value(value) { this._value = String(value); if (this.tagName === 'SELECT') for (const option of this.options) option.selected = option.value === this._value }
  setAttribute(name, value) { this.attributes.set(name, String(value)); if (name === 'value') this.value = String(value); if (name === 'disabled') this.disabled = true }
  getAttribute(name) { return this.attributes.get(name) ?? null }
  removeAttribute(name) { this.attributes.delete(name); if (name === 'disabled') this.disabled = false }
  hasAttribute(name) { return this.attributes.has(name) }
  focus() { this.ownerDocument.activeElement = this }
}

class TestText extends TestNode {
  constructor(data, ownerDocument) { super(3, '#text', ownerDocument); this.data = String(data) }
  get nodeValue() { return this.data }
  set nodeValue(value) { this.data = String(value) }
}

class TestDocument extends TestNode {
  constructor() { super(9, '#document'); this.ownerDocument = this; this.defaultView = null; this.oninput = null; this.documentElement = new TestElement('html', this); this.body = new TestElement('body', this); this.documentElement.appendChild(this.body); this.appendChild(this.documentElement); this.activeElement = this.body }
  createElement(tagName) { return new TestElement(tagName, this) }
  createElementNS(namespaceURI, tagName) { return new TestElement(tagName, this, namespaceURI) }
  createTextNode(data) { return new TestText(data, this) }
}

function mountedEnvironment() {
  const document = new TestDocument()
  const window = { document, addEventListener() {}, removeEventListener() {}, getSelection: () => null, Event: TestEvent, Node: TestNode, Element: TestElement, HTMLElement: TestElement, HTMLIFrameElement: class extends TestElement {}, SVGElement: TestElement }
  document.defaultView = window
  return { document, window, container: document.createElement('div') }
}

function elements(root, tagName) {
  const result = []; const tag = tagName.toUpperCase()
  function visit(node) { if (node.tagName === tag) result.push(node); for (const child of node.childNodes || []) visit(child) }
  visit(root); return result
}

const byText = (root, tagName, text) => elements(root, tagName).find(node => node.textContent.includes(text))
const flushMounted = () => act(async () => { await Promise.resolve(); await new Promise(resolve => setTimeout(resolve, 0)) })

async function setValue(node, value) {
  const previous = node.value
  node.value = value
  node._valueTracker?.setValue(previous)
  await act(async () => {
    node.dispatchEvent(new TestEvent('input', { bubbles: true }))
    node.dispatchEvent(new TestEvent('change', { bubbles: true }))
  })
}

function reviewPanelStubs() {
  const stubs = {
    'ArtifactApprovalPanel.jsx': ['b06b-approval', `import {createElement} from 'react'; export default function Stub(props){globalThis.__b06bApprovalRenders.push(props.version.id); const recovered=globalThis.__b06bRecovered?.[props.version.id]; return createElement('button',{type:'button',onClick:()=>globalThis.__b06bApprovalActions.push(props.version.id)},recovered?'Recovered request '+props.version.id:'Submit stub '+props.version.id)}`],
    'VersionProofingPanel.jsx': ['b06b-proofing', `import {createElement} from 'react'; export default function Stub(props){globalThis.__b06bProofingRenders.push(props.versions[0].id); return createElement('p',null,'Proofing stub '+props.versions[0].id)}`],
  }
  return {
    name: 'b06b-review-panel-stubs', enforce: 'pre',
    resolveId(source) { for (const [suffix, [id]] of Object.entries(stubs)) if (source.endsWith(suffix)) return `\0${id}` },
    load(id) { return Object.values(stubs).find(([key]) => id === `\0${key}`)?.[1] },
  }
}

function approvalRepositoryStubs() {
  const stubs = {
    'AuthContext.jsx': ['b06b-auth', 'export const useAuth=()=>({user:{id:"actor"},profile:{role:"contributor",department:"design"}})'],
    'artifactApprovalRepository.js': ['b06b-approval-repository', 'export const artifactApprovals=new Proxy({}, {get:(_,key)=>(...args)=>globalThis.__b06bApprovalRepository[key](...args)})'],
  }
  return {
    name: 'b06b-approval-repository-stubs', enforce: 'pre',
    resolveId(source) { for (const [suffix, [id]] of Object.entries(stubs)) if (source.endsWith(suffix)) return `\0${id}` },
    load(id) { return Object.values(stubs).find(([key]) => id === `\0${key}`)?.[1] },
  }
}

function workspace() {
  return {
    deliveryPackageArtifacts: [{ id: 'package', title: 'Launch package' }],
    deliveryPackageVersions: [
      { id: 'package-v1', artifact_id: 'package', version_number: 1, created_at: '2026-09-12T00:00:00Z', content: { destination_type: 'website', placement_label: 'Hero' } },
      { id: 'package-v2', artifact_id: 'package', version_number: 2, created_at: '2026-09-13T00:00:00Z', content: { destination_type: 'social', placement_label: 'Launch post' } },
    ],
    deliveryPackageContexts: [
      { artifact_version_id: 'package-v1', source_engagement_service_id: 'design-service', project_task_id: 'task' },
      { artifact_version_id: 'package-v2', source_engagement_service_id: 'design-service', project_task_id: 'task' },
    ],
    deliveryPackageAssetReferences: [
      { artifact_version_id: 'package-v1', design_asset_id: 'asset', design_asset_version_id: 'asset-v1', position: 1 },
      { artifact_version_id: 'package-v2', design_asset_id: 'asset', design_asset_version_id: 'asset-v2', position: 1 },
    ],
    approvals: [],
    designAssets: [{ id: 'asset', name: 'Hero', archived_at: null }],
    designAssetVersions: [
      { id: 'asset-v1', asset_id: 'asset', version_number: 1, signed_url: 'https://example.test/v1' },
      { id: 'asset-v2', asset_id: 'asset', version_number: 2, signed_url: 'https://example.test/v2' },
    ],
    designServices: [{ id: 'design-service', status: 'active', service_catalog: { department_id: 'design', is_active: true } }],
    deliveryServices: [],
  }
}

test('B06b mounted review keeps actions on the selected exact version and recovers one lost response without duplicate refresh', async t => {
  const vite = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent', plugins: [reviewPanelStubs()] })
  t.after(() => vite.close())
  const { default: DesignPackageReviewPanel } = await vite.ssrLoadModule('/src/components/DesignPackageReviewPanel.jsx')
  const environment = mountedEnvironment()
  const previous = {
    document: globalThis.document, window: globalThis.window, Event: globalThis.Event,
    Node: globalThis.Node, HTMLElement: globalThis.HTMLElement, act: globalThis.IS_REACT_ACT_ENVIRONMENT,
    approvalRenders: globalThis.__b06bApprovalRenders, approvalActions: globalThis.__b06bApprovalActions,
    proofingRenders: globalThis.__b06bProofingRenders, recovered: globalThis.__b06bRecovered,
  }
  Object.assign(globalThis, {
    document: environment.document, window: environment.window, Event: TestEvent, Node: TestNode,
    HTMLElement: TestElement, IS_REACT_ACT_ENVIRONMENT: true,
    __b06bApprovalRenders: [], __b06bApprovalActions: [], __b06bProofingRenders: [], __b06bRecovered: {},
  })
  t.after(() => Object.assign(globalThis, {
    document: previous.document, window: previous.window, Event: previous.Event, Node: previous.Node,
    HTMLElement: previous.HTMLElement, IS_REACT_ACT_ENVIRONMENT: previous.act,
    __b06bApprovalRenders: previous.approvalRenders, __b06bApprovalActions: previous.approvalActions,
    __b06bProofingRenders: previous.proofingRenders, __b06bRecovered: previous.recovered,
  }))
  const root = createRoot(environment.container)
  t.after(() => { try { root.unmount() } catch { /* already unmounted */ } })

  let resolveRefresh
  let refreshCalls = 0
  const onRefresh = () => {
    refreshCalls += 1
    return new Promise(resolve => { resolveRefresh = resolve })
  }
  await act(async () => root.render(createElement(DesignPackageReviewPanel, {
    workspace: workspace(), reviewAvailable: true, snapshotFresh: true, onRefresh,
  })))
  await flushMounted()
  assert.match(environment.container.textContent, /Submit stub package-v2/)
  assert.match(environment.container.textContent, /Proofing stub package-v2/)

  const refresh = byText(environment.container, 'button', 'Refresh review status')
  await act(async () => {
    refresh.dispatchEvent(new TestEvent('click', { bubbles: true }))
    refresh.dispatchEvent(new TestEvent('click', { bubbles: true }))
  })
  assert.equal(refreshCalls, 1)
  globalThis.__b06bRecovered['package-v2'] = true
  resolveRefresh()
  await flushMounted()
  assert.match(environment.container.textContent, /Recovered request package-v2/)

  const select = elements(environment.container, 'select')[0]
  await setValue(select, 'package-v1')
  await flushMounted()
  assert.match(environment.container.textContent, /Submit stub package-v1/)
  assert.match(environment.container.textContent, /Proofing stub package-v1/)
  assert.doesNotMatch(environment.container.textContent, /Recovered request package-v2/)
  await act(async () => byText(environment.container, 'button', 'Submit stub package-v1').dispatchEvent(new TestEvent('click', { bubbles: true })))
  assert.deepEqual(globalThis.__b06bApprovalActions, ['package-v1'])
  assert.equal(globalThis.__b06bApprovalRenders.at(-1), 'package-v1')
  assert.equal(globalThis.__b06bProofingRenders.at(-1), 'package-v1')
})

test('B06b shared submit control sends one exact-version request across a normal double click', async t => {
  const vite = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent', plugins: [approvalRepositoryStubs()] })
  t.after(() => vite.close())
  const { default: ArtifactApprovalPanel } = await vite.ssrLoadModule('/src/components/ArtifactApprovalPanel.jsx')
  const environment = mountedEnvironment()
  const previous = { document: globalThis.document, window: globalThis.window, Event: globalThis.Event, Node: globalThis.Node, HTMLElement: globalThis.HTMLElement, act: globalThis.IS_REACT_ACT_ENVIRONMENT, repository: globalThis.__b06bApprovalRepository }
  Object.assign(globalThis, { document: environment.document, window: environment.window, Event: TestEvent, Node: TestNode, HTMLElement: TestElement, IS_REACT_ACT_ENVIRONMENT: true })
  t.after(() => Object.assign(globalThis, { document: previous.document, window: previous.window, Event: previous.Event, Node: previous.Node, HTMLElement: previous.HTMLElement, IS_REACT_ACT_ENVIRONMENT: previous.act, __b06bApprovalRepository: previous.repository }))
  const root = createRoot(environment.container)
  t.after(() => { try { root.unmount() } catch { /* already unmounted */ } })

  const calls = []
  let finishRequest
  let created = false
  globalThis.__b06bApprovalRepository = {
    load: async () => created ? {
      request: { id: 'request-v2', approval_policy: 'parallel', status: 'pending' },
      signoffs: [
        { id: 'signoff-1', required_approver_id: 'reviewer-1', signed_off_at: null },
        { id: 'signoff-2', required_approver_id: 'reviewer-2', signed_off_at: null },
      ],
      approvers: [
        { user_id: 'reviewer-1', full_name: 'Reviewer One' },
        { user_id: 'reviewer-2', full_name: 'Reviewer Two' },
      ],
    } : {
      request: null,
      signoffs: [],
      approvers: [
        { user_id: 'reviewer-1', full_name: 'Reviewer One' },
        { user_id: 'reviewer-2', full_name: 'Reviewer Two' },
      ],
    },
    createRequest: (...args) => {
      calls.push(args)
      return new Promise(resolve => { finishRequest = () => { created = true; resolve() } })
    },
    signOff: async () => {},
    requestChanges: async () => {},
  }
  await act(async () => root.render(createElement(ArtifactApprovalPanel, {
    version: { id: 'package-v2', version_number: 2 },
    approval: null,
    theme: 'blue',
    requestLabel: 'Submit exact package version for review',
  })))
  await flushMounted()
  for (const checkbox of elements(environment.container, 'input')) {
    const propsKey = Object.keys(checkbox).find(key => key.startsWith('__reactProps'))
    await act(async () => checkbox[propsKey].onChange())
  }
  await flushMounted()
  const submit = byText(environment.container, 'button', 'Submit exact package version for review')
  assert.equal(submit.disabled, false)
  await act(async () => submit.dispatchEvent(new TestEvent('click', { bubbles: true })))
  await flushMounted()
  assert.equal(submit.disabled, true)
  if (!submit.disabled) submit.dispatchEvent(new TestEvent('click', { bubbles: true }))
  assert.equal(calls.length, 1)
  assert.deepEqual(calls[0], ['package-v2', 'sequential', ['reviewer-1', 'reviewer-2']])
  finishRequest()
  await flushMounted()
  assert.match(environment.container.textContent, /Pending/)
})

test('B06b hides mutations on stale or revoked snapshots but keeps exact read-only evidence visible', async t => {
  const vite = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent', plugins: [reviewPanelStubs()] })
  t.after(() => vite.close())
  const { default: DesignPackageReviewPanel } = await vite.ssrLoadModule('/src/components/DesignPackageReviewPanel.jsx')
  const environment = mountedEnvironment()
  const previous = { document: globalThis.document, window: globalThis.window, Event: globalThis.Event, Node: globalThis.Node, HTMLElement: globalThis.HTMLElement, act: globalThis.IS_REACT_ACT_ENVIRONMENT, approvalRenders: globalThis.__b06bApprovalRenders, approvalActions: globalThis.__b06bApprovalActions, proofingRenders: globalThis.__b06bProofingRenders, recovered: globalThis.__b06bRecovered }
  Object.assign(globalThis, { document: environment.document, window: environment.window, Event: TestEvent, Node: TestNode, HTMLElement: TestElement, IS_REACT_ACT_ENVIRONMENT: true, __b06bApprovalRenders: [], __b06bApprovalActions: [], __b06bProofingRenders: [], __b06bRecovered: {} })
  t.after(() => Object.assign(globalThis, { document: previous.document, window: previous.window, Event: previous.Event, Node: previous.Node, HTMLElement: previous.HTMLElement, IS_REACT_ACT_ENVIRONMENT: previous.act, __b06bApprovalRenders: previous.approvalRenders, __b06bApprovalActions: previous.approvalActions, __b06bProofingRenders: previous.proofingRenders, __b06bRecovered: previous.recovered }))
  const root = createRoot(environment.container)
  t.after(() => { try { root.unmount() } catch { /* already unmounted */ } })

  await act(async () => root.render(createElement(DesignPackageReviewPanel, {
    workspace: workspace(), reviewAvailable: true, snapshotFresh: false, onRefresh: async () => {},
  })))
  await flushMounted()
  assert.match(environment.container.textContent, /Read-only exact snapshot/)
  assert.match(environment.container.textContent, /current access snapshot is stale/i)
  assert.doesNotMatch(environment.container.textContent, /Submit stub|Proofing stub/)

  const revoked = workspace()
  revoked.designAssetVersions = revoked.designAssetVersions.map(version => ({ ...version, signed_url: null }))
  await act(async () => root.render(createElement(DesignPackageReviewPanel, {
    workspace: revoked, reviewAvailable: true, snapshotFresh: true, onRefresh: async () => {},
  })))
  await flushMounted()
  assert.match(environment.container.textContent, /Review submission is blocked locally/)
  assert.doesNotMatch(environment.container.textContent, /Submit stub/)
  assert.match(environment.container.textContent, /Proofing stub package-v2/)
})
