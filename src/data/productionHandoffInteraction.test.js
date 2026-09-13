import assert from 'node:assert/strict'
import test from 'node:test'
import { act, createElement, useState } from 'react'
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
  constructor(tagName, ownerDocument, namespaceURI = 'http://www.w3.org/1999/xhtml') { super(1, tagName.toUpperCase(), ownerDocument); this.tagName = this.nodeName; this.namespaceURI = namespaceURI; this.attributes = new Map(); this.style = { setProperty(name, value) { this[name] = value }, removeProperty(name) { delete this[name] } }; this._value = ''; this.disabled = false }
  setAttribute(name, value) { this.attributes.set(name, String(value)); if (name === 'disabled') this.disabled = true }
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
  const window = { document, setTimeout, clearTimeout, addEventListener() {}, removeEventListener() {}, getSelection: () => null, Event: TestEvent, Node: TestNode, Element: TestElement, HTMLElement: TestElement, HTMLIFrameElement: class extends TestElement {}, SVGElement: TestElement }
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
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done }); return { promise, resolve } }

function fixture() {
  return {
    release: { id: 'release-1', direction_version_id: 'version-2' },
    packages: [],
    directionVersions: [{ id: 'version-2', version_number: 2, content_checksum: 'checksum-2' }],
    mediaAssets: [{ id: 'asset-image', design_direction_version_id: 'version-2', content_request_id: null, media_type: 'image', status: 'ready', storage_path: 'org/version-2/image.png', signed_url: 'https://storage.example.test/storage/v1/object/sign/design/image.png?token=mock' }],
    variants: [],
    mediaAccess: { issuedAt: Date.now(), expiresInSeconds: 5, trustedOrigin: 'https://storage.example.test' },
    canPrepare: true,
    busy: '',
    onPrepare: async () => {},
    onDownload: async () => {},
    onRefresh: async () => true,
  }
}

async function setup(t) {
  const vite = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent' })
  t.after(() => vite.close())
  const { default: Panel } = await vite.ssrLoadModule('/src/components/ProductionHandoffPanel.jsx')
  const { productionHandoffContextKey } = await vite.ssrLoadModule('/src/data/productionHandoffReadiness.js')
  const environment = mountedEnvironment()
  const previous = { document: globalThis.document, window: globalThis.window, Event: globalThis.Event, Node: globalThis.Node, HTMLElement: globalThis.HTMLElement, act: globalThis.IS_REACT_ACT_ENVIRONMENT }
  Object.assign(globalThis, { document: environment.document, window: environment.window, Event: TestEvent, Node: TestNode, HTMLElement: TestElement, IS_REACT_ACT_ENVIRONMENT: true })
  t.after(() => Object.assign(globalThis, { document: previous.document, window: previous.window, Event: previous.Event, Node: previous.Node, HTMLElement: previous.HTMLElement, IS_REACT_ACT_ENVIRONMENT: previous.act }))
  const root = createRoot(environment.container)
  t.after(() => { try { root.unmount() } catch { /* already unmounted */ } })
  return { ...environment, root, Panel, productionHandoffContextKey }
}

async function click(container, label) {
  const button = byText(container, 'button', label)
  assert.ok(button, `Missing ${label}`)
  assert.equal(button.disabled, false)
  await act(async () => button.dispatchEvent(new TestEvent('click', { bubbles: true })))
  await flushMounted()
}

test('handoff uncertainty survives the real loading replacement until exact refresh succeeds', async t => {
  const environment = await setup(t)
  const props = fixture()
  const refreshGate = deferred()
  let creates = 0
  let refreshSucceeds = false
  props.onPrepare = async () => { creates += 1; throw new Error('Lost committed create response') }

  function Parent() {
    const [busy, setBusy] = useState('')
    const [uncertainTarget, setUncertainTarget] = useState('')
    const targetKey = environment.productionHandoffContextKey(props.release)
    async function prepare(release) {
      try { await props.onPrepare(release) } catch (reason) {
        setUncertainTarget(environment.productionHandoffContextKey(release))
        throw reason
      }
    }
    async function refresh(release) {
      setBusy('load')
      await refreshGate.promise
      setBusy('')
      if (refreshSucceeds) setUncertainTarget(current => current === environment.productionHandoffContextKey(release) ? '' : current)
      return refreshSucceeds
    }
    return busy === 'load'
      ? createElement('p', null, 'Loading exact versions…')
      : createElement(environment.Panel, {
        ...props, key: targetKey, busy, createUncertain: uncertainTarget === targetKey,
        onPrepare: prepare, onRefresh: () => refresh(props.release),
      })
  }

  await act(async () => environment.root.render(createElement(Parent)))
  await flushMounted()
  await click(environment.container, 'Prepare production')
  assert.equal(creates, 1)
  await click(environment.container, 'Refresh exact handoff status')
  assert.match(environment.container.textContent, /Loading exact versions/)
  await act(async () => refreshGate.resolve())
  await flushMounted()
  assert.equal(byText(environment.container, 'button', 'Prepare production').disabled, true)
  assert.match(environment.container.textContent, /remains locked/)
})

test('an open temporary preview expires without interaction and cannot remain activatable', async t => {
  const environment = await setup(t)
  const props = fixture()
  const actualNow = Date.now
  let now = actualNow()
  let expiryCallback
  Date.now = () => now
  t.after(() => { Date.now = actualNow })
  environment.window.setTimeout = callback => { expiryCallback = callback; return 1 }
  environment.window.clearTimeout = () => {}
  props.mediaAccess.expiresInSeconds = 6
  props.mediaAccess.issuedAt = now
  await act(async () => environment.root.render(createElement(environment.Panel, props)))
  await flushMounted()
  await click(environment.container, 'Review exact contents')
  assert.equal(elements(environment.container, 'a').length, 1)
  assert.equal(typeof expiryCallback, 'function')
  now += 1100
  await act(async () => expiryCallback())
  await flushMounted()
  assert.equal(elements(environment.container, 'a').length, 0)
  assert.match(environment.container.textContent, /signed image link has expired/)
})
