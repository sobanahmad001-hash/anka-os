import assert from 'node:assert/strict'
import test from 'node:test'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { createServer } from 'vite'
import { mountedEnvironment, elements } from './testSupport/designVideoDom.js'

const props = node => node[Object.keys(node).find(key => key.startsWith('__reactProps$'))]
const privateRow = (id = 'same') => ({ id, title: 'Private ' + id, context_kind: 'department_private', department_id: 'design', owner_id: 'actor', project_id: null })
const engagement = { id: 'eng', project_id: 'project', organization_id: 'org', name: 'Launch' }
const engagementRow = (id = 'same') => ({ id, title: 'Engagement ' + id, organization_id: 'org', department_id: 'design', project_id: 'project', engagement_id: 'eng', owner_id: 'actor', access_role: 'recipient' })
const noop = () => {}

test('combined list paginates each source without losing the other loaded rows', async t => {
  const cursors = []
  const repo = {
    listContextConversations: async input => { cursors.push(['private', input.offset]); return input.offset ? [privateRow('older')] : Array.from({ length: 51 }, (_, i) => privateRow(String(i))) },
    searchConversations: async (_d, input) => { cursors.push(['engagement', input.before_id]); return input.before_id ? { items: [engagementRow('older')] } : { items: [engagementRow()], next_cursor: { id: 'same', last_activity_at: '2026-09-26T00:00:00Z' } } },
  }
  const { root, container, vite, signal } = await setup(t, repo)
  const { default: List } = await vite.ssrLoadModule('/src/components/WorkshopConversationList.jsx')
  await act(async () => root.render(createElement(List, { organizationId: 'org', actorId: 'actor', departmentId: 'design', engagement, signal, onOpen: noop })))
  assert.match(container.textContent, /51 loaded/)
  for (const kind of ['private', 'engagement']) await act(async () => props(elements(container, 'button').find(node => node.textContent === `Load more ${kind} conversations`)).onClick())
  assert.match(container.textContent, /53 loaded/)
  assert.match(container.textContent, /private: 51 loaded/)
  assert.match(container.textContent, /engagement: 2 loaded/)
  assert.deepEqual(cursors, [['private', 0], ['engagement', undefined], ['private', 50], ['engagement', 'same']])
})

async function setup(t, repository) {
  const env = mountedEnvironment()
  const abortController = new AbortController()
  const values = { document: env.document, window: env.window, Node: env.window.Node, HTMLElement: env.window.HTMLElement,
    IS_REACT_ACT_ENVIRONMENT: true, fetch: () => { throw new Error('Network forbidden') },
    __workshopListFixture: { repository, signal: abortController.signal, handleError: noop } }
  const previous = Object.fromEntries(Object.keys(values).map(key => [key, globalThis[key]]))
  Object.assign(globalThis, values)
  const vite = await createServer({ server: { middlewareMode: true }, ssr: { noExternal: ['react-router-dom', 'react-router'] }, appType: 'custom', logLevel: 'silent',
    plugins: [{ name: 'offline-workshop-list', enforce: 'pre',
      resolveId(source) {
        if (source.endsWith('departmentChatRepository.js')) return '\0list-repo'
        if (source.endsWith('AuthContext.jsx')) return '\0list-auth'
        if (source.endsWith('OrganizationContext.jsx')) return '\0list-org'
        if (source.endsWith('integrationRepository.js')) return '\0list-models'
        if (source.endsWith('contextChatRunnerRepository.js')) return '\0list-runner'
        if (source === 'react-router-dom') return '\0list-router'
      },
      load(id) {
        if (id === '\0list-repo') return 'export const departmentChat = new Proxy({}, { get(_target, key) { return (...args) => globalThis.__workshopListFixture.repository[key](...args) } })'
        if (id === '\0list-auth') return 'export const useAuth = () => ({ user: { id: "actor" } })'
        if (id === '\0list-org') return 'export const useOrganization = () => ({ activeOrganizationId: "org", scopeRevision: 1, requestSignal: globalThis.__workshopListFixture.signal, handleOrganizationAccessError: globalThis.__workshopListFixture.handleError })'
        if (id === '\0list-models') return 'export const integrations = { listModelAllowlist: async () => ({ connections: [] }) }'
        if (id === '\0list-runner') return 'export const contextChatRunner = { run() { throw new Error("Paid calls forbidden") } }'
        if (id === '\0list-router') return 'export const useBlocker = () => ({ state: "unblocked" })'
      },
    }] })
  const root = createRoot(env.container)
  t.after(async () => { await act(async () => root.unmount()); await vite.close(); Object.assign(globalThis, previous) })
  return { ...env, root, vite, signal: values.__workshopListFixture.signal, abortController }
}

