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
  constructor(tag, document, namespaceURI = 'http://www.w3.org/1999/xhtml') { super(1, tag.toUpperCase(), document); this.tagName = this.nodeName; this.namespaceURI = namespaceURI; this.attributes = new Map(); this.style = { setProperty(name, value) { this[name] = value }, removeProperty(name) { delete this[name] } }; this._value = ''; this.type = ''; this.checked = false; this.selected = false; this.disabled = false }
  get options() { return this.tagName === 'SELECT' ? this.childNodes.filter(node => node.tagName === 'OPTION') : undefined }
  get value() { return this.tagName === 'SELECT' ? this.options.find(option => option.selected)?.value ?? this._value : this._value }
  set value(value) { this._value = String(value); if (this.tagName === 'SELECT') for (const option of this.options) option.selected = option.value === this._value }
  setAttribute(name, value) { this.attributes.set(name, String(value)); if (name === 'value') this.value = value; if (name === 'type') this.type = String(value); if (name === 'disabled') this.disabled = true }
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
function repository(streams, savedBody = '', searches = []) {
  return {
    listConversations: async (_d, input) => [conversation('conversation-' + input.engagement_id)],
    searchConversations: async (_d, input) => {
      searches.push(input)
      return { items: input.query === 'no match' ? [] : [conversation(input.query ? 'matching-conversation' : 'conversation-' + input.engagement_id)], next_cursor: null }
    },
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
async function start(root) { await value(nodes(root, 'textarea')[0], 'Explain'); await authorize(root); const form = nodes(root, 'form').find(item => nodes(item, 'textarea').length); assert.ok(form); await act(async () => form.dispatchEvent(new E('submit'))); await flush() }
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

test('mounted chat sends title/message search to the server and renders only returned conversations', async t => {
  const { container, ScopedDepartmentChat } = await setup(t); const streams = []; const searches = []; globalThis.__departmentChatTestRepository = repository(streams, '', searches); const root = createRoot(container); t.after(() => { try { root.unmount() } catch {} })
  await act(async () => root.render(createElement(ScopedDepartmentChat, props('a', new AbortController().signal)))); await flush()
  const input = nodes(container, 'input').find(node => node.type === 'search'); assert.ok(input)
  await value(input, 'quarterly planning')
  await flush()
  const form = nodes(container, 'form').find(item => nodes(item, 'input').includes(input)); assert.ok(form)
  await act(async () => form.dispatchEvent(new E('submit'))); await flush()
  assert.equal(searches.length, 2)
  assert.equal(searches.at(-1).query, 'quarterly planning')
  assert.match(container.textContent, /matching-conversation/)
  await value(input, 'no match'); await flush()
  await act(async () => form.dispatchEvent(new E('submit'))); await flush()
  assert.equal(searches.at(-1).query, 'no match')
  assert.equal(count(container, 'matching-conversation'), 0)
  assert.match(container.textContent, /No permitted conversations match this search/)
})

test('mounted search clears the prior transcript on denied and failed result loads', async t => {
  const { document, ScopedDepartmentChat } = await setup(t)
  for (const scenario of [
    { query: 'denied result', message: 'Conversation access revoked' },
    { query: 'network failure', message: 'Conversation load failed' },
  ]) {
    const container = document.createElement('div')
    const repo = repository([], 'OLD_CONVERSATION_BODY')
    const originalGetConversation = repo.getConversation
    repo.getConversation = async (departmentId, input) => {
      if (input.conversation_id === 'matching-conversation') throw new Error(scenario.message)
      return originalGetConversation(departmentId, input)
    }
    globalThis.__departmentChatTestRepository = repo
    const root = createRoot(container)

    await act(async () => root.render(createElement(
      ScopedDepartmentChat,
      props('a', new AbortController().signal),
    )))
    await flush()
    assert.equal(count(container, 'OLD_CONVERSATION_BODY'), 1)

    const input = nodes(container, 'input').find(node => node.type === 'search')
    assert.ok(input)
    await value(input, scenario.query)
    const form = nodes(container, 'form').find(item => nodes(item, 'input').includes(input))
    assert.ok(form)
    await act(async () => form.dispatchEvent(new E('submit')))
    await flush()

    assert.match(container.textContent, new RegExp(scenario.message))
    assert.match(container.textContent, /matching-conversation/)
    assert.equal(
      count(container, 'OLD_CONVERSATION_BODY'),
      0,
      'A prior transcript must not remain under a different selected conversation.',
    )
    await act(async () => root.unmount())
  }
})

test('mounted conversation changes clear transient answer and proposal state', async t => {
  const { document, ScopedDepartmentChat } = await setup(t)

  async function search(container, query) {
    const input = nodes(container, 'input').find(node => node.type === 'search')
    assert.ok(input)
    await value(input, query)
    const form = nodes(container, 'form').find(item => nodes(item, 'input').includes(input))
    assert.ok(form)
    await act(async () => form.dispatchEvent(new E('submit')))
    await flush()
  }

  {
    const container = document.createElement('div')
    const streams = []
    const repo = repository(streams)
    const originalGetConversation = repo.getConversation
    repo.getConversation = async (departmentId, input) => {
      if (input.conversation_id === 'matching-conversation') throw new Error('Conversation load failed')
      return originalGetConversation(departmentId, input)
    }
    globalThis.__departmentChatTestRepository = repo
    const root = createRoot(container)

    await act(async () => root.render(createElement(
      ScopedDepartmentChat,
      props('a', new AbortController().signal),
    )))
    await flush()
    await start(container)
    assert.match(container.textContent, /Live partial · not yet durablePARTIAL_SENTINEL/)
    await act(async () => byText(container, 'button', 'Stop watching locally').dispatchEvent(new E('click')))
    await flush()
    assert.match(container.textContent, /Stopped watching locally/)

    await search(container, 'network failure')
    assert.equal(count(container, 'PARTIAL_SENTINEL'), 0)
    assert.equal(count(container, 'Stopped watching locally'), 0)
    await act(async () => root.unmount())
  }

  {
    const container = document.createElement('div')
    const repo = repository([])
    const originalGetConversation = repo.getConversation
    repo.getConversation = async (departmentId, input) => {
      if (input.conversation_id === 'matching-conversation') throw new Error('Conversation access revoked')
      return originalGetConversation(departmentId, input)
    }
    repo.proposeArtifact = async () => ({
      proposal_id: 'proposal-a',
      preview: { title: 'A_PROPOSAL_PREVIEW' },
      status: 'pending',
      expires_at: new Date(Date.now() + 60_000).toISOString(),
      model: 'gpt-test',
      connector_connection_id: 'connection-1',
    })
    globalThis.__departmentChatTestRepository = repo
    const root = createRoot(container)

    await act(async () => root.render(createElement(
      ScopedDepartmentChat,
      props('a', new AbortController().signal),
    )))
    await flush()
    const mode = nodes(container, 'select').find(select => select.options?.some(option => option.textContent === 'Artifact draft'))
    assert.ok(mode)
    await value(mode, 'artifact')
    await start(container)
    assert.match(container.textContent, /A_PROPOSAL_PREVIEW/)
    assert.ok(byText(container, 'button', 'Confirm official draft'))
    assert.ok(byText(container, 'button', 'Reject'))

    await search(container, 'denied proposal')
    assert.equal(count(container, 'A_PROPOSAL_PREVIEW'), 0)
    assert.equal(count(container, 'Confirm official draft'), 0)
    assert.equal(count(container, 'Reject'), 0)
    await act(async () => root.unmount())
  }
})

test('direct selection aligns the editable title before a failed conversation load', async t => {
  const { container, ScopedDepartmentChat } = await setup(t)
  const repo = repository([])
  repo.searchConversations = async () => ({
    items: [conversation('conversation-a'), conversation('conversation-b')],
    next_cursor: null,
  })
  const originalGetConversation = repo.getConversation
  repo.getConversation = async (departmentId, input) => {
    if (input.conversation_id === 'conversation-b') throw new Error('Conversation load failed')
    return originalGetConversation(departmentId, input)
  }
  globalThis.__departmentChatTestRepository = repo
  const root = createRoot(container)
  t.after(() => { try { root.unmount() } catch {} })

  await act(async () => root.render(createElement(
    ScopedDepartmentChat,
    props('a', new AbortController().signal),
  )))
  await flush()
  const titleInput = nodes(container, 'input').find(node => node.parentNode?.textContent.includes('Conversation title'))
  assert.ok(titleInput)
  assert.equal(titleInput.value, 'conversation-a')

  const next = byText(container, 'button', 'conversation-b')
  assert.ok(next)
  await act(async () => next.dispatchEvent(new E('click')))
  await flush()

  assert.match(container.textContent, /Conversation load failed/)
  assert.equal(titleInput.value, 'conversation-b')
})
