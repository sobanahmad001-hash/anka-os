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
    getCapabilities: async () => ({ provider: 'openai', model_id: 'gpt-test', answer_readiness: { paid_execution_enabled: true, spend_tracking_configured: true, spend_guard_mode: 'local_monthly_cap', model_price_available: [{ configuration_id: 'configuration-1', fresh_price_available: true }] }, approved_models: [{ configuration_id: 'configuration-1', provider: 'openai', model_id: 'gpt-test', display_name: 'Test', is_default: true }], attachments: { supported: false } }),
    getConversation: async (_d, input) => ({ conversation: conversation(input.conversation_id), messages: savedBody ? [{ id: 'assistant-1', role: 'assistant', status: 'completed', body: savedBody, proposal: null }] : [], sharing: { can_manage: false, recipients: [] } }),
    listAttachments: async () => [],
    listSourceVersions: async () => [],
    previewSourceVersion: async () => null,
    listConversationShareCandidates: async () => [],
    getUnsentDraft: async () => null,
    saveUnsentDraft: async () => ({}),
    discardUnsentDraft: async () => true,
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
  const vite = await createServer({ server: { middlewareMode: true }, ssr: { noExternal: ['react-router-dom', 'react-router'] }, appType: 'custom', logLevel: 'silent', define: { 'import.meta.env.VITE_SUPABASE_URL': JSON.stringify('http://127.0.0.1:54321'), 'import.meta.env.VITE_SUPABASE_ANON_KEY': JSON.stringify('local-test-anon-key') }, plugins: [{ name: 'department-chat-test-repository', enforce: 'pre', resolveId(source) { if (source === 'react-router-dom') return '\0department-chat-router-test'; if (source.endsWith('departmentChatRepository.js')) return '\0department-chat-test-repository' }, load(id) { if (id === '\0department-chat-router-test') return 'export const useBlocker = () => ({ state: "unblocked" })'; if (id === '\0department-chat-test-repository') return `export const departmentChat = new Proxy({}, { get(_target, key) { return (...args) => globalThis.__departmentChatTestRepository[key](...args) } })` } }] }); t.after(() => vite.close())
  const { ScopedDepartmentChat } = await vite.ssrLoadModule('/src/components/DepartmentChat.jsx')
  const env = environment(); const old = { document: globalThis.document, window: globalThis.window, Event: globalThis.Event, Node: globalThis.Node, HTMLElement: globalThis.HTMLElement, act: globalThis.IS_REACT_ACT_ENVIRONMENT, repository: globalThis.__departmentChatTestRepository }
  Object.assign(globalThis, { document: env.document, window: env.window, Event: E, Node: N, HTMLElement: El, IS_REACT_ACT_ENVIRONMENT: true })
  t.after(() => Object.assign(globalThis, { document: old.document, window: old.window, Event: old.Event, Node: old.Node, HTMLElement: old.HTMLElement, IS_REACT_ACT_ENVIRONMENT: old.act, __departmentChatTestRepository: old.repository }))
  return { ...env, ScopedDepartmentChat }
}

