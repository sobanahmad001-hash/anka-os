import assert from 'node:assert/strict'
import test from 'node:test'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { createServer } from 'vite'
import { mountedEnvironment } from './testSupport/n1bMountedDom.js'

for (const contextKind of ['organization', 'project_team']) {
  test('authenticated ' + contextKind + ' conversation mounts without losing its user scope', async t => {
    const environment = mountedEnvironment()
    const values = { document: environment.document, window: environment.window,
      Event: environment.window.Event, Node: environment.window.Node,
      HTMLElement: environment.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true }
    const previous = Object.fromEntries(Object.keys(values).map(key => [key, globalThis[key]]))
    Object.assign(globalThis, values)
    globalThis.__privateContextMount = { signal: new AbortController().signal }
    const vite = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent',
      plugins: [{ name: 'offline-private-context-mount', enforce: 'pre',
        resolveId(source) {
          if (source.endsWith('AuthContext.jsx')) return '\0context-auth'
          if (source.endsWith('OrganizationContext.jsx')) return '\0context-organization'
          if (source.endsWith('departmentChatRepository.js')) return '\0context-repository'
          if (source.endsWith('integrationRepository.js')) return '\0context-integrations'
          if (source.endsWith('contextChatRunnerRepository.js')) return '\0context-runner'
        },
        load(id) {
          if (id === '\0context-auth') return 'export const useAuth = () => ({ user: { id: "actor" } })'
          if (id === '\0context-organization') return 'export const useOrganization = () => ({ activeOrganizationId: "org", scopeRevision: 1, requestSignal: globalThis.__privateContextMount.signal, handleOrganizationAccessError: () => {} })'
          if (id === '\0context-repository') return `export const departmentChat = {
            listContextConversations: async () => [{ id: 'conversation', owner_id: 'actor', title: 'Private conversation', state: 'active' }],
            getContextConversation: async () => ({ messages: [{ id: 'message', author_id: 'actor', role: 'user', body: 'Saved question', status: 'completed' }], has_older: false }),
            getContextChatReadiness: async () => ({ paid_execution_enabled: false }),
            getProjectContextSharing: async () => ({ candidates: [], recipients: [] }),
          }`
          if (id === '\0context-integrations') return 'export const integrations = { listModelAllowlist: async () => ({ connections: [] }) }'
          if (id === '\0context-runner') return 'export const contextChatRunner = { run: () => { throw new Error("Provider call forbidden") }, recover: () => { throw new Error("Provider call forbidden") } }'
        },
      }] })
    const { default: Panel } = await vite.ssrLoadModule('/src/components/ContextConversationPanel.jsx')
    const root = createRoot(environment.container)
    t.after(async () => { await act(async () => root.unmount()); await vite.close(); Object.assign(globalThis, previous); delete globalThis.__privateContextMount })
    await act(async () => root.render(createElement(Panel,
      { contextKind, projectId: contextKind === 'project_team' ? 'project' : '', label: 'Private conversations' })))
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) })
    assert.match(environment.container.textContent, /Private conversation/)
    assert.match(environment.container.textContent, /Saved question/)
    assert.match(environment.container.textContent, /Approved private conversation AI model/)
    if (contextKind === 'project_team') assert.match(environment.container.textContent, /Share this project conversation/)
  })
}
