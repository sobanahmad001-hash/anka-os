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

const flush = () => act(async () => { await Promise.resolve(); await new Promise(resolve => setTimeout(resolve, 0)); await Promise.resolve() })

function library() {
  return {
    services: [{ id: 'service-a', engagement_id: 'engagement-a', engagements: { id: 'engagement-a', name: 'Alpha engagement' } }], stages: [],
    artifacts: [
      { id: 'artifact-a', title: 'System Alpha', engagement_id: 'engagement-a' },
      { id: 'artifact-b', title: 'System Beta', engagement_id: 'engagement-b' },
    ],
    versions: [
      { id: 'a-v1', artifact_id: 'artifact-a', version_number: 1, content: { usage_rules: 'Alpha released rules' } },
      { id: 'a-v2', artifact_id: 'artifact-a', version_number: 2, content: { usage_rules: 'Alpha exact draft rules' } },
      { id: 'b-v1', artifact_id: 'artifact-b', version_number: 1, content: { usage_rules: 'Beta released rules' } },
    ],
    approvals: [
      { artifact_id: 'artifact-a', artifact_version_id: 'a-v1' },
      { artifact_id: 'artifact-b', artifact_version_id: 'b-v1' },
    ],
  }
}

function stubs() {
  const modules = {
    'react-router-dom': ['design-systems-router-stub', `import {createElement,useSyncExternalStore} from 'react'; const listeners=new Set(); const read=()=>globalThis.__designSystemsTestSearch || ''; const navigate=next=>{globalThis.__designSystemsTestSearch=new URLSearchParams(next).toString(); for(const listener of listeners) listener()}; globalThis.__designSystemsTestNavigate=navigate; export function useSearchParams(){const value=useSyncExternalStore(listener=>{listeners.add(listener); return ()=>listeners.delete(listener)},read,read); return [new URLSearchParams(value),navigate]} export function Link({children,to,...props}){return createElement('a',{...props,href:to},children)}`],
    'designSystemsRepository.js': ['design-systems-repository-stub', 'export const designSystems=new Proxy({}, {get:(_,key)=>(...args)=>globalThis.__designSystemsTestRepository[key](...args)})'],
    'ArtifactApprovalPanel.jsx': ['design-systems-approval-stub', "import {createElement} from 'react'; export default function Stub(){return createElement('p',null,'Approval panel stub')}"] ,
    'ArtifactRelationsPanel.jsx': ['design-systems-relations-stub', "import {createElement} from 'react'; export default function Stub(){return createElement('p',null,'Relations panel stub')}"] ,
    'VersionProofingPanel.jsx': ['design-systems-proofing-stub', "import {createElement} from 'react'; export default function Stub(){return createElement('p',null,'Proofing panel stub')}"] ,
    'DepartmentChat.jsx': ['design-systems-chat-stub', "import {createElement} from 'react'; export default function Stub(){return createElement('p',null,'Chat panel stub')}"] ,
  }
  return {
    name: 'design-systems-interaction-stubs', enforce: 'pre',
    resolveId(source) { for (const [suffix, [id]] of Object.entries(modules)) if (source === suffix || source.endsWith(suffix)) return `\0${id}` },
    load(id) { return Object.values(modules).find(([key]) => id === `\0${key}`)?.[1] },
  }
}

test('mounted DesignSystems resolves a valid exact pair and fails closed for stale, crossed, and denied pairs', async t => {
  const vite = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent', ssr: { noExternal: ['react-router-dom'] }, plugins: [stubs()] })
  t.after(() => vite.close())
  const { default: DesignSystems } = await vite.ssrLoadModule('/src/apps/DesignSystems.jsx')
  const document = new TestDocument()
  const window = { document, setTimeout, clearTimeout, addEventListener() {}, removeEventListener() {}, getSelection: () => null, Event: TestEvent, Node: TestNode, Element: TestElement, HTMLElement: TestElement, HTMLIFrameElement: class extends TestElement {}, SVGElement: TestElement }
  document.defaultView = window
  const previous = { document: globalThis.document, window: globalThis.window, Event: globalThis.Event, Node: globalThis.Node, HTMLElement: globalThis.HTMLElement, act: globalThis.IS_REACT_ACT_ENVIRONMENT, repository: globalThis.__designSystemsTestRepository, search: globalThis.__designSystemsTestSearch }
  Object.assign(globalThis, { document, window, Event: TestEvent, Node: TestNode, HTMLElement: TestElement, IS_REACT_ACT_ENVIRONMENT: true })
  t.after(() => Object.assign(globalThis, { document: previous.document, window: previous.window, Event: previous.Event, Node: previous.Node, HTMLElement: previous.HTMLElement, IS_REACT_ACT_ENVIRONMENT: previous.act, __designSystemsTestRepository: previous.repository, __designSystemsTestSearch: previous.search }))

  async function render(url, data = library()) {
    globalThis.__designSystemsTestRepository = { loadLibrary: async () => data }
    globalThis.__designSystemsTestSearch = url.split('?')[1] || ''
    const container = document.createElement('div')
    const root = createRoot(container)
    await act(async () => root.render(createElement(DesignSystems)))
    await flush(); await flush()
    const content = container.textContent
    await act(async () => root.unmount())
    return content
  }

  const exact = await render('/sphere/design/systems?artifact=artifact-a&version=a-v2')
  assert.match(exact, /System Alpha/)
  assert.match(exact, /Alpha exact draft rules/)
  assert.doesNotMatch(exact, /Exact Design System unavailable/)

  const invalidCases = [
    ['/sphere/design/systems?artifact=artifact-a&version=b-v1', library()],
    ['/sphere/design/systems?artifact=unknown-root&version=a-v1', library()],
    ['/sphere/design/systems?artifact=artifact-a&version=unknown-version', library()],
    ['/sphere/design/systems?artifact=artifact-a&version=a-v2', { ...library(), artifacts: [library().artifacts[1]], versions: [library().versions[2]], approvals: [library().approvals[1]] }],
  ]
  for (const [url, data] of invalidCases) {
    const content = await render(url, data)
    assert.match(content, /Exact Design System unavailable/)
    assert.match(content, /No other artifact or version was substituted/)
    assert.doesNotMatch(content, /Alpha released rules|Alpha exact draft rules|Beta released rules/)
  }

  const normal = await render('/sphere/design/systems')
  assert.match(normal, /System Alpha/)
  assert.match(normal, /Alpha released rules/)
})

