import assert from 'node:assert/strict'
import test from 'node:test'
import { act, createElement, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { createServer } from 'vite'

import {
  CONTENT_ARTIFACT_FORMS,
  MAX_KEYWORD_RECORDS,
  keywordStrategyIssues,
  newContentRecord,
  websitePageKey,
} from './contentStudio.js'

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
const byLabel = (root, label) => ['input', 'textarea', 'select'].flatMap(tag => elements(root, tag)).find(node => node.getAttribute('aria-label') === label)

async function setValue(node, value) {
  const previous = node.value
  node.value = value
  node._valueTracker?.setValue(previous)
  await act(async () => {
    node.dispatchEvent(new TestEvent('input', { bubbles: true }))
    node.dispatchEvent(new TestEvent('change', { bubbles: true }))
  })
}

const flushMounted = () => act(async () => {
  await Promise.resolve()
  await new Promise(resolve => setTimeout(resolve, 0))
})

function b06PanelStubs() {
  const stubs = {
    'AuthContext.jsx': ['b06-auth', 'export const useAuth=()=>({user:{id:"actor"},profile:{role:"contributor",department:"content"}})'],
    'artifactApprovalRepository.js': ['b06-approvals', 'export const artifactApprovals=new Proxy({}, {get:(_,key)=>(...args)=>globalThis.__b06ApprovalTest[key](...args)})'],
    'proofingRepository.js': ['b06-proofing', 'export const proofing=new Proxy({}, {get:(_,key)=>(...args)=>globalThis.__b06ProofingTest[key](...args)})'],
  }
  return { name: 'b06-panel-stubs', enforce: 'pre', resolveId(source) {
    for (const [suffix, [id]] of Object.entries(stubs)) if (source.endsWith(suffix)) return `\0${id}`
  }, load(id) { return Object.values(stubs).find(([key]) => id === `\0${key}`)?.[1] } }
}

test('mounted B04 editor adds, edits, selects exact source and page target, detects stale context, and removes', async t => {
  const vite = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent' })
  t.after(() => vite.close())
  const { default: KeywordStrategyEditor, KeywordArchitectureVersionSelect } = await vite.ssrLoadModule('/src/components/KeywordStrategyEditor.jsx')
  const environment = mountedEnvironment()
  const previous = { document: globalThis.document, window: globalThis.window, Event: globalThis.Event, Node: globalThis.Node, HTMLElement: globalThis.HTMLElement, act: globalThis.IS_REACT_ACT_ENVIRONMENT }
  Object.assign(globalThis, { document: environment.document, window: environment.window, Event: TestEvent, Node: TestNode, HTMLElement: TestElement, IS_REACT_ACT_ENVIRONMENT: true })
  t.after(() => Object.assign(globalThis, { document: previous.document, window: previous.window, Event: previous.Event, Node: previous.Node, HTMLElement: previous.HTMLElement, IS_REACT_ACT_ENVIRONMENT: previous.act }))
  const root = createRoot(environment.container)
  t.after(() => { try { root.unmount() } catch { /* already unmounted */ } })
  const keywordField = CONTENT_ARTIFACT_FORMS.keyword_strategy.fields.find(field => field.recordType === 'keyword')
  const architectureField = CONTENT_ARTIFACT_FORMS.keyword_strategy.fields.find(field => field.kind === 'architecture_version')
  const versions = [{ id: 'architecture-v2', version_number: 2, created_at: '2026-09-12T00:00:00Z', content: { pages: [{ page_key: 'page:home', slug: 'home', title: 'Home' }] } }]
  let observedRecords = []
  let observedSource = ''

  function Harness({ availableVersions = versions }) {
    const [records, setRecords] = useState([])
    const [sourceId, setSourceId] = useState('')
    const selectedVersion = availableVersions.find(version => version.id === sourceId)
    const issues = keywordStrategyIssues({ source_architecture_version_id: sourceId, keywords: records }, {
      pageTargetIds: new Set((selectedVersion?.content?.pages || []).map(websitePageKey)), contentRequestIds: new Set(),
    })
    const updateRecords = updater => setRecords(current => {
      const next = typeof updater === 'function' ? updater(current) : updater
      observedRecords = next
      return next
    })
    return createElement('div', null,
      createElement(KeywordArchitectureVersionSelect, {
        field: architectureField, value: sourceId, versions: availableVersions, inputClass: 'input',
        onChange: value => { observedSource = value; setSourceId(value); updateRecords(current => current.map(record => record.target_kind === 'page' ? { ...record, target_id: '', target_page_slug: '' } : record)) },
      }),
      createElement(KeywordStrategyEditor, {
        field: keywordField, records, architectureVersion: selectedVersion, issues,
        inputClass: 'input', buttonClass: 'button',
        onAdd: () => updateRecords(current => current.length < MAX_KEYWORD_RECORDS ? [...current, newContentRecord(keywordField)] : current),
        onChange: (index, next) => updateRecords(current => current.map((item, itemIndex) => itemIndex === index ? next : item)),
        onRemove: index => updateRecords(current => current.filter((_, itemIndex) => itemIndex !== index)),
      }),
    )
  }

  await act(async () => root.render(createElement(Harness)))
  await act(async () => byText(environment.container, 'button', 'Add keyword').dispatchEvent(new TestEvent('click', { bubbles: true })))
  assert.equal(observedRecords.length, 1)
  await setValue(byLabel(environment.container, 'Keyword phrase for keyword 1'), 'Strategy agency')
  await setValue(byLabel(environment.container, 'Language or locale for keyword 1'), 'en-PK')
  await setValue(byLabel(environment.container, 'Exact Website architecture version'), 'architecture-v2')
  assert.equal(observedSource, 'architecture-v2')
  await setValue(byLabel(environment.container, 'Target type for keyword 1'), 'page')
  await setValue(byLabel(environment.container, 'Target for keyword 1'), 'page:home')
  assert.equal(observedRecords[0].target_id, 'page:home')
  assert.equal(observedRecords[0].target_page_slug, 'home')
  assert.equal(byText(environment.container, 'p', 'not in the exact Website architecture version'), undefined)

  const staleVersions = [{ ...versions[0], content: { pages: [{ page_key: 'page:other', slug: 'other', title: 'Other' }] } }]
  await act(async () => root.render(createElement(Harness, { availableVersions: staleVersions })))
  assert.ok(byText(environment.container, 'p', 'not in the exact Website architecture version'))
  await act(async () => byText(environment.container, 'button', 'Remove').dispatchEvent(new TestEvent('click', { bubbles: true })))
  assert.equal(observedRecords.length, 0)
})

test('mounted B04 editor disables Add at the explicit 500-row boundary', async t => {
  const vite = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent' })
  t.after(() => vite.close())
  const { default: KeywordStrategyEditor } = await vite.ssrLoadModule('/src/components/KeywordStrategyEditor.jsx')
  const environment = mountedEnvironment()
  const previous = { document: globalThis.document, window: globalThis.window, Event: globalThis.Event, Node: globalThis.Node, HTMLElement: globalThis.HTMLElement, act: globalThis.IS_REACT_ACT_ENVIRONMENT }
  Object.assign(globalThis, { document: environment.document, window: environment.window, Event: TestEvent, Node: TestNode, HTMLElement: TestElement, IS_REACT_ACT_ENVIRONMENT: true })
  t.after(() => Object.assign(globalThis, { document: previous.document, window: previous.window, Event: previous.Event, Node: previous.Node, HTMLElement: previous.HTMLElement, IS_REACT_ACT_ENVIRONMENT: previous.act }))
  const root = createRoot(environment.container)
  t.after(() => { try { root.unmount() } catch { /* already unmounted */ } })
  const field = CONTENT_ARTIFACT_FORMS.keyword_strategy.fields.find(candidate => candidate.recordType === 'keyword')
  const records = Array.from({ length: MAX_KEYWORD_RECORDS }, (_, index) => ({ term: `Keyword ${index}`, locale: 'en', target_kind: 'content_request', target_id: 'request-1' }))
  let addCalls = 0
  await act(async () => root.render(createElement(KeywordStrategyEditor, {
    field, records, contentRequests: [{ id: 'request-1', mode: 'general', format: 'reel', brief: 'Request' }],
    inputClass: 'input', buttonClass: 'button', onAdd: () => { addCalls += 1 }, onChange() {}, onRemove() {},
  })))
  const add = byText(environment.container, 'button', 'Add keyword')
  assert.equal(add.disabled, true)
  assert.match(environment.container.textContent, /Maximum 500 keyword rows reached/)
  await act(async () => add.dispatchEvent(new TestEvent('click', { bubbles: true })))
  assert.equal(addCalls, 0)
})

test('mounted B06a library renders authorized results and a distinct true-empty state', async t => {
  const vite = await createServer({
    server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent',
    define: {
      'import.meta.env.VITE_SUPABASE_URL': JSON.stringify('https://example.supabase.co'),
      'import.meta.env.VITE_SUPABASE_ANON_KEY': JSON.stringify('test-key'),
    },
  })
  t.after(() => vite.close())
  const { default: ContentLibraryPanel } = await vite.ssrLoadModule('/src/components/ContentLibraryPanel.jsx')
  const environment = mountedEnvironment()
  const previous = { document: globalThis.document, window: globalThis.window, Event: globalThis.Event, Node: globalThis.Node, HTMLElement: globalThis.HTMLElement, act: globalThis.IS_REACT_ACT_ENVIRONMENT }
  Object.assign(globalThis, { document: environment.document, window: environment.window, Event: TestEvent, Node: TestNode, HTMLElement: TestElement, IS_REACT_ACT_ENVIRONMENT: true })
  t.after(() => Object.assign(globalThis, { document: previous.document, window: previous.window, Event: previous.Event, Node: previous.Node, HTMLElement: previous.HTMLElement, IS_REACT_ACT_ENVIRONMENT: previous.act }))
  const root = createRoot(environment.container)
  t.after(() => { try { root.unmount() } catch { /* already unmounted */ } })
  const repository = { loadLibrary: async () => ({
    artifacts: [{
      id: 'artifact-1', organization_id: 'organization-1', artifact_type: 'content',
      title: 'Homepage copy', created_by: 'author-1', created_at: '2026-09-13T00:00:00Z',
      engagements: { id: 'engagement-1', name: 'Website build', project_id: 'project-1', projects: { id: 'project-1', name: 'Launch' } },
    }],
    versions: [], approvals: [], approvalRequests: [], comments: [],
    profiles: [{ id: 'author-1', full_name: 'Aisha' }], sourceVersions: [],
  }) }

  await act(async () => root.render(createElement(ContentLibraryPanel, { repository })))
  assert.match(environment.container.textContent, /Homepage copy/)
  assert.match(environment.container.textContent, /Launch - created by Aisha/)
  const emptyRepository = { loadLibrary: async () => ({
    artifacts: [], versions: [], approvals: [], approvalRequests: [], comments: [], profiles: [], sourceVersions: [],
  }) }
  await act(async () => root.render(createElement(ContentLibraryPanel, { key: 'empty', repository: emptyRepository })))
  assert.match(environment.container.textContent, /No saved Content artifacts are visible in this organization/)
  assert.doesNotMatch(environment.container.textContent, /Try again/)
})

test('mounted B06a isolates exact-version review state and makes refresh failures visible', async t => {
  const vite = await createServer({
    server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent', plugins: [b06PanelStubs()],
  })
  t.after(() => vite.close())
  const { default: ContentLibraryPanel } = await vite.ssrLoadModule('/src/components/ContentLibraryPanel.jsx')
  const environment = mountedEnvironment()
  const previous = {
    document: globalThis.document, window: globalThis.window, Event: globalThis.Event,
    Node: globalThis.Node, HTMLElement: globalThis.HTMLElement, act: globalThis.IS_REACT_ACT_ENVIRONMENT,
    approval: globalThis.__b06ApprovalTest, proofing: globalThis.__b06ProofingTest,
  }
  Object.assign(globalThis, {
    document: environment.document, window: environment.window, Event: TestEvent, Node: TestNode,
    HTMLElement: TestElement, IS_REACT_ACT_ENVIRONMENT: true,
  })
  t.after(() => Object.assign(globalThis, {
    document: previous.document, window: previous.window, Event: previous.Event, Node: previous.Node,
    HTMLElement: previous.HTMLElement, IS_REACT_ACT_ENVIRONMENT: previous.act,
    __b06ApprovalTest: previous.approval, __b06ProofingTest: previous.proofing,
  }))
  const root = createRoot(environment.container)
  t.after(() => { try { root.unmount() } catch { /* already unmounted */ } })
  globalThis.__b06ApprovalTest = {
    load: async id => {
      if (id === 'v1') throw new Error('V1 approval unavailable')
      return { request: { id: 'request-v2', status: 'pending', approval_policy: 'parallel' },
        signoffs: [{ id: 'signoff-v2', required_approver_id: 'actor', signed_off_at: null }],
        approvers: [{ user_id: 'actor', full_name: 'Reviewer v2' }] }
    },
    requestChanges: async () => {}, signOff: async () => {}, createRequest: async () => {},
  }
  globalThis.__b06ProofingTest = {
    list: async (_kind, id) => {
      if (id === 'v1') throw new Error('V1 proofing denied')
      return [{ id: 'comment-v2', body: 'COMMENT ONLY FOR V2', author_id: 'actor', created_at: '2026-09-13', resolved: false }]
    },
    add: async () => {}, resolve: async () => {},
  }
  const data = {
    artifacts: [{ id: 'artifact', artifact_type: 'content', title: 'Canonical copy', created_by: 'author', engagements: { id: 'engagement', name: 'Project' } }],
    versions: [
      { id: 'v2', artifact_id: 'artifact', version_number: 2, created_at: '2026-09-13', content: { body: 'NEW V2 SNAPSHOT' } },
      { id: 'v1', artifact_id: 'artifact', version_number: 1, created_at: '2026-09-12', content: { body: 'OLD V1 SNAPSHOT' } },
    ],
    approvals: [], approvalRequests: [], comments: [], profiles: [], sourceVersions: [],
  }
  let loads = 0
  const repository = { loadLibrary: async () => {
    if (loads++) throw new Error('CURRENT ACCESS OR NETWORK FAILURE')
    return data
  } }
  await act(async () => root.render(createElement(ContentLibraryPanel, { repository })))
  await flushMounted()
  assert.match(environment.container.textContent, /COMMENT ONLY FOR V2/)
  const versionSelect = elements(environment.container, 'select').find(node => node.options?.some(option => option.value === 'v1'))
  assert.ok(versionSelect)
  await setValue(versionSelect, 'v1')
  await flushMounted()
  assert.match(environment.container.textContent, /OLD V1 SNAPSHOT/)
  assert.doesNotMatch(environment.container.textContent, /COMMENT ONLY FOR V2/)
  assert.equal(elements(environment.container, 'textarea').some(node => node.getAttribute('placeholder')?.includes('required change')), false)
  await act(async () => byText(environment.container, 'button', 'Refresh').dispatchEvent(new TestEvent('click', { bubbles: true })))
  await flushMounted()
  assert.match(environment.container.textContent, /CURRENT ACCESS OR NETWORK FAILURE/)
  assert.match(environment.container.textContent, /Review and approval actions are unavailable/)
})

test('shared approval and proofing panels ignore late reads from a prior exact version', async t => {
  const vite = await createServer({
    server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent', plugins: [b06PanelStubs()],
  })
  t.after(() => vite.close())
  const { default: ArtifactApprovalPanel } = await vite.ssrLoadModule('/src/components/ArtifactApprovalPanel.jsx')
  const { default: VersionProofingPanel } = await vite.ssrLoadModule('/src/components/VersionProofingPanel.jsx')
  const environment = mountedEnvironment()
  const previous = {
    document: globalThis.document, window: globalThis.window, Event: globalThis.Event,
    Node: globalThis.Node, HTMLElement: globalThis.HTMLElement, act: globalThis.IS_REACT_ACT_ENVIRONMENT,
    approval: globalThis.__b06ApprovalTest, proofing: globalThis.__b06ProofingTest,
  }
  Object.assign(globalThis, {
    document: environment.document, window: environment.window, Event: TestEvent, Node: TestNode,
    HTMLElement: TestElement, IS_REACT_ACT_ENVIRONMENT: true,
  })
  t.after(() => Object.assign(globalThis, {
    document: previous.document, window: previous.window, Event: previous.Event, Node: previous.Node,
    HTMLElement: previous.HTMLElement, IS_REACT_ACT_ENVIRONMENT: previous.act,
    __b06ApprovalTest: previous.approval, __b06ProofingTest: previous.proofing,
  }))
  const root = createRoot(environment.container)
  t.after(() => { try { root.unmount() } catch { /* already unmounted */ } })
  let resolveApprovalV2
  let resolveProofingV2
  const approvalV2 = new Promise(resolve => { resolveApprovalV2 = resolve })
  const proofingV2 = new Promise(resolve => { resolveProofingV2 = resolve })
  globalThis.__b06ApprovalTest = {
    load: id => id === 'v2' ? approvalV2 : Promise.resolve({
      request: { id: 'request-v1', status: 'pending', approval_policy: 'parallel' },
      signoffs: [{ id: 'signoff-v1', required_approver_id: 'actor', signed_off_at: null }],
      approvers: [{ user_id: 'actor', full_name: 'Reviewer v1' }],
    }),
    requestChanges: async () => {}, signOff: async () => {}, createRequest: async () => {},
  }
  globalThis.__b06ProofingTest = {
    list: (_kind, id) => id === 'v2' ? proofingV2 : Promise.resolve([
      { id: 'comment-v1', body: 'COMMENT FOR V1', author_id: 'actor', created_at: '2026-09-12', resolved: false },
    ]),
    add: async () => {}, resolve: async () => {},
  }
  const render = version => createElement('div', null,
    createElement(ArtifactApprovalPanel, { version, approval: null }),
    createElement(VersionProofingPanel, { targetKind: 'artifact', versions: [version], initialVersionId: version.id, department: 'content' }),
  )
  await act(async () => root.render(render({ id: 'v2', version_number: 2 })))
  await act(async () => root.render(render({ id: 'v1', version_number: 1 })))
  await flushMounted()
  assert.match(environment.container.textContent, /Reviewer v1/)
  assert.match(environment.container.textContent, /COMMENT FOR V1/)
  resolveApprovalV2({
    request: { id: 'request-v2', status: 'pending', approval_policy: 'parallel' },
    signoffs: [{ id: 'signoff-v2', required_approver_id: 'actor', signed_off_at: null }],
    approvers: [{ user_id: 'actor', full_name: 'Reviewer v2' }],
  })
  resolveProofingV2([{ id: 'comment-v2', body: 'COMMENT FOR V2', author_id: 'actor', created_at: '2026-09-13', resolved: false }])
  await flushMounted()
  assert.match(environment.container.textContent, /Reviewer v1/)
  assert.match(environment.container.textContent, /COMMENT FOR V1/)
  assert.doesNotMatch(environment.container.textContent, /Reviewer v2|COMMENT FOR V2/)
})

test('shared approval panel ignores a prior-version mutation completion and retains its retry identity', async t => {
  const vite = await createServer({
    server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent', plugins: [b06PanelStubs()],
  })
  t.after(() => vite.close())
  const { default: ArtifactApprovalPanel } = await vite.ssrLoadModule('/src/components/ArtifactApprovalPanel.jsx')
  const environment = mountedEnvironment()
  const previous = {
    document: globalThis.document, window: globalThis.window, Event: globalThis.Event,
    Node: globalThis.Node, HTMLElement: globalThis.HTMLElement, act: globalThis.IS_REACT_ACT_ENVIRONMENT,
    approval: globalThis.__b06ApprovalTest, proofing: globalThis.__b06ProofingTest,
  }
  Object.assign(globalThis, {
    document: environment.document, window: environment.window, Event: TestEvent, Node: TestNode,
    HTMLElement: TestElement, IS_REACT_ACT_ENVIRONMENT: true,
  })
  t.after(() => Object.assign(globalThis, {
    document: previous.document, window: previous.window, Event: previous.Event, Node: previous.Node,
    HTMLElement: previous.HTMLElement, IS_REACT_ACT_ENVIRONMENT: previous.act,
    __b06ApprovalTest: previous.approval, __b06ProofingTest: previous.proofing,
  }))
  const root = createRoot(environment.container)
  t.after(() => { try { root.unmount() } catch { /* already unmounted */ } })
  const loads = []
  const mutations = []
  let finishMutation
  globalThis.__b06ApprovalTest = {
    load: async id => {
      loads.push(id)
      return {
        request: { id: `request-${id}`, status: 'pending', approval_policy: 'parallel' },
        signoffs: [{ id: `signoff-${id}`, required_approver_id: 'actor', signed_off_at: null }],
        approvers: [{ user_id: 'actor', full_name: `Reviewer ${id}` }],
      }
    },
    requestChanges: (...args) => { mutations.push(args); return new Promise(resolve => { finishMutation = resolve }) },
    signOff: async () => {}, createRequest: async () => {},
  }
  globalThis.__b06ProofingTest = { list: async () => [], add: async () => {}, resolve: async () => {} }
  let changed = 0
  await act(async () => root.render(createElement(ArtifactApprovalPanel, {
    version: { id: 'v2', version_number: 2 }, approval: null, onChanged: () => { changed += 1 },
  })))
  await flushMounted()
  const textarea = elements(environment.container, 'textarea').find(node => node.getAttribute('placeholder')?.includes('required change'))
  assert.ok(textarea)
  const propsKey = Object.keys(textarea).find(key => key.startsWith('__reactProps'))
  assert.ok(propsKey)
  await act(async () => textarea[propsKey].onChange({ target: { value: 'Fix the exact v2 claim' } }))
  await flushMounted()
  const form = elements(environment.container, 'form').find(node => node.contains(textarea))
  await act(async () => form.dispatchEvent(new TestEvent('submit', { bubbles: true })))
  assert.equal(mutations.length, 1)
  assert.equal(mutations[0][0], 'request-v2')
  assert.equal(mutations[0][1], 'Fix the exact v2 claim')
  assert.match(mutations[0][2], /^[0-9a-f-]{36}$/i)
  await act(async () => root.render(createElement(ArtifactApprovalPanel, {
    version: { id: 'v1', version_number: 1 }, approval: null, onChanged: () => { changed += 1 },
  })))
  await flushMounted()
  finishMutation()
  await flushMounted()
  assert.deepEqual(loads, ['v2', 'v1'])
  assert.equal(changed, 0)
  assert.match(environment.container.textContent, /Reviewer v1/)
  assert.doesNotMatch(environment.container.textContent, /Reviewer v2/)
})
test('approval mutation lost response keeps the same intent retryable on the exact target', async t => {
  const vite = await createServer({
    server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent', plugins: [b06PanelStubs()],
  })
  t.after(() => vite.close())
  const { default: ArtifactApprovalPanel } = await vite.ssrLoadModule('/src/components/ArtifactApprovalPanel.jsx')
  const environment = mountedEnvironment()
  const previous = {
    document: globalThis.document, window: globalThis.window, Event: globalThis.Event,
    Node: globalThis.Node, HTMLElement: globalThis.HTMLElement, act: globalThis.IS_REACT_ACT_ENVIRONMENT,
    approval: globalThis.__b06ApprovalTest, proofing: globalThis.__b06ProofingTest,
  }
  Object.assign(globalThis, {
    document: environment.document, window: environment.window, Event: TestEvent, Node: TestNode,
    HTMLElement: TestElement, IS_REACT_ACT_ENVIRONMENT: true,
  })
  t.after(() => Object.assign(globalThis, {
    document: previous.document, window: previous.window, Event: previous.Event, Node: previous.Node,
    HTMLElement: previous.HTMLElement, IS_REACT_ACT_ENVIRONMENT: previous.act,
    __b06ApprovalTest: previous.approval, __b06ProofingTest: previous.proofing,
  }))
  const root = createRoot(environment.container)
  t.after(() => { try { root.unmount() } catch { /* already unmounted */ } })
  const mutations = []
  globalThis.__b06ApprovalTest = {
    load: async id => ({
      request: { id: `request-${id}`, status: 'pending', approval_policy: 'parallel' },
      signoffs: [{ id: `signoff-${id}`, required_approver_id: 'actor', signed_off_at: null }],
      approvers: [{ user_id: 'actor', full_name: `Reviewer ${id}` }],
    }),
    requestChanges: async (...args) => {
      mutations.push(args)
      if (mutations.length === 1) throw new Error('Response lost after commit')
    },
    signOff: async () => {}, createRequest: async () => {},
  }
  globalThis.__b06ProofingTest = { list: async () => [], add: async () => {}, resolve: async () => {} }
  const props = { version: { id: 'v2', version_number: 2 }, approval: null }
  await act(async () => root.render(createElement(ArtifactApprovalPanel, props)))
  await flushMounted()

  const changeText = async value => {
    const textarea = elements(environment.container, 'textarea')[0]
    assert.ok(textarea)
    const propsKey = Object.keys(textarea).find(key => key.startsWith('__reactProps'))
    assert.ok(propsKey)
    await act(async () => textarea[propsKey].onChange({ target: { value } }))
    await flushMounted()
  }
  const submit = async () => {
    const form = elements(environment.container, 'form')[0]
    assert.ok(form)
    await act(async () => form.dispatchEvent(new TestEvent('submit', { bubbles: true })))
    await flushMounted()
  }

  await changeText('Fix the committed response')
  await submit()
  assert.match(environment.container.textContent, /Response lost after commit/)
  assert.equal(elements(environment.container, 'form').length, 1)
  assert.equal(mutations.length, 1)

  await act(async () => root.render(createElement(ArtifactApprovalPanel, props)))
  await flushMounted()
  assert.equal(elements(environment.container, 'form').length, 1)
  await submit()
  assert.equal(mutations.length, 2)
  assert.equal(mutations[1][0], mutations[0][0])
  assert.equal(mutations[1][1], mutations[0][1])
  assert.equal(mutations[1][2], mutations[0][2])

  await changeText('A deliberate new feedback item')
  await submit()
  assert.equal(mutations.length, 3)
  assert.notEqual(mutations[2][2], mutations[0][2])
})