test('P9C narrow context panel expands for output and keeps official proposal controls keyboard reachable', async t => {
  const { container, window, document, ScopedDepartmentChat } = await setup(t)
  let wide = false
  const listeners = []
  const media = { get matches() { return wide }, addEventListener(_event, listener) { listeners.push(listener) }, removeEventListener(_event, listener) { const index = listeners.indexOf(listener); if (index >= 0) listeners.splice(index, 1) } }
  window.matchMedia = () => media
  const repo = repository([])
  repo.proposeArtifact = async () => ({
    proposal_id: 'proposal-p9c', preview: { title: 'P9C_PREVIEW' }, status: 'pending',
    expires_at: new Date(Date.now() + 60_000).toISOString(), model: 'gpt-test',
    connector_connection_id: 'connection-1',
  })
  globalThis.__departmentChatTestRepository = repo
  const root = createRoot(container)
  t.after(() => { try { root.unmount() } catch {} })
  await act(async () => root.render(createElement(ScopedDepartmentChat, props('a', new AbortController().signal))))
  await flush()
  const toggle = byText(container, 'button', 'Context and output')
  const panel = nodes(container, 'div').find(node => node.getAttribute('id') === toggle.getAttribute('aria-controls'))
  assert.equal(toggle.getAttribute('aria-expanded'), 'false')
  assert.equal(panel.hasAttribute('hidden'), true)
  await act(async () => toggle.dispatchEvent(new E('click')))
  assert.equal(toggle.getAttribute('aria-expanded'), 'true')
  assert.equal(panel.hasAttribute('hidden'), false)
  await act(async () => toggle.dispatchEvent(new E('click')))
  const mode = nodes(container, 'select').find(select => select.options?.some(option => option.textContent === 'Artifact draft'))
  await value(mode, 'artifact')
  await start(container)
  assert.equal(toggle.getAttribute('aria-expanded'), 'true')
  assert.match(panel.textContent, /P9C_PREVIEW/)
  assert.ok(byText(panel, 'button', 'Confirm official draft'))
  assert.match(document.activeElement.textContent, /Generated proposal preview/)
  wide = true
  await act(async () => listeners.forEach(listener => listener()))
  assert.equal(toggle.getAttribute('aria-expanded'), 'true')
  wide = false
  await act(async () => listeners.forEach(listener => listener()))
  assert.equal(toggle.getAttribute('aria-expanded'), 'false')
  assert.equal(panel.hasAttribute('hidden'), true)
  assert.equal(document.activeElement, toggle)
  await act(async () => root.unmount())
})

test('P9C unsent-work dialog focuses Stay, traps Tab, and Escape preserves the original draft', async t => {
  const { container, document, ScopedDepartmentChat } = await setup(t)
  globalThis.__departmentChatTestRepository = repository([])
  const root = createRoot(container)
  t.after(() => { try { root.unmount() } catch {} })
  await act(async () => root.render(createElement(ScopedDepartmentChat, props('a', new AbortController().signal))))
  await flush()
  await value(nodes(container, 'textarea')[0], 'Keep my original draft')
  const invoker = byText(container, 'button', 'New')
  invoker.focus()
  await act(async () => invoker.dispatchEvent(new E('click')))
  const dialog = nodes(container, 'div').find(node => node.getAttribute('role') === 'dialog')
  const stay = byText(dialog, 'button', 'Stay')
  const save = byText(dialog, 'button', 'Save to original and continue')
  assert.equal(document.activeElement, stay)
  const backward = new E('keydown'); backward.key = 'Tab'; backward.shiftKey = true
  await act(async () => dialog.dispatchEvent(backward))
  assert.equal(backward.defaultPrevented, true)
  assert.equal(document.activeElement, save)
  const forward = new E('keydown'); forward.key = 'Tab'; forward.shiftKey = false
  await act(async () => dialog.dispatchEvent(forward))
  assert.equal(document.activeElement, stay)
  const escape = new E('keydown'); escape.key = 'Escape'
  await act(async () => dialog.dispatchEvent(escape))
  assert.equal(nodes(container, 'div').some(node => node.getAttribute('role') === 'dialog'), false)
  assert.equal(document.activeElement, invoker)
  assert.equal(nodes(container, 'textarea')[0].value, 'Keep my original draft')
  await act(async () => invoker.dispatchEvent(new E('click')))
  assert.equal(document.activeElement, byText(container, 'button', 'Stay'))
  await act(async () => byText(container, 'button', 'Stay').dispatchEvent(new E('click')))
  assert.equal(document.activeElement, invoker)
  document.body.focus()
  await act(async () => invoker.dispatchEvent(new E('click')))
  const fallbackDialog = nodes(container, 'div').find(node => node.getAttribute('role') === 'dialog')
  const fallbackEscape = new E('keydown'); fallbackEscape.key = 'Escape'
  await act(async () => fallbackDialog.dispatchEvent(fallbackEscape))
  assert.equal(document.activeElement, nodes(container, 'textarea')[0])
  await act(async () => root.unmount())
})

