import assert from 'node:assert/strict'
import test from 'node:test'
import { act, createElement } from 'react'
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
  constructor(tagName, ownerDocument, namespaceURI = 'http://www.w3.org/1999/xhtml') { super(1, tagName.toUpperCase(), ownerDocument); this.tagName = this.nodeName; this.namespaceURI = namespaceURI; this.attributes = new Map(); this.style = { setProperty(name, value) { this[name] = value }, removeProperty(name) { delete this[name] } }; this._value = ''; this.checked = false; this.disabled = false; this.selected = false }
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

function environment() {
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

function field(root, label) {
  const wrapper = elements(root, 'label').find(node => node.textContent.startsWith(label))
  return ['input', 'textarea', 'select'].flatMap(tag => elements(wrapper, tag))[0]
}

async function setValue(node, value) {
  const previous = node.value; node.value = value; node._valueTracker?.setValue(previous)
  await act(async () => { node.dispatchEvent(new TestEvent('input')); node.dispatchEvent(new TestEvent('change')) })
}

const deferred = () => { let resolve; const promise = new Promise(yes => { resolve = yes }); return { promise, resolve } }

test('mounted SEO Research rejects a stale pending preview after the market changes', async t => {
  const server = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent' })
  t.after(() => server.close())
  const { default: MarketingSeoResearch } = await server.ssrLoadModule('/src/components/MarketingSeoResearch.jsx')
  const env = environment()
  const previous = { document: globalThis.document, window: globalThis.window, Event: globalThis.Event, Node: globalThis.Node, HTMLElement: globalThis.HTMLElement, testing: globalThis.IS_REACT_ACT_ENVIRONMENT }
  Object.assign(globalThis, { document: env.document, window: env.window, Event: TestEvent, Node: TestNode, HTMLElement: TestElement, IS_REACT_ACT_ENVIRONMENT: true })
  t.after(() => Object.assign(globalThis, { document: previous.document, window: previous.window, Event: previous.Event, Node: previous.Node, HTMLElement: previous.HTMLElement, IS_REACT_ACT_ENVIRONMENT: previous.testing }))
  const { createRoot } = await import('react-dom/client')
  const root = createRoot(env.container)
  t.after(() => { try { root.unmount() } catch { /* already unmounted */ } })
  const first = deferred(); const saves = []; let previews = 0
  const result = market => ({
    input: { research_type: 'page', target_url: 'https://example.test/page', market, language: null, device: null, seed_keywords: [], content_strategy_version_id: null },
    captured_at: '2026-09-12T00:00:00Z', preview_signature: 'a'.repeat(64), source_availability: [],
    source_facts: [{ category: 'page', observation: `${market} evidence`, source: 'tracked_page_registry', evidence_date: '2026-09-12', affected_url: 'https://example.test/page', source_record_id: '8a6d2c5e-2c99-4ec7-a92f-6d1bd877eb25' }],
    interpretations: [], limitations: [],
  })
  const repository = {
    loadAvailability: async () => ({ technicalSeoPages: 1, trackedKeywords: 0, contentStrategies: [], activeContentService: false }),
    preview: async ({ research }) => ++previews === 1 ? first.promise : result(research.market),
    save: async input => { saves.push(input); return { replayed: false } },
  }
  await act(async () => root.render(createElement(MarketingSeoResearch, {
    organizationId: 'org-a', scopeRevision: 1, signal: new AbortController().signal,
    engagement: { id: 'eng-a', brand_id: 'brand-a' }, repository,
    act: async callback => callback(), onAccessError: () => {},
  })))
  await setValue(field(env.container, 'Research type'), 'page')
  await setValue(field(env.container, 'Market'), 'Old market')
  await setValue(field(env.container, 'Target domain or page URL'), 'https://example.test/page')
  assert.equal(field(env.container, 'Research type').value, 'page')
  assert.equal(field(env.container, 'Market').value, 'Old market')
  assert.equal(field(env.container, 'Target domain or page URL').value, 'https://example.test/page')
  await act(async () => elements(env.container, 'form')[0].dispatchEvent(new TestEvent('submit')))
  assert.match(env.container.textContent, /Building preview/)
  await setValue(field(env.container, 'Market'), 'New market')
  assert.doesNotMatch(env.container.textContent, /Building preview/)
  await act(async () => first.resolve(result('Old market')))
  assert.doesNotMatch(env.container.textContent, /Old market evidence/)
  assert.equal(saves.length, 0)
  await act(async () => elements(env.container, 'form')[0].dispatchEvent(new TestEvent('submit')))
  assert.match(env.container.textContent, /New market evidence/)
  const saveButton = elements(env.container, 'button').find(node => node.textContent === 'Save research')
  await act(async () => saveButton.dispatchEvent(new TestEvent('click')))
  assert.equal(saves.length, 1)
  assert.equal(saves[0].research.input.market, 'New market')
})