test('one list routes collision IDs by store, searches loaded titles, and rejects late scope pages', async t => {
  let resolveOld
  const calls = []
  const repo = {
    listContextConversations: async (_input, request) => { calls.push(request.organizationId); return request.organizationId === 'old' ? new Promise(resolve => { resolveOld = resolve }) : [privateRow()] },
    searchConversations: async () => ({ items: [engagementRow()] }),
  }
  const { root, container, vite, signal } = await setup(t, repo)
  const { default: List } = await vite.ssrLoadModule('/src/components/WorkshopConversationList.jsx')
  const opened = []
  const render = organizationId => act(async () => root.render(createElement(List, { organizationId, actorId: 'actor', departmentId: 'design', scopeRevision: 1, engagement: organizationId === 'org' ? engagement : null, signal, onOpen: row => opened.push(row) })))
  await render('old')
  await render('org')
  await act(async () => resolveOld([privateRow('STALE')]))
  assert.doesNotMatch(container.textContent, /STALE/)
  assert.match(container.textContent, /2 loaded/)
  for (const title of ['Private same', 'Engagement same']) await act(async () => props(elements(container, 'button').find(node => node.textContent.startsWith(title))).onClick())
  assert.notEqual(opened[0].key, opened[1].key)
  assert.deepEqual(opened.map(row => row.kind), ['private', 'engagement'])
  await act(async () => props(elements(container, 'input')[0]).onChange({ target: { value: 'Private' } }))
  assert.match(container.textContent, /1 matching loaded titles/)
  assert.doesNotMatch(container.textContent, /Engagement same/)
  assert.deepEqual(calls, ['old', 'org'], 'loaded-title search must not broaden server scope')
})

for (const kind of ['private', 'engagement']) for (const outcome of ['exact', 'denied', 'missing']) {
  test(`${kind} external selection ${outcome} never opens the first list row`, async t => {
    const reads = []
    const selected = kind === 'private' ? privateRow('requested') : engagementRow('requested')
    const read = async input => {
      reads.push(input.conversation_id)
      if (outcome === 'denied') throw new Error('Denied exact selection')
      return { conversation: outcome === 'missing' ? null : selected, messages: [{ id: 'message', role: 'assistant', body: 'EXACT_TRANSCRIPT' }], sharing: { can_manage: false, recipients: [] } }
    }
    const repo = {
      listContextConversations: async () => [privateRow('first')], getContextConversation: read,
      getContextChatReadiness: async () => ({ paid_execution_enabled: false }),
      searchConversations: async () => ({ items: [engagementRow('first')] }),
      getCapabilities: async () => ({ approved_models: [] }), getConversation: async (_d, input) => read(input),
      listAttachments: async () => [], listSourceVersions: async () => [], getUnsentDraft: async () => null,
    }
    const { root, container, vite, signal } = await setup(t, repo)
    const { default: Panel } = await vite.ssrLoadModule(kind === 'private' ? '/src/components/ContextConversationPanel.jsx' : '/src/components/DepartmentChat.jsx')
    await act(async () => root.render(createElement(Panel, { contextKind: 'department_private', departmentId: 'design', engagement, initialConversation: selected, hideConversationList: true, requestSignal: signal })))
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) })
    assert.deepEqual(reads, ['requested'])
    if (outcome === 'exact') assert.match(container.textContent, /EXACT_TRANSCRIPT/)
    else { assert.doesNotMatch(container.textContent, /EXACT_TRANSCRIPT/); assert.match(container.textContent, /Denied exact selection|Selected conversation is unavailable/) }
    assert.doesNotMatch(container.textContent, /Search permitted conversations|Search loaded conversations/)
  })
}

