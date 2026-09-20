import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { createServer } from 'vite'

class TestEvent {
  constructor(type, options = {}) { this.type = type; this.bubbles = options.bubbles !== false; this.cancelable = true; this.defaultPrevented = false; this.propagationStopped = false; Object.assign(this, options) }
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
  constructor(tagName, ownerDocument, namespaceURI = 'http://www.w3.org/1999/xhtml') { super(1, tagName.toUpperCase(), ownerDocument); this.tagName = this.nodeName; this.namespaceURI = namespaceURI; this.attributes = new Map(); this.style = { setProperty(name, value) { this[name] = value }, removeProperty(name) { delete this[name] } }; this.disabled = false; this.tabIndex = 0 }
  setAttribute(name, value) { this.attributes.set(name, String(value)); if (name.toLowerCase() === 'tabindex') this.tabIndex = Number(value); if (name === 'disabled') this.disabled = true }
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
  constructor() { super(9, '#document'); this.ownerDocument = this; this.defaultView = null; this.documentElement = new TestElement('html', this); this.body = new TestElement('body', this); this.documentElement.appendChild(this.body); this.appendChild(this.documentElement); this.activeElement = this.body }
  createElement(tagName) { return new TestElement(tagName, this) }
  createElementNS(namespaceURI, tagName) { return new TestElement(tagName, this, namespaceURI) }
  createTextNode(data) { return new TestText(data, this) }
}

function installEnvironment(t) {
  const document = new TestDocument()
  const window = { document, addEventListener() {}, removeEventListener() {}, getSelection: () => null, Event: TestEvent, Node: TestNode, Element: TestElement, HTMLElement: TestElement, HTMLIFrameElement: class extends TestElement {}, SVGElement: TestElement }
  document.defaultView = window
  const previous = { document: globalThis.document, window: globalThis.window, Event: globalThis.Event, Node: globalThis.Node, HTMLElement: globalThis.HTMLElement, act: globalThis.IS_REACT_ACT_ENVIRONMENT }
  Object.assign(globalThis, { document, window, Event: TestEvent, Node: TestNode, HTMLElement: TestElement, IS_REACT_ACT_ENVIRONMENT: true })
  t.after(() => Object.assign(globalThis, { document: previous.document, window: previous.window, Event: previous.Event, Node: previous.Node, HTMLElement: previous.HTMLElement, IS_REACT_ACT_ENVIRONMENT: previous.act }))
  return { document, container: document.createElement('div') }
}

function elements(root, tagName) {
  const result = []; const tag = tagName.toUpperCase()
  function visit(node) { if (node.tagName === tag) result.push(node); for (const child of node.childNodes || []) visit(child) }
  visit(root); return result
}

const byText = (root, tagName, text) => elements(root, tagName).find(node => node.textContent.includes(text))
const click = node => act(async () => node.dispatchEvent(new TestEvent('click', { bubbles: true, button: 0 })))

function mountedServer() {
  return createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent', plugins: [{
    name: 'b01-router-link-stub', enforce: 'pre',
    resolveId(source) { if (source === 'react-router-dom') return '\0b01-router-link' },
    load(id) { if (id === '\0b01-router-link') return 'import {createElement} from "react"; export const Link=({to,...props})=>createElement("a",{...props,href:to})' },
  }] })
}

function workspace(id = 'engagement-a', artifacts = null) {
  const rows = artifacts || [
    { id: 'brief-a', artifact_type: 'discovery', title: 'Launch discovery', created_by: 'author-a', created_at: '2026-09-01T00:00:00Z' },
    { id: 'copy-a', artifact_type: 'content', title: 'Homepage copy', created_by: 'author-b', created_at: '2026-09-02T00:00:00Z' },
  ]
  return {
    engagement: { id, organization_id: `organization-${id}`, project_id: `project-${id}`, brand_id: `brand-${id}`, name: `Project ${id}`, brands: { name: `Brand ${id}` } },
    contentServices: [{ id: `service-${id}`, status: 'active', service_catalog: { department_id: 'content' } }],
    artifacts: rows,
    versions: rows.map((item, index) => ({ id: `${item.id}-v1`, artifact_id: item.id, version_number: 1,
      content_checksum: `checksum-${item.id}`, content: { body: `Exact ${item.title}` }, created_by: item.created_by,
      created_at: `2026-09-0${index + 2}T00:00:00Z` })),
    approvals: [{ artifact_id: rows[0]?.id, artifact_version_id: `${rows[0]?.id}-v1` }],
  }
}

