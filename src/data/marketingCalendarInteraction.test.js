import assert from 'node:assert/strict'
import test from 'node:test'
import { act, createElement } from 'react'
import { createServer } from 'vite'

class TestEvent { constructor(type) { this.type = type; this.bubbles = true; this.defaultPrevented = false } preventDefault() { this.defaultPrevented = true } stopPropagation() {} }
class TestNode {
  constructor(type, name, document = null) { this.nodeType = type; this.nodeName = name; this.ownerDocument = document; this.parentNode = null; this.childNodes = []; this.listeners = new Map() }
  appendChild(node) { node.parentNode = this; this.childNodes.push(node); return node }
  insertBefore(node, before) { const index = this.childNodes.indexOf(before); if (index < 0) return this.appendChild(node); node.parentNode = this; this.childNodes.splice(index, 0, node); return node }
  removeChild(node) { this.childNodes.splice(this.childNodes.indexOf(node), 1); node.parentNode = null; return node }
  addEventListener(type, listener) { this.listeners.set(type, [...(this.listeners.get(type) || []), listener]) }
  removeEventListener(type, listener) { this.listeners.set(type, (this.listeners.get(type) || []).filter(item => item !== listener)) }
  dispatchEvent(event) { Object.defineProperty(event, 'target', { configurable: true, value: this }); let node = this; while (node) { Object.defineProperty(event, 'currentTarget', { configurable: true, value: node }); for (const listener of node.listeners.get(event.type) || []) listener.call(node, event); if (!event.bubbles) break; node = node.parentNode } return !event.defaultPrevented }
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
  hasAttribute(name) { return this.attributes.has(name) }
  focus() { this.ownerDocument.activeElement = this }
}
class TestText extends TestNode { constructor(data, document) { super(3, '#text', document); this.data = String(data) } get nodeValue() { return this.data } set nodeValue(value) { this.data = String(value) } }
class TestDocument extends TestNode {
  constructor() { super(9, '#document'); this.ownerDocument = this; this.documentElement = new TestElement('html', this); this.body = new TestElement('body', this); this.documentElement.appendChild(this.body); this.appendChild(this.documentElement); this.activeElement = this.body; this.oninput = null }
  createElement(tag) { return new TestElement(tag, this) }
  createElementNS(namespace, tag) { return new TestElement(tag, this, namespace) }
  createTextNode(data) { return new TestText(data, this) }
}

const elements = (root, tag) => { const found = []; const name = tag.toUpperCase(); const visit = node => { if (node.tagName === name) found.push(node); for (const child of node.childNodes || []) visit(child) }; visit(root); return found }
const byText = (root, tag, text) => elements(root, tag).find(node => node.textContent.includes(text))
const byLabel = (root, label) => ['input', 'select'].flatMap(tag => elements(root, tag)).find(node => node.getAttribute('aria-label') === label)

async function change(node, value) {
  const previous = node.value; node.value = value; node._valueTracker?.setValue(previous)
  await act(async () => { node.dispatchEvent(new TestEvent('input')); node.dispatchEvent(new TestEvent('change')) })
}

