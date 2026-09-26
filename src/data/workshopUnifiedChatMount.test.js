import assert from 'node:assert/strict'
import test from 'node:test'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'
import { createServer } from 'vite'
import { mountedEnvironment, elements } from './testSupport/designVideoDom.js'

test('unified Workshop Chat labels existing histories and requires a deliberate context switch', async t => {
  const environment = mountedEnvironment()
  const globals = { document: environment.document, window: environment.window,
    Node: environment.window.Node, HTMLElement: environment.window.HTMLElement,
    IS_REACT_ACT_ENVIRONMENT: true, fetch: () => { throw new Error('Network/provider calls forbidden') } }
  const previous = Object.fromEntries(Object.keys(globals).map(key => [key, globalThis[key]]))
  Object.assign(globalThis, globals)
  const vite = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent' })
  const { default: Chat } = await vite.ssrLoadModule('/src/components/WorkshopChatWorkspace.jsx')
  const root = createRoot(environment.container)
  t.after(async () => { await act(async () => root.unmount()); await vite.close(); Object.assign(globalThis, previous) })
  const calls = []
  const props = node => node[Object.keys(node).find(key => key.startsWith('__reactProps$'))]
  const button = text => elements(environment.container, 'button').find(node => node.textContent === text)
  const render = async (mode, key = 'org-1') => act(async () => root.render(createElement(Chat,
    { key, mode, onModeChange: value => calls.push(value), departmentName: 'Design', projectName: 'Launch', engagementName: 'Campaign' },
    createElement('p', null, mode === 'private' ? 'Existing private saved list' : 'Existing engagement saved list'))))
  await render('private')
  assert.match(environment.container.textContent, /no project attached/)
  assert.match(environment.container.textContent, /Visibility: only you/)
  assert.match(environment.container.textContent, /Existing private saved list/)
  await act(async () => props(elements(environment.container, 'select')[0]).onChange({ target: { value: 'chat' } }))
  assert.deepEqual(calls, [])
  assert.match(environment.container.textContent, /Existing private saved list/)
  assert.match(environment.container.textContent, /unsaved text and selections are not transferred/)
  await act(async () => props(button('Stay in current context')).onClick())
  assert.equal(button('Switch context'), undefined)
  await act(async () => props(elements(environment.container, 'select')[0]).onChange({ target: { value: 'chat' } }))
  await act(async () => props(button('Switch context')).onClick())
  assert.deepEqual(calls, ['chat'])
  await render('chat')
  assert.match(environment.container.textContent, /Launch · Campaign/)
  assert.match(environment.container.textContent, /creator-private unless explicitly shared/)
  assert.match(environment.container.textContent, /Existing engagement saved list/)
  assert.doesNotMatch(environment.container.textContent, /Existing private saved list/)
  await act(async () => props(elements(environment.container, 'select')[0]).onChange({ target: { value: 'private' } }))
  await render('private', 'org-2')
  assert.equal(button('Switch context'), undefined, 'scope remount must discard pending context intent')
  assert.deepEqual(calls, ['chat'], 'render and scope reset cannot dispatch a context change')
})

test('engagement chat optional presentation label preserves its default and controls', async t => {
  const vite = await createServer({ server: { middlewareMode: true }, ssr: { noExternal: ['react-router-dom', 'react-router'] }, appType: 'custom', logLevel: 'silent',
    plugins: [{ name: 'offline-workshop-heading', enforce: 'pre',
      resolveId(source) {
        if (source.endsWith('AuthContext.jsx')) return '\0heading-auth'
        if (source.endsWith('OrganizationContext.jsx')) return '\0heading-org'
        if (source.endsWith('departmentChatRepository.js')) return '\0heading-repository'
        if (source === 'react-router-dom') return '\0heading-router'
      },
      load(id) {
        if (id === '\0heading-auth') return 'export const useAuth = () => ({})'
        if (id === '\0heading-org') return 'export const useOrganization = () => ({})'
        if (id === '\0heading-router') return 'export const useBlocker = () => ({ state: "unblocked" })'
        if (id === '\0heading-repository') return 'export const departmentChat = new Proxy({}, { get() { throw new Error("Repository calls forbidden") } })'
      },
    }] })
  t.after(() => vite.close())
  const { ScopedDepartmentChat } = await vite.ssrLoadModule('/src/components/DepartmentChat.jsx')
  const base = { departmentId: 'design', engagement: { id: 'engagement', project_id: 'project', name: 'Launch' },
    organizationId: 'org', userId: 'user', requestSignal: new AbortController().signal }
  const original = renderToStaticMarkup(createElement(ScopedDepartmentChat, base))
  const unified = renderToStaticMarkup(createElement(ScopedDepartmentChat, { ...base, presentationLabel: 'Engagement conversations' }))
  assert.match(original, /Shared Department Chat/)
  assert.doesNotMatch(unified, /Shared Department Chat/)
  assert.equal(unified, original.replace('Shared Department Chat', 'Engagement conversations'), 'only heading text changes; saved-list/model/attachment/consent/proposal markup is identical')
})
