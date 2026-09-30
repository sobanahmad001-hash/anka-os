import assert from 'node:assert/strict'
import test from 'node:test'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { createServer } from 'vite'
import { mountedEnvironment } from './testSupport/n1bMountedDom.js'
import { actor, organizationId, projectId, createDirectChatFixture, allowlist } from '../../tools/direct-chat-fixture.js'
import { directChatRecoveryKey, readDirectChatRecovery } from './directChatRecovery.js'
import { readDirectChatDraft } from './directChatDraft.js'

const descendants = node => [node, ...node.childNodes.flatMap(descendants)]
const props = node => node?.[Object.keys(node).find(key => key.startsWith('__reactProps$'))]
const defer = () => { let resolve; const promise = new Promise(done => { resolve = done }); return { promise, resolve } }
const flush = () => act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) })

async function mount(t, options = {}) {
  const environment = mountedEnvironment(), storage = new Map()
  const values = { document: environment.document, window: environment.window, Event: environment.window.Event,
    Node: environment.window.Node, HTMLElement: environment.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true,
    sessionStorage: { getItem: key => storage.get(key) || null, setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) } }
  const previous = Object.fromEntries(Object.keys(values).map(key => [key, globalThis[key]]))
  Object.assign(globalThis, values)
  const fixture = createDirectChatFixture(options)
  const scope = { contextKind: fixture.scope.context_kind, projectId: fixture.scope.project_id || '', departmentId: fixture.scope.department_id || '' }
  const accessError = () => {}
  globalThis.__directChatTest = { fixture, actor, allowlist, organization: { activeOrganizationId: organizationId, scopeRevision: 1, requestSignal: new AbortController().signal, handleOrganizationAccessError: accessError } }
  const vite = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent', plugins: [{
    name: 'direct-chat-mounted-offline', enforce: 'pre',
    resolveId(source) {
      if (source.endsWith('AuthContext.jsx')) return '\0direct-auth'
      if (source.endsWith('OrganizationContext.jsx')) return '\0direct-org'
      if (source.endsWith('departmentChatRepository.js')) return '\0direct-chat'
      if (source.endsWith('contextChatRunnerRepository.js')) return '\0direct-runner'
      if (source.endsWith('integrationRepository.js')) return '\0direct-integrations'
      if (source.endsWith('PrivateDesignVideoTools.jsx')) return '\0direct-video'
    },
    load(id) {
      if (id === '\0direct-auth') return 'export const useAuth = () => ({ user: { id: globalThis.__directChatTest.actor } })'
      if (id === '\0direct-org') return 'export const useOrganization = () => globalThis.__directChatTest.organization'
      if (id === '\0direct-chat') return 'export const departmentChat = new Proxy({}, {get: (_, key) => (...args) => globalThis.__directChatTest.fixture.chat[key](...args)})'
      if (id === '\0direct-runner') return 'export const contextChatRunner = new Proxy({}, {get: (_, key) => (...args) => globalThis.__directChatTest.fixture.runner[key](...args)})'
      if (id === '\0direct-integrations') return 'export const integrations = { listModelAllowlist: async () => globalThis.__directChatTest.allowlist }'
      if (id === '\0direct-video') return 'export default function Unused() { return null }'
    },
  }] })
  const { default: Panel } = await vite.ssrLoadModule('/src/components/ContextConversationPanel.jsx')
  const root = createRoot(environment.container)
  let key = 1
  const render = async (overrides = {}) => { await act(async () => root.render(createElement(Panel, { key, directSend: true, ...scope, ...overrides }))); await flush() }
  await render(options.initial ? { initialConversation: fixture.data.rows[0] } : {})
  t.after(async () => { await act(async () => root.unmount()); await vite.close(); Object.assign(globalThis, previous); delete globalThis.__directChatTest })
  const all = () => descendants(environment.container)
  const named = name => all().find(node => props(node)?.['aria-label'] === name)
  const button = name => all().find(node => node.tagName === 'BUTTON' && node.textContent === name)
  const click = async name => { const node = button(name); assert.ok(node, `Button ${name} exists`); assert.equal(node.disabled, false); await act(async () => { props(node).onClick?.({ preventDefault() {} }) }); await flush() }
  const type = async (text, name = 'Message') => { await act(async () => props(named(name)).onChange({ target: { value: text } })) }
  const send = async (twice = false) => { await act(async () => { const submit = props(named('Chat composer')).onSubmit; submit({ preventDefault() {} }); if (twice) submit({ preventDefault() {} }) }); await flush() }
  const consent = async () => click('Allow and ask Anka AI')
  return { fixture, storage, environment, render, named, button, click, type, send, consent, reload: async () => { key++; await render() } }
}