test('mounted MB05 calendar switches views and filters real rendered cards without scheduling writes', async t => {
  const routerStub = { name: 'mb05-router-stub', enforce: 'pre', transform(code, id) { if (id.endsWith('/src/components/MarketingCalendar.jsx')) return code.replace("import { Link } from 'react-router-dom'", "const Link = ({ to, children, ...props }) => <a href={to} {...props}>{children}</a>") } }
  const server = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent', plugins: [routerStub], define: { 'import.meta.env.VITE_SUPABASE_URL': JSON.stringify('https://example.supabase.co'), 'import.meta.env.VITE_SUPABASE_ANON_KEY': JSON.stringify('test-key') } })
  t.after(() => server.close())
  const { default: MarketingCalendar } = await server.ssrLoadModule('/src/components/MarketingCalendar.jsx')
  const document = new TestDocument(); const window = { document, addEventListener() {}, removeEventListener() {}, getSelection: () => null, Event: TestEvent, Node: TestNode, Element: TestElement, HTMLElement: TestElement, HTMLIFrameElement: class extends TestElement {} }
  document.defaultView = window
  const previous = { document: globalThis.document, window: globalThis.window, Event: globalThis.Event, Node: globalThis.Node, HTMLElement: globalThis.HTMLElement, act: globalThis.IS_REACT_ACT_ENVIRONMENT }
  Object.assign(globalThis, { document, window, Event: TestEvent, Node: TestNode, HTMLElement: TestElement, IS_REACT_ACT_ENVIRONMENT: true })
  t.after(() => Object.assign(globalThis, previous))
  const container = document.createElement('div'); const { createRoot } = await import('react-dom/client'); const root = createRoot(container)
  t.after(() => { try { root.unmount() } catch { /* already unmounted */ } })
  const snapshot = {
    timezone: 'Asia/Karachi', owners: [{ id: 'owner-a', label: 'Amina' }], channels: ['Email', 'Search'], statuses: ['cancelled', 'completed', 'draft', 'planned'],
    entries: [
      { id: 'work:a', recordKind: 'engagement_work_item', recordId: 'a', title: 'Email work', calendarState: 'planned', plannedDate: '2026-09-10', endDate: '2026-09-10', engagementId: 'eng-a', channels: ['Email'], ownerId: 'owner-a', ownerLabel: 'Amina', campaignLabel: 'Launch', unresolvedDependencies: 1, unknownDependencies: 1, externallyPublished: false, href: '/sphere/workspace/items/engagement_work_item/a', plannerHref: '/sphere/workspace/projects/project-a?tab=retainer-planning' },
      { id: 'plan:b', recordKind: 'campaign_plan_draft', recordId: 'b', title: 'Search draft', calendarState: 'draft', plannedDate: '2026-09-11', endDate: '2026-09-12', engagementId: 'eng-a', channels: ['Search'], ownerId: 'owner-a', ownerLabel: 'Amina', campaignLabel: 'Launch', unresolvedDependencies: 0, externallyPublished: false, href: '/sphere/marketing/studio?tab=campaigns' },
      { id: 'task:c', recordKind: 'project_task', recordId: 'c', title: 'Finished task', calendarState: 'completed', plannedDate: '2026-09-13', endDate: '2026-09-13', engagementId: 'eng-a', channels: [], ownerId: '', ownerLabel: 'Unassigned', campaignLabel: '', unresolvedDependencies: 0, externallyPublished: false, href: '/sphere/workspace/items/project_task/c' },
      { id: 'task:e', recordKind: 'project_task', recordId: 'e', title: 'Cancelled task', calendarState: 'cancelled', plannedDate: '2026-09-14', endDate: '2026-09-14', engagementId: 'eng-a', channels: [], ownerId: '', ownerLabel: 'Unassigned', campaignLabel: '', unresolvedDependencies: 0, unknownDependencies: 0, externallyPublished: false, href: '/sphere/workspace/items/project_task/e' },
      { id: 'task:d', recordKind: 'project_task', recordId: 'd', title: 'Needs a date', calendarState: 'planned', plannedDate: '', endDate: '', engagementId: 'eng-a', channels: [], ownerId: '', ownerLabel: 'Unassigned', campaignLabel: '', unresolvedDependencies: 0, externallyPublished: false, href: '/sphere/workspace/items/project_task/d' },
    ],
  }
  let loads = 0
  await act(async () => root.render(createElement(MarketingCalendar, { organizationId: 'org-a', scopeRevision: 1, engagement: { id: 'eng-a', name: 'Launch' }, repository: { load: async () => { loads += 1; return snapshot } }, onAccessError: () => {} })))
  await change(byLabel(container, 'Marketing calendar month'), '2026-09')
  assert.match(container.textContent, /Email work/)
  assert.match(container.textContent, /Search draft/)
  assert.match(container.textContent, /Needs a date/)
  await act(async () => byText(container, 'button', 'List').dispatchEvent(new TestEvent('click')))
  await change(byLabel(container, 'Calendar channel filter'), 'Email')
  assert.match(container.textContent, /Email work/)
  assert.doesNotMatch(container.textContent, /Search draft/)
  assert.match(container.textContent, /Recurring planner/)
  assert.match(container.textContent, /1 prerequisite status unknown/)
  await change(byLabel(container, 'Calendar channel filter'), '')
  await change(byLabel(container, 'Calendar status filter'), 'completed')
  assert.match(container.textContent, /Finished task/)
  assert.match(container.textContent, /no external publication evidence is linked/)
  await change(byLabel(container, 'Calendar status filter'), 'cancelled')
  assert.match(container.textContent, /Cancelled task/)
  assert.doesNotMatch(container.textContent, /Finished task/)
  await act(async () => byText(container, 'button', 'Refresh').dispatchEvent(new TestEvent('click')))
  assert.equal(loads, 2)
})