function findElement(node, predicate) {
  if (node?.nodeType === 1 && predicate(node)) return node
  for (const child of node?.childNodes || []) {
    const match = findElement(child, predicate)
    if (match) return match
  }
  return null
}

function deferred() {
  let resolve
  let reject
  const promise = new Promise((resolvePromise, rejectPromise) => { resolve = resolvePromise; reject = rejectPromise })
  return { promise, resolve, reject }
}

async function mountedHarness(t, DesignSystems, document) {
  const container = document.createElement('div')
  const root = createRoot(container)
  await act(async () => root.render(createElement(DesignSystems)))
  t.after(() => act(async () => root.unmount()))
  return { container }
}

test('mounted DesignSystems preserves explicit creation mode across the query-clearing reload', async t => {
  const vite = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent', ssr: { noExternal: ['react-router-dom'] }, plugins: [stubs()] })
  t.after(() => vite.close())
  const { default: DesignSystems } = await vite.ssrLoadModule('/src/apps/DesignSystems.jsx')
  const document = new TestDocument()
  const window = { document, setTimeout, clearTimeout, addEventListener() {}, removeEventListener() {}, getSelection: () => null, Event: TestEvent, Node: TestNode, Element: TestElement, HTMLElement: TestElement, HTMLIFrameElement: class extends TestElement {}, SVGElement: TestElement }
  document.defaultView = window
  Object.assign(globalThis, { document, window, Event: TestEvent, Node: TestNode, HTMLElement: TestElement, IS_REACT_ACT_ENVIRONMENT: true, __designSystemsTestSearch: 'artifact=artifact-a&version=a-v2', __designSystemsTestRepository: { loadLibrary: async () => library() } })
  const { container } = await mountedHarness(t, DesignSystems, document)
  await flush(); await flush()

  const createButton = findElement(container, node => node.tagName === 'BUTTON' && node.textContent === 'New design system')
  assert.ok(createButton)
  await act(async () => createButton.dispatchEvent(new TestEvent('click')))
  await flush(); await flush()

  assert.match(container.textContent, /Create a design system/)
  assert.match(container.textContent, /Creating a new manual design system draft/)
  const titleInput = findElement(container, node => node.tagName === 'INPUT' && node.getAttribute('required') !== null)
  assert.equal(titleInput?.value, '')
  assert.doesNotMatch(container.textContent, /Alpha exact draft rules|Alpha released rules/)
})

test('mounted DesignSystems ignores a stale exact-load result after navigation to an unavailable pair', async t => {
  const vite = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent', ssr: { noExternal: ['react-router-dom'] }, plugins: [stubs()] })
  t.after(() => vite.close())
  const { default: DesignSystems } = await vite.ssrLoadModule('/src/apps/DesignSystems.jsx')
  const document = new TestDocument()
  const window = { document, setTimeout, clearTimeout, addEventListener() {}, removeEventListener() {}, getSelection: () => null, Event: TestEvent, Node: TestNode, Element: TestElement, HTMLElement: TestElement, HTMLIFrameElement: class extends TestElement {}, SVGElement: TestElement }
  document.defaultView = window
  const firstLoad = deferred()
  let calls = 0
  Object.assign(globalThis, { document, window, Event: TestEvent, Node: TestNode, HTMLElement: TestElement, IS_REACT_ACT_ENVIRONMENT: true, __designSystemsTestSearch: 'artifact=artifact-a&version=a-v2', __designSystemsTestRepository: { loadLibrary: async () => ++calls === 1 ? firstLoad.promise : library() } })
  const { container } = await mountedHarness(t, DesignSystems, document)

  await act(async () => globalThis.__designSystemsTestNavigate({ artifact: 'unavailable-artifact', version: 'unavailable-version' }))
  await flush(); await flush()
  assert.match(container.textContent, /Exact Design System unavailable/)

  firstLoad.resolve(library())
  await flush(); await flush()
  assert.match(container.textContent, /Exact Design System unavailable/)
  assert.match(container.textContent, /No other artifact or version was substituted/)
  assert.doesNotMatch(container.textContent, /Alpha exact draft rules|Alpha released rules/)
})