test('empty composer First Send is single-flight through consent/save/run; later Send reuses grant and saved chat', async t => {
  const ui = await mount(t)
  assert.equal(ui.named('Message').disabled, false)
  assert.equal(ui.fixture.data.rows.length, 0)
  await ui.type('First idea')
  await ui.send(true)
  assert.equal(ui.fixture.data.counters.created, 0)
  assert.ok(ui.named('Confirm AI data sharing'))
  await ui.consent()
  assert.deepEqual(ui.fixture.data.counters, { created: 1, messages: 1, run: 1, recover: 0 })
  assert.equal(ui.fixture.data.rows[0].title, 'First idea')
  assert.equal(ui.storage.size, 0)
  await ui.type('A follow-up')
  await ui.send(true)
  assert.equal(ui.named('Confirm AI data sharing'), undefined)
  assert.deepEqual(ui.fixture.data.counters, { created: 1, messages: 2, run: 2, recover: 0 })
  await ui.click('Open reply')
  const output = ui.named('Saved reply output')
  assert.equal(props(output)['data-source-message-id'], ui.fixture.data.messages.find(row => row.role === 'assistant').id)
  assert.equal(output.textContent.includes(props(output)['data-source-message-id']), false)
  assert.ok(output.textContent.includes('OFFLINE FIXTURE'))
  await ui.click('New chat')
  assert.equal(ui.named('Message').value, '')
  assert.equal(ui.fixture.data.rows.length, 1)
  assert.equal(ui.named('Saved reply output'), undefined)
})

test('cancelled consent creates nothing and retains draft', async t => {
  const ui = await mount(t)
  await ui.type('Keep this draft'); await ui.send(); await ui.click('Cancel')
  assert.equal(ui.fixture.data.rows.length, 0)
  assert.equal(ui.storage.size, 1)
  await ui.reload()
  assert.equal(ui.named('Message').value, 'Keep this draft')
})

test('unavailable readiness saves human message without consent or provider dispatch', async t => {
  const ui = await mount(t)
  ui.fixture.readiness = { ...ui.fixture.readiness, paid_execution_enabled: false }
  await ui.reload()
  await ui.type('Human note'); await ui.send()
  assert.deepEqual(ui.fixture.data.counters, { created: 1, messages: 1, run: 0, recover: 0 })
  assert.equal(ui.named('Confirm AI data sharing'), undefined)
})

test('failed dispatch retains draft and UUID-only metadata; recovery never runs again', async t => {
  const ui = await mount(t)
  ui.fixture.runFailure = true
  await ui.type('Private draft never in storage'); await ui.send(); await ui.consent()
  assert.equal(ui.fixture.data.counters.run, 1)
  assert.equal(ui.named('Message').value, 'Private draft never in storage')
  assert.ok(ui.button('Check recovery'))
  assert.equal(ui.storage.get(directChatRecoveryKey(actor, organizationId, 'department_private', '', 'content')).includes('Private draft'), false)
  assert.equal(readDirectChatDraft(directChatRecoveryKey(actor, organizationId, 'department_private', '', 'content')).text, 'Private draft never in storage')
  const record = readDirectChatRecovery(directChatRecoveryKey(actor, organizationId, 'department_private', '', 'content'))
  assert.ok(record.message_id && record.dispatch_request_id)
  await ui.click('Check recovery')
  assert.deepEqual(ui.fixture.data.counters, { created: 1, messages: 1, run: 1, recover: 1 })
  assert.equal(ui.storage.size, 0)
  assert.equal(ui.named('Message').value, '')
})

