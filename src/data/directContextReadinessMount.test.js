import assert from 'node:assert/strict'
import test from 'node:test'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { createServer } from 'vite'
import { mountedEnvironment } from './testSupport/n1bMountedDom.js'
import { actor, organizationId, createDirectChatFixture, allowlist } from '../../tools/direct-chat-fixture.js'

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
  const scopeController = new AbortController()
  globalThis.__directChatTest = { fixture, actor, allowlist: options.allowlist || allowlist, organization: { activeOrganizationId: organizationId, scopeRevision: 1, requestSignal: scopeController.signal, handleOrganizationAccessError: accessError } }
  const vite = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent', plugins: [{
    name: 'direct-chat-mounted-offline', enforce: 'pre',
    resolveId(source) {
      if (source.endsWith('/lib/supabase.js')) return '\0direct-import-client'
      if (source.endsWith('AuthContext.jsx')) return '\0direct-auth'
      if (source.endsWith('OrganizationContext.jsx')) return '\0direct-org'
      if (source.endsWith('departmentChatRepository.js')) return '\0direct-chat'
      if (source.endsWith('contextChatRunnerRepository.js')) return '\0direct-runner'
      if (source.endsWith('integrationRepository.js')) return '\0direct-integrations'
      if (source.endsWith('PrivateDesignVideoTools.jsx')) return '\0direct-video'
    },
    load(id) {
      if (id === '\0direct-import-client') return 'export const supabase = {functions:{invoke(){throw Error("Unexpected importer network request")}}}'
      if (id === '\0direct-auth') return 'export const useAuth = () => ({ user: { id: globalThis.__directChatTest.actor } })'
      if (id === '\0direct-org') return 'export const useOrganization = () => globalThis.__directChatTest.organization'
      if (id === '\0direct-chat') return 'export const departmentChat = new Proxy({}, {get: (_, key) => (...args) => globalThis.__directChatTest.fixture.chat[key](...args)})'
      if (id === '\0direct-runner') return 'export const contextChatRunner = new Proxy({}, {get: (_, key) => (...args) => globalThis.__directChatTest.fixture.runner[key](...args)})'
      if (id === '\0direct-integrations') return 'export const integrations = { listModelAllowlist: async () => globalThis.__directChatTest.allowlist }'
      if (id === '\0direct-video') return `import {createElement} from 'react'; export default function VideoBridgeProbe(props){globalThis.__directChatTest.video = props; return createElement('span',null,'Offline video bridge probe')}`
    },
  }] })
  const { default: Panel } = await vite.ssrLoadModule('/src/components/ContextConversationPanel.jsx')
  const root = createRoot(environment.container)
  let key = 1
  const render = async (overrides = {}) => { await act(async () => root.render(createElement(Panel, { key, directSend: true, ...scope, ...overrides }))); await flush() }
  if (options.readiness) fixture.chat.getContextChatReadiness = options.readiness
  await render(options.initial ? { initialConversation: fixture.data.rows[0] } : {})
  t.after(async () => { await act(async () => root.unmount()); await vite.close(); Object.assign(globalThis, previous); delete globalThis.__directChatTest })
  const all = () => descendants(environment.container)
  const named = name => all().find(node => props(node)?.['aria-label'] === name)
  const button = name => all().find(node => node.tagName === 'BUTTON' && node.textContent === name)
  const click = async name => { const node = button(name); assert.ok(node, `Button ${name} exists`); assert.equal(node.disabled, false); await act(async () => { props(node).onClick?.({ preventDefault() {} }) }); await flush() }
  const type = async (text, name = 'Message') => { await act(async () => props(named(name)).onChange({ target: { value: text } })) }
  const send = async (twice = false) => { await act(async () => { const submit = props(named('Chat composer')).onSubmit; submit({ preventDefault() {} }); if (twice) submit({ preventDefault() {} }) }); await flush() }
  const consent = async () => { if (button('Allow and ask Anka AI')) await click('Allow and ask Anka AI') }
  return { scopeController, fixture, storage, environment, render, named, button, click, type, send, consent, reload: async () => { key++; await render() } }
}

test('readiness rejection ends loading; read-only retry restores Send without dispatch', async t => {
  let fail=true, calls=0
  const ui=await mount(t,{readiness:async()=>{calls++;if(fail)throw Error('offline');return {paid_execution_enabled:true,spend_tracking_configured:true,model_status:'configured'}}})
  assert.match(ui.environment.container.textContent,/AI availability could not be checked/)
  assert.doesNotMatch(ui.environment.container.textContent,/Checking AI availability/)
  assert.ok(ui.button('Save message'))
  fail=false;await ui.click('Retry AI availability')
  assert.ok(ui.button('Send'))
  assert.deepEqual(ui.fixture.data.counters,{created:0,messages:0,run:0,recover:0})
  assert(calls>=2)
})

test('stalled readiness times out and ignores late success; aborted scope never becomes ready', async t => {
  const original=globalThis.setTimeout,timers=[]
  globalThis.setTimeout=(callback,delay,...args)=>delay===15000?(timers.push(callback),0):original(callback,delay,...args)
  t.after(()=>{globalThis.setTimeout=original})
  const pending=[]
  const ui=await mount(t,{readiness:(_input,scope)=>{const deferred=defer();pending.push({...deferred,signal:scope.signal});return deferred.promise}})
  assert.match(ui.environment.container.textContent,/Checking AI availability/)
  await act(async()=>timers.at(-1)())
  assert.match(ui.environment.container.textContent,/AI availability could not be checked/)
  assert.equal(pending.at(-1).signal.aborted,true)
  await act(async()=>pending.forEach(item=>item.resolve({paid_execution_enabled:true,spend_tracking_configured:true,model_status:'configured'})))
  assert.ok(ui.button('Save message'));assert.equal(ui.button('Send'),undefined)
  await ui.click('Retry AI availability')
  await act(async()=>ui.scopeController.abort())
  await act(async()=>pending.at(-1).resolve({paid_execution_enabled:true,spend_tracking_configured:true,model_status:'configured'}))
  assert.equal(ui.button('Send'),undefined)
  assert.deepEqual(ui.fixture.data.counters,{created:0,messages:0,run:0,recover:0})
})

test('genuine unavailability stays save-only; malformed readiness is a failed check', async t=>{
  const ui=await mount(t,{readiness:async()=>({paid_execution_enabled:false,spend_tracking_configured:true,model_status:'configured'})})
  assert.ok(ui.button('Save message'));assert.equal(ui.button('Send'),undefined)
  assert.doesNotMatch(ui.environment.container.textContent,/Checking AI availability/)
  ui.fixture.chat.getContextChatReadiness=async()=>null
  await ui.reload()
  assert.match(ui.environment.container.textContent,/AI availability could not be checked/)
  assert.ok(ui.button('Save message'))
  assert.deepEqual(ui.fixture.data.counters,{created:0,messages:0,run:0,recover:0})
})