for (const changed of ['project_id', 'id']) test(`combined list rejects a late ${changed} page and resets loaded-title search`, async t => {
  let resolveOld
  const repo = {
    listContextConversations: async () => [privateRow()],
    searchConversations: async (_d, input) => input.engagement_id === 'eng' && input.project_id === 'project'
      ? new Promise(resolve => { resolveOld = resolve })
      : ({ items: [{ ...engagementRow('NEW'), project_id: input.project_id, engagement_id: input.engagement_id }] }),
  }
  const { root, container, vite, signal } = await setup(t, repo)
  const { default: List } = await vite.ssrLoadModule('/src/components/WorkshopConversationList.jsx')
  const render = selected => act(async () => root.render(createElement(List, { organizationId: 'org', actorId: 'actor', departmentId: 'design', scopeRevision: 1, engagement: selected, signal, onOpen: noop })))
  await render(engagement)
  await act(async () => props(elements(container, 'input')[0]).onChange({ target: { value: 'old filter' } }))
  await render({ ...engagement, [changed]: 'new-scope' })
  await act(async () => resolveOld({ items: [engagementRow('STALE')] }))
  assert.equal(props(elements(container, 'input')[0]).value, '')
  assert.match(container.textContent, /Engagement NEW/)
  assert.doesNotMatch(container.textContent, /STALE/)
})

for (const kind of ['private', 'engagement']) test(`${kind} external selection changes on the same public mount and abort releases navigation`, async t => {
  const rows = kind === 'private' ? privateRow : engagementRow
  let resolveOld
  const read = input => input.conversation_id === 'old' ? new Promise(resolve => { resolveOld = resolve })
    : Promise.resolve({ conversation: rows(input.conversation_id), messages: [{ id: 'answer', role: 'assistant', body: 'CURRENT_TRANSCRIPT' }], sharing: { can_manage: false, recipients: [] } })
  const repo = {
    listContextConversations: async () => [privateRow('first')], getContextConversation: read,
    getContextChatReadiness: async () => ({ paid_execution_enabled: false }),
    searchConversations: async () => ({ items: [engagementRow('first')] }),
    getCapabilities: async () => ({ approved_models: [] }), getConversation: async (_d, input) => read(input),
    listAttachments: async () => [], listSourceVersions: async () => [], getUnsentDraft: async () => null,
  }
  const { root, container, vite, abortController } = await setup(t, repo)
  const { default: Panel } = await vite.ssrLoadModule(kind === 'private' ? '/src/components/ContextConversationPanel.jsx' : '/src/components/DepartmentChat.jsx')
  const busy = []
  const reportBusy = value => busy.push(value)
  const render = id => act(async () => root.render(createElement(Panel, { contextKind: 'department_private', departmentId: 'design', engagement, initialConversation: rows(id), hideConversationList: true, onNavigationBusyChange: reportBusy })))
  await render('old')
  await render('new')
  await act(async () => resolveOld({ conversation: rows('old'), messages: [{ id: 'old-answer', role: 'assistant', body: 'STALE_TRANSCRIPT' }] }))
  assert.match(container.textContent, /CURRENT_TRANSCRIPT/)
  assert.doesNotMatch(container.textContent, /STALE_TRANSCRIPT/)
  await render('old')
  assert.equal(busy.at(-1), true)
  await act(async () => abortController.abort())
  assert.equal(busy.at(-1), false)
  await act(async () => resolveOld({ conversation: rows('old'), messages: [{ id: 'old-answer', role: 'assistant', body: 'ABORTED_TRANSCRIPT' }] }))
  assert.doesNotMatch(container.textContent, /ABORTED_TRANSCRIPT/)
})