test('creation uncertainty reads canonical message without new creation or AI dispatch', async t => {
  const ui = await mount(t)
  ui.fixture.createUncertain = true
  await ui.type('Saved despite lost response'); await ui.send(); await ui.consent()
  assert.equal(ui.fixture.data.counters.created, 1)
  const before = [...ui.storage.values()][0]
  assert.ok(before.includes(ui.fixture.data.rows[0].id))
  await ui.click('Check recovery')
  assert.deepEqual(ui.fixture.data.counters, { created: 1, messages: 1, run: 0, recover: 0 })
  assert.equal(ui.storage.size, 0)
})

test('failed creation retries persistence with exactly the same IDs and body', async t => {
  const ui = await mount(t)
  const calls = []
  ui.fixture.beforeStart = input => { calls.push(input); if (calls.length === 1) throw new Error('Network response unavailable') }
  await ui.type('One exact message'); await ui.send(); await ui.consent()
  await ui.click('Check recovery')
  assert.equal(calls.length, 2)
  for (const field of ['conversation_id', 'client_request_id', 'message']) assert.equal(calls[0][field], calls[1][field])
  assert.equal(ui.fixture.data.counters.created, 1)
  assert.equal(ui.fixture.data.counters.run, 0)
})

test('reload recovers canonical saved reply without carrying private draft or running again', async t => {
  const ui = await mount(t)
  ui.fixture.runFailure = true
  await ui.type('Private reload text'); await ui.send(); await ui.consent()
  await ui.reload()
  assert.deepEqual(ui.fixture.data.counters, { created: 1, messages: 1, run: 1, recover: 1 })
  assert.equal(ui.storage.size, 0)
  assert.equal(ui.named('Message').value, '')
  assert.ok(ui.environment.container.textContent.includes('Private reload text'))
})

test('unsettled recovery across reload blocks new send and never redispatches', async t => {
  const ui = await mount(t)
  ui.fixture.runFailure = true; ui.fixture.recoveryAvailable = false
  await ui.type('Uncertain original'); await ui.send(); await ui.consent()
  const before = [...ui.storage.values()][0]
  await ui.reload()
  assert.equal([...ui.storage.values()][0], before)
  await ui.type('Do not submit a replacement'); await ui.send(true)
  await ui.click('Check recovery')
  assert.equal(ui.fixture.data.counters.run, 1)
  assert.equal(ui.fixture.data.counters.messages, 1)
  assert.equal(ui.fixture.data.counters.recover, 2)
  assert.equal(ui.named('Message').value, 'Uncertain original')
  assert.equal(ui.named('Message').disabled, true)
})

test('reload after creation uncertainty restores first request identity and never runs', async t => {
  const ui = await mount(t)
  ui.fixture.createUncertain = true
  await ui.type('Creation reload'); await ui.send(); await ui.consent()
  await ui.reload()
  assert.deepEqual(ui.fixture.data.counters, { created: 1, messages: 1, run: 0, recover: 0 })
  assert.equal(ui.storage.size, 0)
  assert.equal(ui.named('Message').value, '')
})

test('project owner first and later Send use approved model and canonical is opt-in per reply', async t => {
  const ui = await mount(t, { surface: 'project' })
  const inputs = []
  ui.fixture.beforeRun = input => inputs.push(input)
  await ui.type('Project direction'); await ui.send(); await ui.consent()
  assert.equal(inputs[0].include_canonical_context, false)
  await ui.click('Details')
  const checkbox = descendants(ui.environment.container).find(node => node.tagName === 'INPUT' && props(node)?.type === 'checkbox')
  await act(async () => props(checkbox).onChange({ target: { checked: true } }))
  await ui.type('Use current project context'); await ui.send(); await ui.consent()
  assert.equal(inputs[1].include_canonical_context, true)
  assert.equal(props(checkbox).checked, false)
  assert.equal(ui.fixture.data.counters.created, 1)
})

test('late save callback after context switch cannot dispatch or leak messages', async t => {
  const ui = await mount(t)
  const gate = defer()
  ui.fixture.beforeStart = () => gate.promise
  await ui.type('Old private context'); await ui.send(); await ui.consent()
  await ui.render({ contextKind: 'project_team', projectId, departmentId: '' })
  await act(async () => gate.resolve()); await flush()
  assert.equal(ui.fixture.data.counters.run, 0)
  assert.equal(ui.environment.container.textContent.includes('Old private context'), false)
  assert.equal(ui.named('Message').value, '')
})

