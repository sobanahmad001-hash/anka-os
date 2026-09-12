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