test('P9B previews an exact permitted version before including it and clears selection across conversations', async t => {
  const { container, ScopedDepartmentChat } = await setup(t)
  const id = '11111111-1111-4111-8111-111111111111'
  const repo = repository([])
  repo.searchConversations = async () => ({
    items: [conversation('conversation-a'), conversation('conversation-b')], next_cursor: null,
  })
  const sourceCalls = []
  repo.listSourceVersions = async (_department, input) => {
    sourceCalls.push(input.conversation_id)
    return [{ artifact_version_id: id, title: 'Brand vision', artifact_type: 'vision', version_number: 2, approved_at: '2026-09-01T00:00:00Z' }]
  }
  repo.previewSourceVersion = async (_department, input) => ({
    artifact_version_id: input.artifact_version_id, title: 'Brand vision', artifact_type: 'vision',
    version_number: 2, content: { body: 'EXACT_VERSION_CONTENT' },
  })
  const sent = []
  repo.answer = async (_department, input) => { sent.push(input); return { type: 'completed' } }
  globalThis.__departmentChatTestRepository = repo
  const root = createRoot(container)
  t.after(() => { try { root.unmount() } catch {} })
  await act(async () => root.render(createElement(ScopedDepartmentChat, props('a', new AbortController().signal))))
  await flush()
  assert.deepEqual(sourceCalls, ['conversation-a'])
  assert.equal(count(container, 'EXACT_VERSION_CONTENT'), 0)
  await act(async () => byText(container, 'button', 'Preview exact version').dispatchEvent(new E('click')))
  await flush()
  assert.match(container.textContent, /EXACT_VERSION_CONTENT/)
  await act(async () => byText(container, 'button', 'Include this exact version').dispatchEvent(new E('click')))
  assert.match(container.textContent, /1 of 5 exact versions selected/)
  await value(nodes(container, 'textarea')[0], 'Use the previewed version')
  await authorize(container)
  const form = nodes(container, 'form').find(item => nodes(item, 'textarea').length)
  await act(async () => form.dispatchEvent(new E('submit')))
  await flush()
  assert.deepEqual(sent[0].selected_artifact_version_ids, [id])
  assert.match(container.textContent, /0 of 5 exact versions selected/)
  await act(async () => byText(container, 'button', 'Preview exact version').dispatchEvent(new E('click')))
  await flush()
  await act(async () => byText(container, 'button', 'conversation-b').dispatchEvent(new E('click')))
  await flush()
  assert.deepEqual(sourceCalls, ['conversation-a', 'conversation-b'])
  assert.equal(count(container, 'EXACT_VERSION_CONTENT'), 0)
  assert.match(container.textContent, /0 of 5 exact versions selected/)
})

