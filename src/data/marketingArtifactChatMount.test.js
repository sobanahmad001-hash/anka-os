import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { transformSync } from 'esbuild'
import { mountedEnvironment } from './testSupport/n1bMountedDom.js'
import { marketingArtifactChatTargets, MARKETING_CHAT_ARTIFACT_TYPES } from './marketingArtifactChat.js'
const nativeRequire = createRequire(import.meta.url)
const data = (org, project, id) => ({ engagement: { id, organization_id: org, project_id: project, brand_id: 'brand' },
  marketingServices: [{ id: 'service', organization_id: org, engagement_id: id, status: 'active', service_catalog: { department_id: 'marketing', is_active: true } }], artifacts: [], stages: [], versions: [] })
test('mounted Marketing adapter retains conversation callbacks and disables drafting for loading, denied, late and aborted reads', async t => {
  const env = mountedEnvironment(), previous = { document: globalThis.document, window: globalThis.window, IS_REACT_ACT_ENVIRONMENT: globalThis.IS_REACT_ACT_ENVIRONMENT }
  Object.assign(globalThis, { document: env.document, window: env.window, IS_REACT_ACT_ENVIRONMENT: true })
  let org = { activeOrganizationId: 'org', scopeRevision: 1, requestSignal: new AbortController().signal, handleOrganizationAccessError: () => {} }
  const resolves = new Map(), loads = []
  const repository = { forOrganization: (organizationId, options) => ({ load: id => { loads.push([organizationId, id, options.signal]); return new Promise((resolve, reject) => resolves.set(id, { resolve, reject })) } }) }
  let chatProps
  const compiled = transformSync(readFileSync(new URL('../components/MarketingArtifactChat.jsx', import.meta.url), 'utf8'), { loader: 'jsx', format: 'cjs', jsxFactory: 'React.createElement' }).code
  const module = { exports: {} }, require = name => {
    if (name.includes('OrganizationContext')) return { useOrganization: () => org }
    if (name.includes('lib/supabase')) return { supabase: {} }
    if (name.includes('marketingArtifactChat')) return { marketingArtifactChatTargets, MARKETING_CHAT_ARTIFACT_TYPES, loadMarketingArtifactChatWorkspace: (_client, organizationId, id, options) => repository.forOrganization(organizationId, options).load(id) }
    if (name.includes('DepartmentChat')) return { __esModule: true, default: props => { chatProps = props; return React.createElement('p', null, 'Ordinary chat') } }
    return nativeRequire(name)
  }
  new Function('require', 'module', 'exports', 'React', compiled)(require, module, module.exports, React)
  const callbacks = { onConversationListChange: () => {}, onNavigationBusyChange: () => {} }, initialConversation = { id: 'conversation' }
  let props = { projectId: 'project', engagement: data('org', 'project', 'first').engagement, hideConversationList: true, initialConversation, ...callbacks }
  const root = createRoot(env.container), Component = module.exports.default
  t.after(async () => { await act(async () => root.unmount()); Object.assign(globalThis, previous) })
  const render = () => act(async () => root.render(React.createElement(Component, props)))
  await render(); assert.equal(chatProps.allowArtifactDraft, false); assert.match(env.container.textContent, /Ordinary chat/)
  assert.equal(chatProps.initialConversation, initialConversation); assert.equal(chatProps.hideConversationList, true)
  assert.equal(chatProps.onConversationListChange, callbacks.onConversationListChange); assert.equal(chatProps.onNavigationBusyChange, callbacks.onNavigationBusyChange)
  await act(async () => resolves.get('first').resolve(data('org', 'project', 'first')))
  assert.equal(chatProps.allowArtifactDraft, true); assert.deepEqual(chatProps.allowedArtifactTypes, MARKETING_CHAT_ARTIFACT_TYPES)
  await act(async () => { chatProps.onCreated() }); assert.equal(chatProps.allowArtifactDraft, false)
  const stale = resolves.get('first')
  const nextController = new AbortController()
  org = { ...org, activeOrganizationId: 'org-b', scopeRevision: 2, requestSignal: nextController.signal }
  props = { ...props, projectId: 'project-b', engagement: data('org-b', 'project-b', 'second').engagement }; await render()
  await act(async () => stale.resolve(data('org', 'project', 'first'))); assert.equal(chatProps.allowArtifactDraft, false)
  await act(async () => resolves.get('second').reject(new Error('Denied')))
  assert.equal(chatProps.allowArtifactDraft, false); assert.match(env.container.textContent, /unavailable/)
  props = { ...props, engagement: data('org-b', 'project-b', 'third').engagement }; await render()
  await act(async () => { nextController.abort(); resolves.get('third').resolve(data('org-b', 'project-b', 'third')) })
  assert.equal(chatProps.allowArtifactDraft, false)
  const readyController = new AbortController()
  org = { ...org, scopeRevision: 3, requestSignal: readyController.signal }
  props = { ...props, engagement: data('org-b', 'project-b', 'fourth').engagement }; await render()
  await act(async () => resolves.get('fourth').resolve(data('org-b', 'project-b', 'fourth')))
  assert.equal(chatProps.allowArtifactDraft, true); assert.deepEqual(chatProps.allowedArtifactTypes, MARKETING_CHAT_ARTIFACT_TYPES)
  await act(async () => readyController.abort()); assert.equal(chatProps.allowArtifactDraft, false)
  assert.deepEqual(loads.map(row => row.slice(0, 2)), [['org', 'first'], ['org', 'first'], ['org-b', 'second'], ['org-b', 'third'], ['org-b', 'fourth']])
})
