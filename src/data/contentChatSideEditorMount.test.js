import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { transformSync } from 'esbuild'
import { mountedEnvironment, elements } from './testSupport/designVideoDom.js'
import { contentArtifactChatTargets } from './contentArtifactChat.js'
const nativeRequire = createRequire(import.meta.url)
const props = node => node?.[Object.keys(node).find(key => key.startsWith('__reactProps$'))]
test('engagement side editor shares one canonical load, preserves dirty edits through refresh and checks close/denial', async t => {
  const env = mountedEnvironment(), previous = { document: globalThis.document, window: globalThis.window, confirm: globalThis.confirm, IS_REACT_ACT_ENVIRONMENT: globalThis.IS_REACT_ACT_ENVIRONMENT }
  let acceptDiscard = false
  Object.assign(globalThis, { document: env.document, window: env.window, confirm: () => acceptDiscard, IS_REACT_ACT_ENVIRONMENT: true })
  const organization = { activeOrganizationId: 'org', scopeRevision: 1, requestSignal: new AbortController().signal, handleOrganizationAccessError() {} }
  const engagement = { id: 'engagement', organization_id: 'org', project_id: 'project', brand_id: 'brand' }
  const workspace = { engagement, stages: [], versions: [], artifacts: [], contentServices: [{ id: 'service', organization_id: 'org', engagement_id: 'engagement', status: 'active', service_catalog: { department_id: 'content', is_active: true } }] }
  let loads = 0, mounts = 0, paneProps, departmentProps, denied = false
  const busy = []
  const studio = { load: async () => { loads++; if (denied) throw Object.assign(new Error('Access revoked'), { status: 403 }); return workspace } }
  const source = readFileSync(new URL('../components/ContentArtifactChat.jsx', import.meta.url), 'utf8').replace("lazy(() => import('./ContentChatWriterPane.jsx'))", "require('./ContentChatWriterPane.jsx').default")
  const compiled = transformSync(source, { loader: 'jsx', format: 'cjs', jsxFactory: 'React.createElement' }).code
  const module = { exports: {} }
  const require = name => {
    if (name.endsWith('.css')) return {}
    if (name.includes('OrganizationContext')) return { useOrganization: () => organization }
    if (name.includes('contentStudioRepository')) return { contentStudio: { forOrganization: () => studio } }
    if (name.includes('contentArtifactChat.js')) return { contentArtifactChatTargets }
    if (name === './DepartmentChat.jsx') return { __esModule: true, default: input => { departmentProps = input; return React.createElement('p', null, 'Existing engagement conversation') } }
    if (name === './ContentChatWriterPane.jsx') return { __esModule: true, default: function MockWriterPane(input) { paneProps = input; React.useEffect(() => { mounts++ }, []); return React.createElement('p', null, 'Existing canonical writer') } }
    return nativeRequire(name)
  }
  new Function('require', 'module', 'exports', 'React', compiled)(require, module, module.exports, React)
  const root = createRoot(env.container), Component = module.exports.default
  const render = () => act(async () => { root.render(React.createElement(Component, { engagement, projectId: 'project', sideEditor: true, onNavigationBusyChange: value => busy.push(value) })); await new Promise(resolve => setTimeout(resolve, 0)) })
  t.after(async () => { await act(async () => root.unmount()); Object.assign(globalThis, previous) })
  const button = title => elements(env.container, 'button').find(node => node.textContent === title)
  const click = node => act(async () => props(node).onClick())
  await render(); assert.equal(loads, 1)
  await click(button('Open Content writer beside chat'))
  assert.equal(paneProps.workspace, workspace); assert.equal(loads, 1); assert.equal(mounts, 1)
  await act(async () => paneProps.onStateChange({ dirty: true, saving: false }))
  assert.equal(busy.at(-1), true)
  await click(button('Close Content writer'))
  assert.match(env.container.textContent, /Existing canonical writer/)
  await act(async () => paneProps.refresh())
  assert.equal(loads, 2); assert.equal(mounts, 1)
  assert.equal(busy.at(-1), true)
  acceptDiscard = true; await click(button('Close Content writer'))
  assert.doesNotMatch(env.container.textContent, /Existing canonical writer/)
  assert.equal(busy.at(-1), false)
  await click(button('Open Content writer beside chat'))
  denied = true; await act(async () => paneProps.refresh())
  assert.doesNotMatch(env.container.textContent, /Existing canonical writer/)
  assert.equal(departmentProps.allowArtifactDraft, false)
  assert.equal(props(button('Close Content writer')).disabled, true)
})