test('P9B denied or late exact preview cannot enter a new scope', async t => {
  const { container, ScopedDepartmentChat } = await setup(t)
  const id = '11111111-1111-4111-8111-111111111111'
  const repo = repository([])
  repo.listSourceVersions = async () => [{ artifact_version_id: id, title: 'Private vision', artifact_type: 'vision', version_number: 1, approved_at: '2026-09-01T00:00:00Z' }]
  const pending = []
  repo.previewSourceVersion = () => new Promise((resolve, reject) => pending.push({ resolve, reject }))
  globalThis.__departmentChatTestRepository = repo
  const root = createRoot(container)
  t.after(() => { try { root.unmount() } catch {} })
  await act(async () => root.render(createElement(ScopedDepartmentChat, { ...props('a', new AbortController().signal), key: 'a' })))
  await flush()
  await act(async () => byText(container, 'button', 'Preview exact version').dispatchEvent(new E('click')))
  await act(async () => pending[0].reject(new Error('Source permission revoked')))
  await flush()
  assert.match(container.textContent, /Source permission revoked/)
  assert.equal(byText(container, 'button', 'Include this exact version'), undefined)
  await act(async () => byText(container, 'button', 'Preview exact version').dispatchEvent(new E('click')))
  await act(async () => root.render(createElement(ScopedDepartmentChat, { ...props('b', new AbortController().signal), key: 'b' })))
  await flush()
  await act(async () => pending[1].resolve({ artifact_version_id: id, title: 'Private vision',
    artifact_type: 'vision', version_number: 1, content: { body: 'LATE_SECRET_PREVIEW' } }))
  await flush()
  assert.equal(count(container, 'LATE_SECRET_PREVIEW'), 0)
  assert.equal(byText(container, 'button', 'Include this exact version'), undefined)
})

for (const outcome of ['success', 'failure']) test('attachment ' + outcome + ' keeps the original conversation while upload is in flight', async t => {
  const { container, ScopedDepartmentChat } = await setup(t)
  const repo = repository([])
  repo.searchConversations = async () => ({ items: [conversation('conversation-a'), conversation('conversation-b')], next_cursor: null })
  repo.getCapabilities = async () => ({ approved_models: [{ configuration_id: 'configuration-1', is_default: true }], attachments: { supported: true } })
  const uploads = []
  repo.uploadAttachment = async (_department, input) => new Promise((resolve, reject) => uploads.push({ input, resolve, reject }))
  globalThis.__departmentChatTestRepository = repo
  const root = createRoot(container)
  t.after(() => { try { root.unmount() } catch {} })
  await act(async () => root.render(createElement(ScopedDepartmentChat, props('a', new AbortController().signal))))
  await flush()
  const input = nodes(container, 'input').find(node => node.type === 'file')
  input.files = [{ name: 'old.png', type: 'image/png', size: 10 }]
  await act(async () => input.dispatchEvent(new E('change')))
  await act(async () => byText(container, 'button', 'Upload and validate').dispatchEvent(new E('click')))
  assert.equal(uploads.length, 1)
  await act(async () => byText(container, 'button', 'conversation-b').dispatchEvent(new E('click')))
  assert.match(container.textContent, /old.png/)
  await act(async () => {
    if (outcome === 'success') uploads[0].resolve({ id: 'old-attachment' })
    else uploads[0].reject(new Error('OLD_UPLOAD_DENIED'))
  })
  await flush()
  await act(async () => byText(container, 'button', 'conversation-b').dispatchEvent(new E('click')))
  assert.ok(byText(container, 'button', 'Discard and continue'))
  await act(async () => byText(container, 'button', 'Discard and continue').dispatchEvent(new E('click')))
  await flush()
  assert.doesNotMatch(container.textContent, /old.png|OLD_UPLOAD_DENIED/)
  assert.ok(byText(container, 'button', 'conversation-b').getAttribute('class')?.includes('border-sky-600'))
})

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
    const discard = byText(container, 'button', 'Discard and continue')
    if (discard) { await act(async () => discard.dispatchEvent(new E('click'))); await flush() }
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


