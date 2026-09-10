import assert from 'node:assert/strict'
import test from 'node:test'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'
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
  setAttribute(name, value) { this.attributes.set(name, String(value)); if (name === 'value') this.value = String(value) }
  getAttribute(name) { return this.attributes.get(name) ?? null }
  removeAttribute(name) { this.attributes.delete(name) }
  hasAttribute(name) { return this.attributes.has(name) }
  focus() { this.ownerDocument.activeElement = this }
}

class TestText extends TestNode {
  constructor(data, ownerDocument) { super(3, '#text', ownerDocument); this.data = String(data) }
  get nodeValue() { return this.data }
  set nodeValue(value) { this.data = String(value) }
}

class TestDocument extends TestNode {
  constructor() { super(9, '#document'); this.ownerDocument = this; this.defaultView = null; this.documentElement = new TestElement('html', this); this.body = new TestElement('body', this); this.documentElement.appendChild(this.body); this.appendChild(this.documentElement); this.activeElement = this.body }
  createElement(tagName) { return new TestElement(tagName, this) }
  createElementNS(namespaceURI, tagName) { return new TestElement(tagName, this, namespaceURI) }
  createTextNode(data) { return new TestText(data, this) }
}

function mountedEnvironment() {
  const document = new TestDocument()
  const window = { document, addEventListener() {}, removeEventListener() {}, getSelection: () => null, setTimeout(callback, delay) { const timer = globalThis.setTimeout(callback, delay); timer.unref(); return timer }, clearTimeout, Event: TestEvent, Node: TestNode, Element: TestElement, HTMLElement: TestElement, HTMLIFrameElement: class extends TestElement {}, SVGElement: TestElement }
  document.defaultView = window
  return { document, window, container: document.createElement('div') }
}

function elements(root, tagName) {
  const result = []
  const tag = tagName.toUpperCase()
  function visit(node) { if (node.tagName === tag) result.push(node); for (const child of node.childNodes || []) visit(child) }
  visit(root)
  return result
}

function byText(root, tagName, text) {
  return elements(root, tagName).find(node => node.textContent.includes(text))
}

function workspace(requestedAt) {
  return {
    engagement: { id: 'engagement-a' }, mediaUrlsRequestedAt: requestedAt, mediaUrlExpiresIn: 300, mediaUrlOrigin: 'https://project.supabase.co',
    sessions: [{ id: 'session-a', output_goal: 'Launch assets' }], directions: [{ id: 'direction-a', session_id: 'session-a' }],
    directionVersions: [{ id: 'version-a', direction_id: 'direction-a', version_number: 1, content: { title: 'Hero asset' } }], experimentalDirectionVersions: [],
    imageGenerationJobs: [{ id: 'job-a', media_asset_id: 'asset-a', model_registry_id: 'model-a', status: 'succeeded' }], models: [{ id: 'model-a', display_name: 'Image model' }], variants: [],
    mediaAssets: [
      { id: 'asset-a', design_direction_version_id: 'version-a', media_type: 'image', status: 'ready', signed_url: 'https://project.supabase.co/storage/v1/object/sign/design/a.png?token=signed', created_at: '2026-09-11T11:00:00.000Z' },
      { id: 'asset-b', design_direction_version_id: 'version-a', media_type: 'image', status: 'failed', created_at: '2026-09-10T11:00:00.000Z' },
    ],
  }
}

test('asset library renders its read-only empty state, filters and keyboard controls', async t => {
  const server = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent' })
  t.after(() => server.close())
  const { default: DesignAssetLibrary } = await server.ssrLoadModule('/src/components/DesignAssetLibrary.jsx')
  const markup = renderToStaticMarkup(createElement(DesignAssetLibrary, {
    contextKey: 'engagement-a',
    workspace: { engagement: { id: 'engagement-a' }, mediaAssets: [], imageGenerationJobs: [], directionVersions: [], experimentalDirectionVersions: [], directions: [], sessions: [], models: [], variants: [], mediaUrlExpiresIn: 300 },
    onClose: () => {}, onFocusSource: () => {},
  }))
  assert.match(markup, /Design S05 · Read-only/)
  assert.match(markup, /No generated assets yet/)
  assert.match(markup, /All statuses/)
  assert.match(markup, /All sources/)
  assert.match(markup, /Any date/)
  assert.match(markup, /aria-pressed="true"/)
  assert.doesNotMatch(markup, /Upload asset|Approve asset|Archive asset|Generate image/)
})

test('mounted library selects, filters, clears, focuses source, resets context and expires links', async t => {
  const server = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent' })
  t.after(() => server.close())
  const { default: DesignAssetLibrary } = await server.ssrLoadModule('/src/components/DesignAssetLibrary.jsx')
  const environment = mountedEnvironment()
  const previous = { document: globalThis.document, window: globalThis.window, Event: globalThis.Event, Node: globalThis.Node, HTMLElement: globalThis.HTMLElement, act: globalThis.IS_REACT_ACT_ENVIRONMENT }
  Object.assign(globalThis, { document: environment.document, window: environment.window, Event: TestEvent, Node: TestNode, HTMLElement: TestElement, IS_REACT_ACT_ENVIRONMENT: true })
  t.after(() => Object.assign(globalThis, { document: previous.document, window: previous.window, Event: previous.Event, Node: previous.Node, HTMLElement: previous.HTMLElement, IS_REACT_ACT_ENVIRONMENT: previous.act }))
  const requestedAt = Date.parse('2026-09-11T12:00:00.000Z')
  let clock = requestedAt + 294000
  const originalNow = Date.now
  Date.now = () => clock
  t.after(() => { Date.now = originalNow })
  const focused = []
  const props = { workspace: workspace(requestedAt), contextKey: 'context-a', onClose: () => {}, onFocusSource: row => focused.push(row.id) }
  const root = createRoot(environment.container)
  t.after(() => { try { root.unmount() } catch { /* already unmounted */ } })

  await act(async () => root.render(createElement(DesignAssetLibrary, props)))
  assert.equal(elements(environment.container, 'img').length, 1)
  await act(async () => byText(environment.container, 'button', 'View detail').dispatchEvent(new TestEvent('click', { bubbles: true })))
  assert.ok(byText(environment.container, 'a', 'Open or save signed image'))
  await act(async () => byText(environment.container, 'button', 'Open source in Design desk').dispatchEvent(new TestEvent('click', { bubbles: true })))
  assert.deepEqual(focused, ['asset-a'])

  const status = elements(environment.container, 'select')[0]
  status.value = 'failed'
  await act(async () => status.dispatchEvent(new TestEvent('change', { bubbles: true })))
  assert.match(environment.container.textContent, /1 of 2 authorized assets/)
  await act(async () => byText(environment.container, 'button', 'Clear filters').dispatchEvent(new TestEvent('click', { bubbles: true })))
  assert.match(environment.container.textContent, /2 of 2 authorized assets/)

  await act(async () => root.render(createElement(DesignAssetLibrary, { ...props, contextKey: 'context-b' })))
  assert.equal(byText(environment.container, 'h3', 'Selected asset'), undefined)
  assert.equal(elements(environment.container, 'select')[0].value, 'all')

  clock += 1001
  await act(async () => root.render(createElement(DesignAssetLibrary, { ...props, contextKey: 'context-b' })))
  assert.equal(elements(environment.container, 'img').length, 0)
  await act(async () => byText(environment.container, 'button', 'View detail').dispatchEvent(new TestEvent('click', { bubbles: true })))
  assert.equal(byText(environment.container, 'a', 'Open or save signed image'), undefined)
  assert.match(environment.container.textContent, /signed image link has expired/)
})
