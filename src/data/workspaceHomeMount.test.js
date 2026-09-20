import assert from 'node:assert/strict'
import test from 'node:test'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { createServer } from 'vite'
import { mountedEnvironment } from './testSupport/n1bMountedDom.js'

function snapshot(label) {
  return {
    summary: { activeProjects: 1, projectTasks: 1, engagementWorkItems: 0, dueSoon: 0, overdue: 0, blocked: 0, reviews: 0 },
    priorities: [{ id: label, source: 'Project Task', title: label, projectId: 'project', projectName: label, department: 'design', priority: 'urgent', tab: 'project-tasks' }],
    dueWork: [], blockers: [], reviews: [], departments: [], activities: [],
  }
}

test('Workspace Home hides old organization records immediately and ignores late responses', async t => {
  const environment = mountedEnvironment()
  const globals = { document: environment.document, window: environment.window, Node: environment.window.Node,
    HTMLElement: environment.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true }
  const previous = Object.fromEntries(Object.keys(globals).map(key => [key, globalThis[key]]))
  Object.assign(globalThis, globals)
  const requests = []
  const handles = { access() {} }
  globalThis.__homeMount = {
    organization: { activeOrganizationId: 'org-a', activeOrganization: { name: 'Org A' },
      requestSignal: new AbortController().signal, handleOrganizationAccessError: handles.access },
    requests,
  }
  const server = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent',
    plugins: [{ name: 'home-offline-context', enforce: 'pre',
      resolveId(source) {
        if (source.endsWith('/AuthContext.jsx')) return '/home-auth'
        if (source.endsWith('/OrganizationContext.jsx')) return '/home-organization'
        if (source.endsWith('/workspaceHome.js')) return '/home-repository'

      },
      transform(code, id) {
        if (id.endsWith('/WorkspaceHome.jsx')) return code.replace("import { useNavigate } from 'react-router-dom'", 'const useNavigate = () => () => {}')
      },
      load(id) {

        if (id === '/home-auth') return 'export const useAuth = () => ({ profile: { full_name: "Owner" } })'
        if (id === '/home-organization') return 'export const useOrganization = () => globalThis.__homeMount.organization'
        if (id === '/home-repository') return `export const workspaceHome = { forOrganization(organizationId) { return {
          getSnapshot() { return new Promise(resolve => globalThis.__homeMount.requests.push({ organizationId, resolve })) }
        } } }`
      },
    }] })
  let root
  t.after(async () => {
    if (root) await act(async () => root.unmount())
    await server.close()
    Object.assign(globalThis, previous)
    delete globalThis.__homeMount
  })
  const { default: Home } = await server.ssrLoadModule('/src/apps/WorkspaceHome.jsx')
  root = createRoot(environment.container)
  const render = () => act(async () => root.render(createElement(Home)))
  await render()
  assert.equal(requests.at(-1).organizationId, 'org-a')
  await act(async () => requests.at(-1).resolve(snapshot('A-only work')))
  assert.match(environment.container.textContent, /A-only work/)

  const descendants = node => [node, ...node.childNodes.flatMap(descendants)]
  const refresh = descendants(environment.container).find(node => node.tagName === 'BUTTON' && node.textContent === 'Refresh')
  await act(async () => refresh.dispatchEvent(new environment.window.Event('click')))
  assert.equal(requests.at(-1).organizationId, 'org-a')
  const stale = requests.at(-1)
  globalThis.__homeMount.organization = { activeOrganizationId: 'org-b', activeOrganization: { name: 'Org B' },
    requestSignal: new AbortController().signal, handleOrganizationAccessError: handles.access }
  await render()
  assert.equal(requests.at(-1).organizationId, 'org-b')
  assert.doesNotMatch(environment.container.textContent, /A-only work/)
  await act(async () => stale.resolve(snapshot('A-stale work')))
  assert.doesNotMatch(environment.container.textContent, /A-stale work/)
  await act(async () => requests.at(-1).resolve(snapshot('B-only work')))
  assert.match(environment.container.textContent, /B-only work/)
  globalThis.__homeMount.organization = { activeOrganizationId: 'org-a', activeOrganization: { name: 'Org A' },
    requestSignal: new AbortController().signal, handleOrganizationAccessError: handles.access }
  await render()
  assert.doesNotMatch(environment.container.textContent, /A-only work|B-only work/)
  await act(async () => requests.at(-1).resolve(snapshot('A-fresh work')))
  assert.match(environment.container.textContent, /A-fresh work/)
})