test('mounted chat shows truthful run metadata and an accessible exact-version history link without an official write', async t => {
  const { container, ScopedDepartmentChat } = await setup(t)
  const repo = repository([])
  repo.getConversation = async (_departmentId, input) => ({
    conversation: conversation(input.conversation_id),
    sharing: { can_manage: false, recipients: [] },
    messages: [
      {
        id: 'assistant-current', role: 'assistant', status: 'completed', body: 'Current answer',
        created_at: '2026-09-13T10:00:00Z', proposal: null,
        run: {
          id: 'run-current', provider: 'openai', capability: 'department_chat_answer', status: 'completed',
          created_at: '2026-09-13T10:00:01Z',
          selected_model: { configuration_id: 'configuration-1', model_id: 'selected-model', display_name: 'Fixture selected' },
          actual_model_id: 'actual-model', requested_tools: [], executed_tools: [],
          source_versions: [{
            artifact_id: 'artifact-1', artifact_version_id: 'version-1',
            artifact_type: 'content', title: 'Exact content', version_number: 7,
          }],
        },
      },
      {
        id: 'assistant-historical', role: 'assistant', status: 'completed', body: 'Historical answer',
        created_at: '2026-09-12T10:00:00Z', proposal: null,
        run: {
          id: 'run-historical', provider: 'openai', capability: 'department_chat_answer',
          status: 'completed', created_at: '2026-09-12T10:00:01Z',
          selected_model: null, actual_model_id: null, requested_tools: null, executed_tools: null,
          source_versions: [],
        },
      },
    ],
  })
  globalThis.__departmentChatTestRepository = repo
  const root = createRoot(container)
  t.after(() => { try { root.unmount() } catch {} })
  await act(async () => root.render(createElement(ScopedDepartmentChat, props('a', new AbortController().signal))))
  await flush()

  assert.ok(container.textContent.includes('Selected modelFixture selected / selected-model'))
  assert.match(container.textContent, /Actual model usedactual-model/)
  assert.match(container.textContent, /Requested toolsNone requested/)
  assert.match(container.textContent, /Executed toolsNone executed/)
  assert.match(container.textContent, /Not recorded for this historical run/)
  assert.ok(container.textContent.includes('Exact content / version 7 / version-1'))

  const link = byText(container, 'a', 'View version history')
  assert.ok(link)
  const href = new URL(link.getAttribute('href'), 'https://anka.invalid')
  assert.equal(href.pathname, '/sphere/content/studio')
  assert.equal(href.searchParams.get('artifact'), 'artifact-1')
  assert.equal(href.searchParams.get('version'), 'version-1')
  assert.match(link.getAttribute('aria-label'), /version-1/)
})

test('P9A saves unsent text only to its original conversation and restores without AI consent', async t => {
  const { container, ScopedDepartmentChat } = await setup(t)
  const repo = repository([])
  const drafts = new Map()
  const saved = []
  repo.searchConversations = async () => ({ items: [conversation('conversation-a'), conversation('conversation-b')], next_cursor: null })
  repo.saveUnsentDraft = async (_department, input) => { saved.push(input); drafts.set(input.conversation_id, input.draft); return input.draft }
  repo.getUnsentDraft = async (_department, input) => drafts.get(input.conversation_id) || null
  repo.discardUnsentDraft = async (_department, input) => drafts.delete(input.conversation_id)
  globalThis.__departmentChatTestRepository = repo
  const root = createRoot(container)
  t.after(() => { try { root.unmount() } catch {} })
  await act(async () => root.render(createElement(ScopedDepartmentChat, props('a', new AbortController().signal))))
  await flush()
  await value(nodes(container, 'textarea')[0], 'Private draft A')
  await authorize(container)
  await act(async () => byText(container, 'button', 'conversation-b').dispatchEvent(new E('click')))
  assert.ok(byText(container, 'button', 'Stay'))
  assert.equal(nodes(container, 'textarea')[0].value, 'Private draft A')
  await act(async () => byText(container, 'button', 'Stay').dispatchEvent(new E('click')))
  assert.equal(nodes(container, 'textarea')[0].value, 'Private draft A')
  await act(async () => byText(container, 'button', 'conversation-b').dispatchEvent(new E('click')))
  await act(async () => byText(container, 'button', 'Save to original and continue').dispatchEvent(new E('click')))
  await flush()
  assert.equal(saved.length, 1)
  assert.equal(saved[0].conversation_id, 'conversation-a')
  assert.deepEqual(Object.keys(saved[0].draft).sort(), ['artifact_type', 'language', 'priority', 'prompt', 'proposal_mode', 'work_item_title', 'work_item_type'].sort())
  assert.equal(nodes(container, 'textarea')[0].value, '')
  await act(async () => byText(container, 'button', 'conversation-a').dispatchEvent(new E('click')))
  await flush()
  assert.equal(nodes(container, 'textarea')[0].value, 'Private draft A')
  const consent = nodes(container, 'input').find(node => node.parentNode?.textContent.includes('I confirm this message'))
  assert.equal(consent.checked, false)
  assert.match(container.textContent, /Unsent text restored/)
})