test('mounted B01 Home renders grouped records, exact output, navigation, and keyboard focus after explicit selection', async t => {
  const vite = await mountedServer()
  t.after(() => vite.close())
  const { default: ContentWorkshopHomePanel } = await vite.ssrLoadModule('/src/components/ContentWorkshopHomePanel.jsx')
  const environment = installEnvironment(t)
  const root = createRoot(environment.container)
  t.after(() => { try { root.unmount() } catch { /* already unmounted */ } })
  const actions = []
  await act(async () => root.render(createElement(MemoryRouter, null, createElement(ContentWorkshopHomePanel, {
    workspace: workspace(), onNewContent: () => actions.push('new'), onOpenBrief: () => actions.push('brief'),
    onOpenEditor: (item, editorTab) => actions.push(`edit:${item.id}:${editorTab}`),
  }))))

  for (const group of ['Brief', 'Brand foundations', 'Website structure', 'Keywords', 'Content', 'Review']) {
    assert.ok(byText(environment.container, 'h3', group), `${group} group was not rendered`)
  }
  assert.match(environment.container.textContent, /Nothing has been selected automatically/)
  await click(byText(environment.container, 'button', 'Launch discovery'))
  assert.match(environment.container.textContent, /brief-a-v1/)
  assert.match(environment.container.textContent, /Exact Launch discovery/)
  assert.equal(environment.document.activeElement.textContent, 'Launch discovery')
  assert.equal(byText(environment.container, 'a', 'Open canonical artifact').getAttribute('href'), '/sphere/artifacts/brief-a')
  await click(byText(environment.container, 'button', 'Continue in Content editor'))
  await click(byText(environment.container, 'button', 'New content'))
  await click(byText(environment.container, 'button', 'Open brief'))
  assert.deepEqual(actions, ['edit:brief-a:artifacts', 'new', 'brief'])
  assert.ok(elements(environment.container, 'button').every(button => button.tabIndex >= -1))
})

test('mounted B01 Home keeps ambiguous roots unselected and resolves readiness only after an explicit choice', async t => {
  const vite = await mountedServer()
  t.after(() => vite.close())
  const { default: ContentWorkshopHomePanel } = await vite.ssrLoadModule('/src/components/ContentWorkshopHomePanel.jsx')
  const environment = installEnvironment(t)
  const root = createRoot(environment.container)
  t.after(() => { try { root.unmount() } catch { /* already unmounted */ } })
  const duplicate = [
    { id: 'brief-old', artifact_type: 'discovery', title: 'Original discovery', created_by: 'a' },
    { id: 'brief-new', artifact_type: 'discovery', title: 'New discovery', created_by: 'b' },
  ]
  await act(async () => root.render(createElement(MemoryRouter, null, createElement(ContentWorkshopHomePanel, { workspace: workspace('engagement-a', duplicate), onNewContent() {}, onOpenBrief() {}, onOpenEditor() {} }))))
  assert.match(environment.container.textContent, /Selection required/)
  assert.match(environment.container.textContent, /Choose the intended artifact root; none is selected by default/)
  await click(byText(environment.container, 'button', 'New discovery'))
  assert.match(environment.container.textContent, /Multiple Discovery roots exist/)
  assert.equal(byText(environment.container, 'button', 'Continue in Content editor'), undefined)
  const readinessChoice = elements(environment.container, 'button').filter(button => button.textContent === 'New discovery').at(-1)
  await click(readinessChoice)
  assert.match(environment.container.textContent, /Clear explicit selection/)
})

test('mounted B01 Home routes only exact compatible records to their real editor', async t => {
  const vite = await mountedServer()
  t.after(() => vite.close())
  const { default: ContentWorkshopHomePanel } = await vite.ssrLoadModule('/src/components/ContentWorkshopHomePanel.jsx')
  const environment = installEnvironment(t)
  const root = createRoot(environment.container)
  t.after(() => { try { root.unmount() } catch { /* already unmounted */ } })
  const actions = []
  const render = nextWorkspace => act(async () => root.render(createElement(MemoryRouter, null, createElement(ContentWorkshopHomePanel, {
    workspace: nextWorkspace, onNewContent() {}, onOpenBrief() {},
    onOpenEditor: (item, editorTab) => actions.push(`${item.id}:${editorTab}`),
  }))))

  await render(workspace('unsupported', [{ id: 'brand-a', artifact_type: 'brand_statement', title: 'Brand statement', created_by: 'a' }]))
  await click(byText(environment.container, 'button', 'Brand statement'))
  assert.equal(byText(environment.container, 'button', 'Continue in Content editor'), undefined)
  assert.match(environment.container.textContent, /No compatible exact editor is available/)

  const writer = workspace('writer', [{ id: 'writer-a', artifact_type: 'content', title: 'Writer draft', created_by: 'a' }])
  writer.versions[0].content = { schema_version: 2, output_type: 'blog_article', working_title: 'Writer draft', body: 'Exact writer body' }
  await render(writer)
  await click(byText(environment.container, 'button', 'Writer draft'))
  assert.equal(byText(environment.container, 'button', 'Continue in Content editor'), undefined)
  await click(byText(environment.container, 'button', 'Open Production writer to continue'))
  assert.deepEqual(actions, ['writer-a:writer'])
})