test('late consent after context switch cannot save or dispatch', async t => {
  const ui = await mount(t)
  await ui.type('Old consent'); await ui.send()
  const accept = props(ui.button('Allow and ask Anka AI')).onClick
  await ui.render({ contextKind: 'project_team', projectId, departmentId: '' })
  await act(async () => accept()); await flush()
  assert.equal(ui.fixture.data.counters.created, 0)
  assert.equal(ui.fixture.data.counters.run, 0)
})

test('shared project collaborator can save human replies but cannot run AI, rename or share', async t => {
  const ui = await mount(t, { surface: 'project', state: 'populated', initial: true })
  globalThis.__directChatTest.actor = 'a0000000-0000-4000-8000-000000000099'
  await ui.render({ initialConversation: ui.fixture.data.rows[0] })
  await ui.type('Collaborator reply'); await ui.send()
  assert.equal(ui.fixture.data.counters.messages, 1)
  assert.equal(ui.fixture.data.counters.run, 0)
  assert.equal(ui.button('Share'), undefined)
  assert.equal(ui.named('Approved model'), undefined)
  await ui.click('Details')
  assert.equal(ui.named('Rename chat'), undefined)
})

test('history does not auto-select; private filtering, search and rename are scoped', async t => {
  const ui = await mount(t, { state: 'populated' })
  ui.fixture.data.rows.push({ ...ui.fixture.data.rows[0], id: crypto.randomUUID(), owner_id: 'foreign', title: 'Foreign private text' })
  await ui.reload()
  assert.equal(ui.environment.container.textContent.includes('Write a clear introduction'), false)
  assert.ok(ui.named('Chat history'))
  assert.equal(ui.environment.container.textContent.includes('Foreign private text'), false)
  await ui.type('missing title', 'Search loaded chats')
  assert.equal(ui.button('A clear introduction'), undefined)
  await ui.type('', 'Search loaded chats'); await ui.click('A clear introduction')
  await ui.click('Details'); await ui.type('Renamed on demand', 'Rename chat')
  const form = descendants(ui.environment.container).find(node => node.tagName === 'FORM' && node !== ui.named('Chat composer'))
  await act(async () => props(form).onSubmit({ preventDefault() {} })); await flush()
  assert.equal(ui.fixture.data.rows[0].title, 'Renamed on demand')
})


test('unsent draft survives refresh in its exact scope and clears after successful Send', async t => {
  const ui = await mount(t, { surface: 'project' })
  await ui.type('Project A draft')
  await ui.reload()
  assert.equal(ui.named('Message').value, 'Project A draft')
  assert.equal(ui.fixture.data.rows.length, 0)
  await ui.render({ contextKind: 'project_team', projectId: crypto.randomUUID(), departmentId: '' })
  assert.equal(ui.named('Message').value, '')
  await ui.render()
  assert.equal(ui.named('Message').value, 'Project A draft')
  await ui.send(); await ui.consent()
  assert.equal(ui.storage.size, 0)
})

test('reload after an unsaved first-send failure preserves body and retries only identical persistence', async t => {
  const ui = await mount(t)
  const calls = []
  ui.fixture.beforeStart = input => { calls.push(input); if (calls.length === 1) throw new Error('Save failed before commit') }
  await ui.type('Recover this exact draft'); await ui.send(); await ui.consent()
  await ui.reload()
  assert.equal(ui.named('Message').value, 'Recover this exact draft')
  await ui.click('Check recovery')
  for (const key of ['conversation_id', 'client_request_id', 'message']) assert.equal(calls[1][key], calls[0][key])
  assert.deepEqual(ui.fixture.data.counters, { created: 1, messages: 1, run: 0, recover: 0 })
  assert.equal(ui.storage.size, 0)
})

test('unsettled AI recovery retains the original draft across refresh and disables conversation replacement', async t => {
  const ui = await mount(t)
  ui.fixture.runFailure = true; ui.fixture.recoveryAvailable = false
  await ui.type('Keep uncertain original'); await ui.send(); await ui.consent(); await ui.reload()
  assert.equal(ui.named('Message').value, 'Keep uncertain original')
  assert.equal(ui.button('New chat').disabled, true)
  assert.equal(ui.fixture.data.counters.run, 1)
})
