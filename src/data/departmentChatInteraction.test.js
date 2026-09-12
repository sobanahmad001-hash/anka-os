import assert from 'node:assert/strict'
import test from 'node:test'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { createServer } from 'vite'

class E {
  constructor(type, options = {}) { this.type = type; this.bubbles = options.bubbles !== false; this.cancelable = true; this.defaultPrevented = false; this.propagationStopped = false }
  preventDefault() { this.defaultPrevented = true }
  stopPropagation() { this.propagationStopped = true }
}
class N {
  constructor(type, name, document = null) { this.nodeType = type; this.nodeName = name; this.ownerDocument = document; this.parentNode = null; this.childNodes = []; this.listeners = new Map() }
  appendChild(node) { node.parentNode = this; this.childNodes.push(node); return node }
  insertBefore(node, before) { const index = this.childNodes.indexOf(before); return index < 0 ? this.appendChild(node) : (node.parentNode = this, this.childNodes.splice(index, 0, node), node) }
  removeChild(node) { const index = this.childNodes.indexOf(node); if (index >= 0) this.childNodes.splice(index, 1); node.parentNode = null; return node }
  addEventListener(type, listener) { const list = this.listeners.get(type) || []; list.push(listener); this.listeners.set(type, list) }
  removeEventListener(type, listener) { this.listeners.set(type, (this.listeners.get(type) || []).filter(item => item !== listener)) }
  dispatchEvent(event) { Object.defineProperty(event, 'target', { configurable: true, value: this }); for (let node = this; node; node = event.bubbles ? node.parentNode : null) { Object.defineProperty(event, 'currentTarget', { configurable: true, value: node }); for (const listener of node.listeners.get(event.type) || []) listener.call(node, event); if (event.propagationStopped) break } return !event.defaultPrevented }
  contains(node) { return node === this || this.childNodes.some(child => child.contains?.(node)) }
  get firstChild() { return this.childNodes[0] || null }
  get lastChild() { return this.childNodes.at(-1) || null }
  get nextSibling() { return this.parentNode?.childNodes[this.parentNode.childNodes.indexOf(this) + 1] || null }
  get textContent() { return this.nodeType === 3 ? this.data : this.childNodes.map(node => node.textContent).join('') }
  set textContent(value) { if (this.nodeType === 3) this.data = String(value); else { this.childNodes = []; if (value !== '') this.appendChild(this.ownerDocument.createTextNode(String(value))) } }
}
class El extends N {
  constructor(tag, document, namespaceURI = 'http://www.w3.org/1999/xhtml') { super(1, tag.toUpperCase(), document); this.tagName = this.nodeName; this.namespaceURI = namespaceURI; this.attributes = new Map(); this.style = { setProperty(name, value) { this[name] = value }, removeProperty(name) { delete this[name] } }; this._value = ''; this.checked = false; this.selected = false; this.disabled = false }
  get options() { return this.tagName === 'SELECT' ? this.childNodes.filter(node => node.tagName === 'OPTION') : undefined }
  get value() { return this.tagName === 'SELECT' ? this.options.find(option => option.selected)?.value ?? this._value : this._value }
  set value(value) { this._value = String(value); if (this.tagName === 'SELECT') for (const option of this.options) option.selected = option.value === this._value }
  setAttribute(name, value) { this.attributes.set(name, String(value)); if (name === 'value') this.value = value; if (name === 'disabled') this.disabled = true }
  getAttribute(name) { return this.attributes.get(name) ?? null }
  removeAttribute(name) { this.attributes.delete(name); if (name === 'disabled') this.disabled = false }
  hasAttribute(name) { return this.attributes.has(name) }
  focus() { this.ownerDocument.activeElement = this }
}
class T extends N { constructor(data, document) { super(3, '#text', document); this.data = String(data) } get nodeValue() { return this.data } set nodeValue(value) { this.data = String(value) } }
class D extends N {
  constructor() { super(9, '#document'); this.ownerDocument = this; this.oninput = null; this.documentElement = new El('html', this); this.body = new El('body', this); this.documentElement.appendChild(this.body); this.appendChild(this.documentElement); this.activeElement = this.body }
  createElement(tag) { return new El(tag, this) }
  createElementNS(namespace, tag) { return new El(tag, this, namespace) }
  createTextNode(data) { return new T(data, this) }
}
function environment() { const document = new D(); const window = { document, addEventListener() {}, removeEventListener() {}, getSelection: () => null, Event: E, Node: N, Element: El, HTMLElement: El, HTMLIFrameElement: class extends El {}, SVGElement: El }; document.defaultView = window; return { document, window, container: document.createElement('div') } }
function nodes(root, tag) { const result = []; function visit(node) { if (node.tagName === tag.toUpperCase()) result.push(node); for (const child of node.childNodes || []) visit(child) } visit(root); return result }
const byText = (root, tag, text) => nodes(root, tag).find(node => node.textContent.includes(text))
const count = (root, text) => root.textContent.split(text).length - 1
const flush = () => act(async () => { await Promise.resolve(); await new Promise(resolve => setTimeout(resolve, 0)) })
async function value(node, next) { const prior = node.value; node.value = next; node._valueTracker?.setValue(prior); await act(async () => { node.dispatchEvent(new E('input')); node.dispatchEvent(new E('change')) }) }
async function authorize(root) { const box = nodes(root, 'input').find(node => node.parentNode?.textContent.includes('I confirm this message')); assert.ok(box); box.checked = true; await act(async () => { box.dispatchEvent(new E('click')); box.dispatchEvent(new E('change')) }) }
const conversation = id => ({ id, owner_id: 'user-1', title: id, state: 'active', access_role: 'owner', last_activity_at: '2026-09-12T00:00:00Z' })
function repository(streams, savedBody = '') {
  return {
    listConversations: async (_d, input) => [conversation('conversation-' + input.engagement_id)],
    getCapabilities: async () => ({ model_id: 'gpt-test', approved_models: [{ configuration_id: 'configuration-1', model_id: 'gpt-test', display_name: 'Test', is_default: true }], attachments: { supported: false } }),
    getConversation: async (_d, input) => ({ conversation: conversation(input.conversation_id), messages: savedBody ? [{ id: 'assistant-1', role: 'assistant', status: 'completed', body: savedBody, proposal: null }] : [], sharing: { can_manage: false, recipients: [] } }),
    listAttachments: async () => [],
    listConversationShareCandidates: async () => [],
    answer: async (_d, _input, scope, { onEvent }) => new Promise((resolve, reject) => {
      streams.push({ onEvent, signal: scope.signal, resolve, reject })
      onEvent({ type: 'started' }); onEvent({ type: 'delta', delta: 'PARTIAL_SENTINEL' })
      scope.signal.addEventListener('abort', () => reject(scope.signal.reason || new DOMException('Stopped', 'AbortError')), { once: true })
    }),
  }
}
function props(id, signal) { return { departmentId: 'content', departmentLabel: 'Content', engagement: { id, project_id: 'project-' + id, organization_id: 'organization-1', name: 'Engagement', agency_clients: { name: 'Client' } }, userId: 'user-1', organizationId: 'organization-1', requestSignal: signal, handleOrganizationAccessError() {} } }
async function start(root) { await value(nodes(root, 'textarea')[0], 'Explain'); await authorize(root); await act(async () => nodes(root, 'form')[0].dispatchEvent(new E('submit'))); await flush() }
async function setup(t) {
  const vite = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent', define: { 'import.meta.env.VITE_SUPABASE_URL': JSON.stringify('http://127.0.0.1:54321'), 'import.meta.env.VITE_SUPABASE_ANON_KEY': JSON.stringify('local-test-anon-key') }, plugins: [{ name: 'department-chat-test-repository', enforce: 'pre', resolveId(source) { if (source.endsWith('departmentChatRepository.js')) return '\0department-chat-test-repository' }, load(id) { if (id === '\0department-chat-test-repository') return `export const departmentChat = new Proxy({}, { get(_target, key) { return (...args) => globalThis.__departmentChatTestRepository[key](...args) } })` } }] }); t.after(() => vite.close())
  const { ScopedDepartmentChat } = await vite.ssrLoadModule('/src/components/DepartmentChat.jsx')
  const env = environment(); const old = { document: globalThis.document, window: globalThis.window, Event: globalThis.Event, Node: globalThis.Node, HTMLElement: globalThis.HTMLElement, act: globalThis.IS_REACT_ACT_ENVIRONMENT, repository: globalThis.__departmentChatTestRepository }
  Object.assign(globalThis, { document: env.document, window: env.window, Event: E, Node: N, HTMLElement: El, IS_REACT_ACT_ENVIRONMENT: true })
  t.after(() => Object.assign(globalThis, { document: old.document, window: old.window, Event: old.Event, Node: old.Node, HTMLElement: old.HTMLElement, IS_REACT_ACT_ENVIRONMENT: old.act, __departmentChatTestRepository: old.repository }))
  return { ...env, ScopedDepartmentChat }
}