test('P9A router navigation stays blocked until the author saves to the original conversation', async t => {
  const { container, ScopedDepartmentChat } = await setup(t)
  const repo = repository([])
  const saved = []
  repo.saveUnsentDraft = async (_department, input) => { saved.push(input); return input.draft }
  globalThis.__departmentChatTestRepository = repo
  const root = createRoot(container)
  t.after(() => { try { root.unmount() } catch {} })
  const signal = new AbortController().signal
  const base = props('a', signal)
  const calls = []
  const blocker = state => ({ state, proceed: () => calls.push('proceed'), reset: () => calls.push('reset') })
  await act(async () => root.render(createElement(ScopedDepartmentChat, { ...base, navigationBlocker: blocker('unblocked') })))
  await flush()
  await value(nodes(container, 'textarea')[0], 'Hold this draft')
  await act(async () => root.render(createElement(ScopedDepartmentChat, { ...base, navigationBlocker: blocker('blocked') })))
  await flush()
  assert.ok(byText(container, 'button', 'Stay'))
  await act(async () => byText(container, 'button', 'Stay').dispatchEvent(new E('click')))
  assert.deepEqual(calls, ['reset'])
  assert.equal(nodes(container, 'textarea')[0].value, 'Hold this draft')
  await act(async () => root.render(createElement(ScopedDepartmentChat, { ...base, navigationBlocker: blocker('unblocked') })))
  await act(async () => root.render(createElement(ScopedDepartmentChat, { ...base, navigationBlocker: blocker('blocked') })))
  await flush()
  await act(async () => byText(container, 'button', 'Save to original and continue').dispatchEvent(new E('click')))
  await flush()
  assert.deepEqual(calls, ['reset', 'proceed'])
  assert.equal(saved.length, 1)
  assert.equal(saved[0].conversation_id, 'conversation-a')
  assert.equal(nodes(container, 'textarea')[0].value, '')
})

test('P9A search and archived filters restore the selected conversation draft only', async t => {
  const { container, ScopedDepartmentChat } = await setup(t)
  const repo = repository([])
  repo.searchConversations = async (_department, input) => ({
    items: input.query || input.include_archived ? [conversation('conversation-b')] : [conversation('conversation-a')],
    next_cursor: null,
  })
  repo.getUnsentDraft = async (_department, input) => input.conversation_id === 'conversation-b'
    ? { prompt: 'Draft B only', proposal_mode: 'answer' } : null
  globalThis.__departmentChatTestRepository = repo
  const root = createRoot(container)
  t.after(() => { try { root.unmount() } catch {} })
  await act(async () => root.render(createElement(ScopedDepartmentChat, props('a', new AbortController().signal))))
  await flush()
  const search = nodes(container, 'input').find(node => node.type === 'search')
  await value(search, 'B')
  const form = nodes(container, 'form').find(item => nodes(item, 'input').includes(search))
  await act(async () => form.dispatchEvent(new E('submit')))
  await flush()
  assert.equal(nodes(container, 'textarea')[0].value, 'Draft B only')
  const consent = nodes(container, 'input').find(node => node.parentNode?.textContent.includes('I confirm this message'))
  assert.equal(consent.checked, false)
  await act(async () => byText(container, 'button', 'Clear').dispatchEvent(new E('click')))
  await flush()
  await act(async () => byText(container, 'button', 'Discard and continue').dispatchEvent(new E('click')))
  await flush()
  assert.equal(nodes(container, 'textarea')[0].value, '')
  const archived = nodes(container, 'input').find(node => node.type === 'checkbox' && node.parentNode?.textContent.includes('Show archived'))
  archived.checked = true
  await act(async () => { archived.dispatchEvent(new E('click')); archived.dispatchEvent(new E('change')) })
  await flush()
  assert.equal(nodes(container, 'textarea')[0].value, 'Draft B only')
})

