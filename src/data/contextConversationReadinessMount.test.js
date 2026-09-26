import assert from 'node:assert/strict'
import test from 'node:test'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { createServer } from 'vite'
import { mountedEnvironment } from './testSupport/n1bMountedDom.js'

const descendants = node => [node, ...node.childNodes.flatMap(descendants)]
const button = (root, label) => descendants(root).find(node => node.tagName === 'BUTTON' && node.textContent.includes(label))

async function mount(t, readiness, panelProps = {}) {
  const environment = mountedEnvironment()
  const values = { document: environment.document, window: environment.window,
    Event: environment.window.Event, Node: environment.window.Node,
    HTMLElement: environment.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true }
  const previous = Object.fromEntries(Object.keys(values).map(key => [key, globalThis[key]]))
  Object.assign(globalThis, values)
  const calls = []
  globalThis.__contextReadinessFixture = {
    rows: [{ id: 'conversation', owner_id: 'actor', title: 'Private', state: 'active' }],
    created: [],
    readiness: input => { calls.push(input); return readiness(input) },
    runner: () => { throw new Error('Provider runner must not be called') },
  }
  const vite = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent',
    plugins: [{ name: 'offline-context-readiness', enforce: 'pre',
      resolveId(source) {
        if (source.endsWith('/context/AuthContext.jsx') || source.endsWith('../context/AuthContext.jsx')) return '\0context-auth'
        if (source.endsWith('/context/OrganizationContext.jsx') || source.endsWith('../context/OrganizationContext.jsx')) return '\0context-organization'
        if (source.endsWith('departmentChatRepository.js')) return '\0context-repository'
        if (source.endsWith('integrationRepository.js')) return '\0context-integrations'
        if (source.endsWith('contextChatRunnerRepository.js')) return '\0context-runner'
      },
      load(id) {
        if (id === '\0context-auth') return 'export const useAuth = () => ({ user: { id: "actor" } })'
        if (id === '\0context-organization') return 'export const useOrganization = () => ({ activeOrganizationId: "org", scopeRevision: 1, requestSignal: globalThis.__contextReadinessFixture.signal, handleOrganizationAccessError: () => {} })'
        if (id === '\0context-repository') return `export const departmentChat = {
          listContextConversations: async () => globalThis.__contextReadinessFixture.rows,
          createContextConversation: async input => {
            const fixture = globalThis.__contextReadinessFixture
            fixture.created.push(input)
            const row = { id: 'new-conversation', owner_id: 'actor', title: input.title }
            fixture.rows = [row, ...fixture.rows]
            return row
          },
          getContextConversation: async () => ({ messages: [{ id: 'message', author_id: 'actor', role: 'user', body: 'Question', status: 'completed' }], has_older: false }),
          getContextChatReadiness: async input => globalThis.__contextReadinessFixture.readiness(input),
        }`
        if (id === '\0context-integrations') return `export const integrations = { listModelAllowlist: async () => ({ connections: [{ id: 'connector', organization_level: true, status: 'verified', provider: 'openai', display_name: 'OpenAI', context_model_configurations: [{ id: 'model', model_id: 'verified' }] }] }) }`
        if (id === '\0context-runner') return 'export const contextChatRunner = { run: () => globalThis.__contextReadinessFixture.runner(), recover: () => globalThis.__contextReadinessFixture.runner() }'
      },
    }] })
  const { default: Panel } = await vite.ssrLoadModule('/src/components/ContextConversationPanel.jsx')
  const root = createRoot(environment.container)
  globalThis.__contextReadinessFixture.signal = new AbortController().signal
  t.after(async () => { await act(async () => root.unmount()); await vite.close(); Object.assign(globalThis, previous); delete globalThis.__contextReadinessFixture })
  await act(async () => root.render(createElement(Panel, { contextKind: 'organization', label: 'Organization conversations', ...panelProps })))
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) })
  return { environment, calls, root, Panel }
}

for (const [label, readiness, expected] of [
  ['paid off', () => ({ paid_execution_enabled: false, spend_tracking_configured: true, spend_guard_mode: 'local_monthly_cap', model_status: 'configured' }), 'AI execution is currently off'],
  ['tracking missing', () => ({ paid_execution_enabled: true, spend_tracking_configured: false, spend_guard_mode: null, model_status: 'configured' }), 'Organization spend tracking is not configured'],
  ['price missing', () => ({ paid_execution_enabled: true, spend_tracking_configured: true, spend_guard_mode: 'local_monthly_cap', model_status: 'price_unavailable' }), 'fresh verified price'],
  ['provider managed', () => ({ paid_execution_enabled: true, spend_tracking_configured: true, spend_guard_mode: 'provider_managed', model_status: 'configured' }), 'cannot verify or enforce'],
]) test('private context shows server readiness: ' + label, async t => {
  const { environment, calls } = await mount(t, readiness)
  assert.ok(calls.some(input => input.model_configuration_id === 'model'))
  assert.ok(environment.container.textContent.includes(expected))
  const ask = button(environment.container, 'Ask Anka AI')
  assert.ok(ask)
  assert.equal(ask.disabled, true, 'per-request consent is still required even when local checks pass')
})

test('Workshop conversation search, creation and department reset stay private', async t => {
  const { environment, root, Panel } = await mount(t, () => ({ paid_execution_enabled: false }),
    { contextKind: 'department_private', departmentId: 'design', workshopLayout: true })
  const props = node => node[Object.keys(node).find(key => key.startsWith('__reactProps$'))]
  const search = () => descendants(environment.container).find(node => node.tagName === 'INPUT' && props(node)['aria-label'] === 'Search loaded conversations')
  await act(async () => props(search()).onChange({ target: { value: 'missing' } }))
  assert.match(environment.container.textContent, /No matching loaded conversations/)
  assert.equal(button(environment.container, 'Private'), undefined)
  assert.match(environment.container.textContent, /Question/, 'search must not replace the open transcript')
  await act(async () => props(search()).onChange({ target: { value: '' } }))
  assert.ok(button(environment.container, 'Private'))
  const title = descendants(environment.container).find(node => node.tagName === 'INPUT' && props(node)['aria-label'] === 'New conversation title')
  await act(async () => props(title).onChange({ target: { value: 'New direction' } }))
  const form = descendants(environment.container).find(node => node.tagName === 'FORM' && node.textContent.includes('New conversation'))
  await act(async () => props(form).onSubmit({ preventDefault() {} }))
  assert.deepEqual(globalThis.__contextReadinessFixture.created, [{ context_kind: 'department_private', department_id: 'design', title: 'New direction' }])
  assert.ok(button(environment.container, 'New direction'))
  assert.match(environment.container.textContent, /AI unavailable; you can still save messages/)
  await act(async () => props(search()).onChange({ target: { value: 'old search' } }))
  globalThis.__contextReadinessFixture.rows = []
  await act(async () => root.render(createElement(Panel, { contextKind: 'department_private', departmentId: 'content', workshopLayout: true })))
  assert.equal(props(search()).value, '')
  assert.doesNotMatch(environment.container.textContent, /New direction|Question/)
})