test('mounted B01 Home resets exact selection on engagement switch and distinguishes stale, empty, denied, loading, and failed states', async t => {
  const vite = await mountedServer()
  t.after(() => vite.close())
  const { default: ContentWorkshopHomePanel } = await vite.ssrLoadModule('/src/components/ContentWorkshopHomePanel.jsx')
  const environment = installEnvironment(t)
  const root = createRoot(environment.container)
  t.after(() => { try { root.unmount() } catch { /* already unmounted */ } })
  const render = props => act(async () => root.render(createElement(MemoryRouter, null, createElement(ContentWorkshopHomePanel, { onNewContent() {}, onOpenBrief() {}, onOpenEditor() {}, ...props }))))

  await render({ workspace: workspace('engagement-a') })
  await click(byText(environment.container, 'button', 'Launch discovery'))
  assert.match(environment.container.textContent, /brief-a-v1/)
  await render({ workspace: workspace('engagement-b') })
  assert.match(environment.container.textContent, /Nothing has been selected automatically/)
  assert.doesNotMatch(environment.container.textContent, /brief-a-v1/)

  let retries = 0
  await render({ workspace: workspace('engagement-b'), stale: true, onRetry() { retries += 1 } })
  assert.match(environment.container.textContent, /last verified snapshot is read-only/)
  await click(byText(environment.container, 'button', 'Retry current Content work'))
  assert.equal(retries, 1)
  assert.equal(byText(environment.container, 'button', 'New content').disabled, true)
  await render({ workspace: workspace('empty', []), loadState: 'ready' })
  assert.match(environment.container.textContent, /empty result, not a permission denial/)
  await render({ workspace: { secret: 'hidden-record-sentinel' }, loadState: 'denied' })
  assert.match(environment.container.textContent, /do not have access/)
  assert.doesNotMatch(environment.container.textContent, /hidden-record-sentinel/)
  await render({ workspace: null, loadState: 'loading' })
  assert.match(environment.container.textContent, /Loading Content home/)
  await render({ workspace: null, loadState: 'error', error: 'offline evidence' })
  assert.match(environment.container.textContent, /could not be loaded/)
  assert.match(environment.container.textContent, /offline evidence/)
})

test('B01 Home integration reuses released reads and does not adopt B07, chat, schema, or writer authority', () => {
  const panel = readFileSync(new URL('../components/ContentWorkshopHomePanel.jsx', import.meta.url), 'utf8')
  const studio = readFileSync(new URL('../apps/ContentStudio.jsx', import.meta.url), 'utf8')
  assert.match(studio, /ContentWorkshopHomePanel/)
  assert.ok(studio.includes('workshopTab: nextTab,'))
  assert.ok(!studio.includes("nextTab === 'artifacts' ? '' : nextTab"))
  assert.ok(studio.includes('generation !== loadGeneration.current'))
  assert.match(studio, /requestedTab\) \? requestedTab : 'home'/)
  assert.match(studio, /\['home', 'Content home'\]/)
  assert.match(studio, /onNewContent=\{\(\) => selectTab\('writer'\)\}/)
  assert.match(panel, /buildContentHomeIndex/)
  assert.match(panel, /contentSourceReadiness/)
  assert.match(panel, /View exact source/)
  assert.ok(panel.includes('No compatible exact editor is available'))
  assert.ok(panel.includes('recordedContentSourceSelections'))
  assert.ok(panel.includes('Open Production writer to continue'))
  assert.doesNotMatch(panel, /ContentLibraryPanel|contentStudioRepository|DepartmentChat|supabase|functions\.invoke|insert\(|update\(|delete\(/i)
})