for (const action of ['Save to original and continue', 'Discard and continue']) {
  test('P9A ' + action + ' cannot navigate after scope abort and unmount', async t => {
    const { container, document, ScopedDepartmentChat } = await setup(t)
    const repo = repository([])
    let release
    const pending = new Promise(resolve => { release = resolve })
    if (action.startsWith('Save')) repo.saveUnsentDraft = () => pending
    else repo.discardUnsentDraft = () => pending
    globalThis.__departmentChatTestRepository = repo
    const root = createRoot(container)
    const controller = new AbortController()
    const calls = []
    const base = props('a', controller.signal)
    await act(async () => root.render(createElement(ScopedDepartmentChat, {
      ...base, navigationBlocker: { state: 'unblocked', proceed: () => calls.push('proceed'), reset: () => calls.push('reset') },
    })))
    await flush()
    await value(nodes(container, 'textarea')[0], 'Unsaved scoped intent')
    await act(async () => root.render(createElement(ScopedDepartmentChat, {
      ...base, navigationBlocker: { state: 'blocked', proceed: () => calls.push('proceed'), reset: () => calls.push('reset') },
    })))
    await flush()
    await act(async () => byText(container, 'button', action).dispatchEvent(new E('click')))
    assert.equal(byText(container, 'button', 'Stay').disabled, true)
    const dialog = nodes(container, 'div').find(node => node.getAttribute('role') === 'dialog')
    assert.equal(document.activeElement, dialog)
    const tab = new E('keydown'); tab.key = 'Tab'
    await act(async () => dialog.dispatchEvent(tab))
    assert.equal(tab.defaultPrevented, true)
    controller.abort()
    await act(async () => root.unmount())
    await act(async () => release({}))
    assert.deepEqual(calls, [])
  })
}
for (const blocked of [
  { paid_execution_enabled: false, spend_tracking_configured: true, fresh_price_available: true, message: 'Workshop AI answers are currently off.' },
  { paid_execution_enabled: true, spend_tracking_configured: false, fresh_price_available: true, message: 'Organization spend tracking is not configured.' },
  { paid_execution_enabled: true, spend_tracking_configured: true, fresh_price_available: false, message: 'A fresh verified price for this exact model is unavailable.' },
]) {
  test('Workshop answer remains unavailable when ' + blocked.message, async t => {
    const { container, ScopedDepartmentChat } = await setup(t)
    const repo = repository([])
    const original = repo.getCapabilities
    repo.getCapabilities = async (...args) => {
      const capabilities = await original(...args)
      return { ...capabilities, answer_readiness: {
        paid_execution_enabled: blocked.paid_execution_enabled,
        spend_tracking_configured: blocked.spend_tracking_configured,
        spend_guard_mode: blocked.spend_tracking_configured ? 'local_monthly_cap' : null,
        model_price_available: [{ configuration_id: 'configuration-1', fresh_price_available: blocked.fresh_price_available }],
      } }
    }
    globalThis.__departmentChatTestRepository = repo
    const root = createRoot(container)
    t.after(() => { try { root.unmount() } catch {} })
    await act(async () => root.render(createElement(ScopedDepartmentChat, props('a', new AbortController().signal))))
    await flush()
    await value(nodes(container, 'textarea')[0], 'Explain')
    await authorize(container)
    assert.ok(container.textContent.includes(blocked.message))
    assert.equal(byText(container, 'button', 'Ask configured AI').disabled, true)
  })
}

