import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { transformSync } from 'esbuild'
import { mountedEnvironment } from './testSupport/n1bMountedDom.js'
import { selectLivingProjectSnapshot } from './livingProjectReference.js'
import { canPreserveReportsSnapshot } from './reportsAndRecordsOperation.js'
const nativeRequire = createRequire(import.meta.url)
const nodes = node => [node, ...node.childNodes.flatMap(nodes)]
const data = org => ({ records: { livingRecord: { id: 'document' } }, document: {
  project: { id: 'project', name: org + ' current', owner_id: 'user' }, loadedAt: '2026-09-26T00:00:00Z', sourceVersion: 4,
  snapshots: [{ id: 'history', organization_id: org, project_id: 'project', living_project_document_id: 'document',
    projection_kind: 'internal', source_version: 2, snapshot: { project: { name: org + ' historic' } } }],
  coverage: 'Supplemental records not checkpointed', unavailable: [], brief: { description: org + ' brief' },
  agreedServices: [], proposedServices: [], decisions: [], confirmedPreferences: [], proposedChanges: [],
  milestones: [], tasks: [], workItems: [], owner: { name: 'Owner' }, activeConfiguration: null,
} })

test('mounted document isolates exact saved history and suppresses pending checkpoint/late loads across organizations', async t => {
  const env = mountedEnvironment()
  const previous = { document: globalThis.document, window: globalThis.window, IS_REACT_ACT_ENVIRONMENT: globalThis.IS_REACT_ACT_ENVIRONMENT }
  Object.assign(globalThis, { document: env.document, window: env.window, IS_REACT_ACT_ENVIRONMENT: true })
  const controller = new AbortController(), handleOrganizationAccessError = () => false
  let organization = { activeOrganizationId: 'org-a', activeMembership: { role: 'system_owner' }, scopeRevision: 1,
    requestSignal: controller.signal, handleOrganizationAccessError }
  let params = new URLSearchParams('snapshot=history'), resolveSave, lateLoad, callsA = 0
  const repository = { load: async org => {
    if (org === 'org-a' && ++callsA > 1) return new Promise(resolve => { lateLoad = resolve })
    return data(org)
  }, preserve: () => new Promise(resolve => { resolveSave = resolve }) }
  const compiled = transformSync(readFileSync(new URL('../apps/LivingProjectReference.jsx', import.meta.url), 'utf8'),
    { loader: 'jsx', format: 'cjs', jsxFactory: 'React.createElement' }).code
  const module = { exports: {} }
  const require = name => {
    if (name.includes('AuthContext')) return { useAuth: () => ({ user: { id: 'user' } }) }
    if (name.includes('OrganizationContext')) return { useOrganization: () => organization }
    if (name.includes('livingProjectReferenceRepository')) return { livingProjectReference: repository }
    if (name.endsWith('/livingProjectReference.js')) return { selectLivingProjectSnapshot }
    if (name.includes('reportsAndRecordsOperation')) return { canPreserveReportsSnapshot }
    if (name === 'react-router-dom') return { Link: props => React.createElement('a', { href: props.to }, props.children),
      useParams: () => ({ projectId: 'project' }), useSearchParams: () => [params, next => { params = next }] }
    return nativeRequire(name)
  }
  new Function('require', 'module', 'exports', 'React', compiled)(require, module, module.exports, React)
  const root = createRoot(env.container), Component = module.exports.default
  t.after(async () => { await act(async () => root.unmount()); Object.assign(globalThis, previous) })
  const render = () => act(async () => { root.render(React.createElement(Component)); await new Promise(resolve => setTimeout(resolve, 0)) })
  const click = text => act(async () => {
    const node = nodes(env.container).find(node => node.tagName === 'BUTTON' && node.textContent === text)
    assert.ok(node, text)
    node[Object.keys(node).find(key => key.startsWith('__reactProps$'))].onClick()
    await new Promise(resolve => setTimeout(resolve, 0))
  })
  await render()
  assert.match(env.container.textContent, /org-a historic/)
  assert.doesNotMatch(env.container.textContent, /org-a brief/)
  params = new URLSearchParams('snapshot=foreign'); await render()
  assert.match(env.container.textContent, /checkpoint is unavailable/)
  assert.doesNotMatch(env.container.textContent, /org-a historic|org-a brief/)
  params = new URLSearchParams(); await render()
  assert.match(env.container.textContent, /org-a brief/)
  await click('Preserve core checkpoint')
  assert.equal(typeof resolveSave, 'function')
  organization = { ...organization, scopeRevision: 2 }; await render()
  assert.equal(typeof lateLoad, 'function')
  controller.abort()
  organization = { ...organization, activeOrganizationId: 'org-b', scopeRevision: 3, requestSignal: new AbortController().signal }
  await render()
  assert.match(env.container.textContent, /org-b brief/)
  assert.doesNotMatch(env.container.textContent, /org-a|Preserving/)
  await act(async () => { resolveSave({}); lateLoad(data('stale-a')) })
  assert.match(env.container.textContent, /org-b brief/)
  assert.doesNotMatch(env.container.textContent, /stale-a|checkpoint preserved/)
})