test('mounted chat renders one saved answer and preserves answer mode through partial and durable states', async t => {
  const { container, ScopedDepartmentChat } = await setup(t); const streams = []; const repo = repository(streams, 'SAVED_SENTINEL'); globalThis.__departmentChatTestRepository = repo; const root = createRoot(container); t.after(() => { try { root.unmount() } catch {} })
  await act(async () => root.render(createElement(ScopedDepartmentChat, props('a', new AbortController().signal)))); await flush()
  assert.equal(count(container, 'SAVED_SENTINEL'), 1)
  await start(container)
  assert.match(container.textContent, /Live partial · not yet durablePARTIAL_SENTINEL/)
  const mode = nodes(container, 'select').find(select => select.options?.some(option => option.textContent === 'Conversational answer'))
  assert.equal(mode.disabled, true); assert.ok(byText(container, 'button', 'Stop watching locally'))
  await act(async () => { streams[0].onEvent({ type: 'completed', answer: 'DURABLE_SENTINEL' }); streams[0].resolve({ type: 'completed' }); await Promise.resolve() }); await flush()
  assert.match(container.textContent, /Saved answerDURABLE_SENTINEL/); assert.equal(mode.disabled, false)
})

test('mounted chat wires local stop and suppresses late events after context replacement and unmount', async t => {
  const { container, ScopedDepartmentChat } = await setup(t); const streams = []; const repo = repository(streams); globalThis.__departmentChatTestRepository = repo; const root = createRoot(container); t.after(() => { try { root.unmount() } catch {} })
  await act(async () => root.render(createElement(ScopedDepartmentChat, { ...props('a', new AbortController().signal), key: 'a' }))); await flush(); await start(container)
  await act(async () => byText(container, 'button', 'Stop watching locally').dispatchEvent(new E('click'))); await flush()
  assert.equal(streams[0].signal.aborted, true); assert.match(container.textContent, /Stopped watching locally\. The provider may still be running or incur cost/)
  await start(container); const oldStream = streams[1]
  await act(async () => root.render(createElement(ScopedDepartmentChat, { ...props('b', new AbortController().signal), key: 'b' }))); await flush()
  assert.equal(oldStream.signal.aborted, true)
  await act(async () => { oldStream.onEvent({ type: 'completed', answer: 'LATE_CONTEXT_SENTINEL' }); await Promise.resolve() })
  assert.equal(count(container, 'LATE_CONTEXT_SENTINEL'), 0)
  await start(container); const unmounted = streams[2]; await act(async () => root.unmount()); assert.equal(unmounted.signal.aborted, true)
  unmounted.onEvent({ type: 'completed', answer: 'LATE_UNMOUNT_SENTINEL' }); await Promise.resolve(); assert.equal(container.textContent, '')
})