test('opt-in artifact allowlist constrains rendered tools, restored drafts and direct submit without changing ordinary chat', async t => {
  const { container, ScopedDepartmentChat } = await setup(t)
  const repo = repository([]), proposals = []
  repo.getUnsentDraft = async () => ({ prompt: 'Saved unsupported prompt', proposal_mode: 'artifact', artifact_type: 'discovery' })
  repo.proposeArtifact = async (_department, input) => { proposals.push(input); return { proposal_id: 'proposal-allowed', preview: { title: 'Allowed preview' }, status: 'pending', expires_at: new Date(Date.now() + 60000).toISOString() } }
  globalThis.__departmentChatTestRepository = repo
  const root = createRoot(container)

  await act(async () => root.render(createElement(ScopedDepartmentChat, { ...props('a', new AbortController().signal), allowedArtifactTypes: ['vision'] })))
  await flush()
  const mode = nodes(container, 'select').find(select => select.options?.some(option => option.textContent === 'Artifact draft'))
  assert.ok(mode); assert.equal(mode.value, 'answer')
  await value(mode, 'artifact')
  const tool = nodes(container, 'select').find(select => select.options?.some(option => option.value === 'vision'))
  assert.ok(tool); assert.deepEqual(tool.options.map(option => option.value), ['vision'])
  await value(tool, 'discovery'); await start(container)
  assert.equal(proposals.length, 0); assert.match(container.textContent, /artifact tool is unavailable/)
  await value(tool, 'vision'); await start(container)
  assert.equal(proposals.length, 1); assert.equal(proposals[0].artifact_type, 'vision')
  assert.match(container.textContent, /Allowed preview/)
  let confirmations = 0
  repo.confirmProposal = async () => { confirmations += 1; return { outcome: 'accepted' } }
  await act(async () => root.render(createElement(ScopedDepartmentChat, { ...props('a', new AbortController().signal), allowedArtifactTypes: [] })))
  await flush()
  await act(async () => byText(container, 'button', 'Confirm official draft').dispatchEvent(new E('click')))
  assert.equal(confirmations, 0)
  assert.match(container.textContent, /artifact tool is unavailable/)
  await act(async () => root.unmount())
})

test('Design media busy reuses the existing route blocker and cannot discard through an in-flight operation', async t => {
  const { container, ScopedDepartmentChat } = await setup(t)
  globalThis.__departmentChatTestRepository = repository([])
  const root = createRoot(container), transitions = []
  const blocker = { state: 'blocked', proceed: () => transitions.push('proceed'), reset: () => transitions.push('reset') }
  const base = { ...props('a', new AbortController().signal), navigationBlocker: blocker }
  await act(async () => root.render(createElement(ScopedDepartmentChat, { ...base, externalNavigationBusy: true })))
  await flush()
  assert.match(container.textContent, /media request is pending/)
  assert.equal(byText(container, 'button', 'Discard and continue'), undefined)
  await act(async () => byText(container, 'button', 'Stay on this page').dispatchEvent(new E('click')))
  assert.deepEqual(transitions, ['reset'])
  await act(async () => root.render(createElement(ScopedDepartmentChat, { ...base, externalNavigationBusy: false })))
  await flush(); assert.ok(byText(container, 'button', 'Discard and continue'))
  await act(async () => root.render(createElement(ScopedDepartmentChat, { ...base, externalNavigationBusy: true })))
  await flush()
  const discard = byText(container, 'button', 'Discard and continue')
  const propsKey = Object.keys(discard).find(key => key.startsWith('__reactProps$'))
  await act(async () => discard[propsKey].onClick())
  assert.deepEqual(transitions, ['reset'])
  await act(async () => root.unmount())
})
