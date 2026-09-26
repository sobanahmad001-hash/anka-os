import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { transformSync } from 'esbuild'
import { mountedEnvironment } from './testSupport/n1bMountedDom.js'
import { buildProjectEngagementWorkspace } from './projectEngagementWorkspaceModel.js'
import * as navigation from './workshopNavigation.js'
const nativeRequire = createRequire(import.meta.url)
const nodes = node => [node, ...node.childNodes.flatMap(nodes)]
const propsOf = node => node[Object.keys(node).find(key => key.startsWith('__reactProps$'))]
const workspace = (org, id) => buildProjectEngagementWorkspace(Object.fromEntries([
  ['project', { id, organization_id: org, name: `${org}/${id}`, status: 'active', engagement_type: 'project' }],
  ...['memberships', 'profiles', 'workstreams', 'tasks', 'milestones', 'deliverables', 'deliverableVersions',
    'projectActivity', 'services', 'stages', 'stageDependencies', 'prerequisites', 'workItems', 'artifacts',
    'artifactVersions', 'artifactApprovals', 'engagementActivity'].map(key => [key, []]),
]))

test('mounted project defaults to Chat, preserves explicit tabs and rejects late cross-scope reads', async t => {
  const env = mountedEnvironment()
  const previous = { document: globalThis.document, window: globalThis.window, IS_REACT_ACT_ENVIRONMENT: globalThis.IS_REACT_ACT_ENVIRONMENT }
  Object.assign(globalThis, { document: env.document, window: env.window, IS_REACT_ACT_ENVIRONMENT: true })
  let organization = { activeOrganizationId: 'org-a', scopeRevision: 1, requestSignal: new AbortController().signal,
    activeMembership: { role: 'system_owner' }, handleOrganizationAccessError: () => false }
  let projectId = 'project-a', params = new URLSearchParams(), defer = false, resolveLate
  const repository = { get: async (id, org) => defer ? new Promise(resolve => { resolveLate = resolve }) : workspace(org, id) }
  const compiled = transformSync(readFileSync(new URL('../apps/ProjectEngagementWorkspace.jsx', import.meta.url), 'utf8'),
    { loader: 'jsx', format: 'cjs', jsxFactory: 'React.createElement' }).code
  const module = { exports: {} }
  const require = name => {
    if (name.includes('OrganizationContext')) return { useOrganization: () => organization }
    if (name.includes('projectEngagementWorkspace')) return { projectEngagementWorkspace: repository }
    if (name.includes('workshopNavigation')) return navigation
    if (name === 'react-router-dom') return { Link: props => React.createElement('a', { href: props.to }, props.children),
      useParams: () => ({ projectId }), useNavigate: () => () => {}, useSearchParams: () => [params, next => { params = next }] }
    if (name.startsWith('../components/') || name.startsWith('./')) return { __esModule: true,
      default: props => React.createElement('span', null, `${name}:${props.organizationId || ''}:${props.projectId || ''}:${props.contextKind || ''}`) }
    return nativeRequire(name)
  }
  new Function('require', 'module', 'exports', 'React', compiled)(require, module, module.exports, React)
  const root = createRoot(env.container), Component = module.exports.default
  t.after(async () => { await act(async () => root.unmount()); Object.assign(globalThis, previous) })
  const render = () => act(async () => { root.render(React.createElement(Component)); await new Promise(resolve => setTimeout(resolve, 0)) })
  const selected = () => propsOf(nodes(env.container).find(node => propsOf(node)?.role === 'tabpanel'))?.['aria-labelledby']
  await render()
  assert.equal(selected(), 'project-tab-discussion')
  assert.match(env.container.textContent, /ProjectDiscussionPanel.jsx:org-a:project-a/)
  assert.match(env.container.textContent, /ContextConversationPanel.jsx::project-a:project_team/)
  for (const [tab, primary] of [['overview', 'overview'], ['discussion', 'discussion'], ['work', 'work'],
    ['project-tasks', 'work'], ['engagement-work', 'work'], ['planning', 'work'], ['retainer-planning', 'work'],
    ['services', 'services'], ['journey', 'services'], ['outputs', 'outputs'], ['reviews', 'reviews'], ['activity', 'activity'],
    ['unknown', 'overview'], ['', 'overview']]) {
    params = new URLSearchParams({ tab }); await render()
    assert.equal(selected(), `project-tab-${primary}`, tab)
  }
  params = new URLSearchParams(); defer = true
  projectId = 'project-delayed'; await render()
  assert.equal(typeof resolveLate, 'function')
  defer = false
  organization = { ...organization, activeOrganizationId: 'org-b', scopeRevision: 2, requestSignal: new AbortController().signal }
  projectId = 'project-b'; await render()
  assert.match(env.container.textContent, /ProjectDiscussionPanel.jsx:org-b:project-b/)
  await act(async () => resolveLate(workspace('org-a', 'project-delayed')))
  assert.doesNotMatch(env.container.textContent, /project-delayed|org-a/)
  assert.equal(selected(), 'project-tab-discussion')
  const documentSource = readFileSync(new URL('../apps/LivingProjectReference.jsx', import.meta.url), 'utf8')
  assert.match(documentSource, /encodeURIComponent\(projectId\)\}\?tab=overview/)
})
