import test from 'node:test'
import assert from 'node:assert/strict'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { createServer } from 'vite'
import { mountedEnvironment } from './testSupport/n1bMountedDom.js'

const descendants = node => [node, ...node.childNodes.flatMap(descendants)]
const find = (environment, tag, text) => descendants(environment.container).find(node =>
  node.tagName === tag && (text === undefined || node.textContent.includes(text)))
const flush = () => act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) })
const change = (environment, element, value) => act(async () => {
  element.value = value
  element.dispatchEvent(new environment.window.Event('change'))
})
const click = (environment, element) => act(async () => element.dispatchEvent(new environment.window.Event('click')))
const data = (org, user = null, role = 'contributor') => ({
  schema_version: 1, compatibility_only: true, organization_id: org, actor_id: 'admin',
  members: [{ user_id: 'alice', organization_id: org, name: org + ' Alice', role, status: 'active' }],
  departments: [{ id: 'design', name: 'Design', organization_id: org }],
  projects: [{ id: 'project', name: 'Project One', organization_id: org }],
  token: user ? 'token' : null,
  snapshot: user ? { organization_id: org, user_id: user, status: 'active', legacy_role: role, legacy_department_id: 'design',
    department_memberships: [], contributor_designations: [], project_manager_bindings: [] } : null,
})

async function mount(t, client, props = {}) {
  const environment = mountedEnvironment()
  const values = { document: environment.document, window: environment.window, Event: environment.window.Event,
    Node: environment.window.Node, HTMLElement: environment.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true }
  const previous = Object.fromEntries(Object.keys(values).map(key => [key, globalThis[key]]))
  Object.assign(globalThis, values)
  const server = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent',
    plugins: [{ name: 'n1b-offline-client', enforce: 'pre',
      resolveId(source) { if (source.endsWith('/lib/supabase')) return '/n1b-offline-client' },
      load(id) { if (id === '/n1b-offline-client') return 'export const supabase = null' },
    }] })
  const { default: Panel } = await server.ssrLoadModule('/src/components/AuthorityCompatibilityAdmin.jsx')
  const root = createRoot(environment.container)
  t.after(async () => { await act(async () => root.unmount()); await server.close(); Object.assign(globalThis, previous) })
  const render = async overrides => {
    await act(async () => root.render(createElement(Panel, { key: overrides?.organizationId || 'org', organizationId: 'org',
      organizationName: 'Selected Org', client, ...props, ...overrides })))
    await flush()
  }
  await render()
  return { environment, render }
}

test('mounted panel separates compatibility from permissions and requires explicit submit', async t => {
  const calls = []
  const client = { rpc(name, args) {
    calls.push({ name, args })
    return Promise.resolve({ data: name === 'get_authority_administration' ? data(args.p_organization_id, args.p_user_id)
      : { schema_version: 1, compatibility_only: true, organization_id: args.p_organization_id, user_id: args.p_user_id, request_id: args.p_request_id } })
  } }
  const { environment } = await mount(t, client)
  assert.match(environment.container.textContent, /not effective permissions/)
  assert.match(environment.container.textContent, /does not revoke all legacy access/)
  await change(environment, find(environment, 'SELECT'), 'alice')
  await flush()
  const selects = descendants(environment.container).filter(node => node.tagName === 'SELECT')
  await change(environment, selects[2], 'executive')
  assert.equal(calls.filter(call => call.name === 'change_authority_compatibility').length, 0)
  await click(environment, find(environment, 'BUTTON', 'Save designation'))
  await flush()
  const mutation = calls.find(call => call.name === 'change_authority_compatibility')
  assert.equal(mutation.args.p_value, 'executive')
  assert.equal(mutation.args.p_expected_token, 'token')
  assert.ok(mutation.args.p_request_id)
  assert.match(environment.container.textContent, /Effective permissions and legacy access are unchanged/)
})

test('mounted panel disables contributor labels for legacy elevated executive', async t => {
  const client = { rpc(_name, args) { return Promise.resolve({ data: data(args.p_organization_id, args.p_user_id, 'executive') }) } }
  const { environment } = await mount(t, client)
  await change(environment, find(environment, 'SELECT'), 'alice')
  await flush()
  const options = descendants(environment.container).filter(node => node.tagName === 'OPTION')
  assert.equal(options.find(option => option.value === 'intern').disabled, true)
  assert.equal(options.find(option => option.value === 'executive').disabled, true)
  assert.match(environment.container.textContent, /Legacy role: executive/)
})

test('mounted panel ignores duplicate submits and reloads stale edits without retrying', async t => {
  let finish
  let writes = 0
  let reads = 0
  const client = { rpc(name, args) {
    if (name === 'get_authority_administration') { reads++; return Promise.resolve({ data: data(args.p_organization_id, args.p_user_id) }) }
    writes++
    return new Promise(resolve => { finish = resolve })
  } }
  const { environment } = await mount(t, client)
  await change(environment, find(environment, 'SELECT'), 'alice')
  await flush()
  const save = find(environment, 'BUTTON', 'Save designation')
  await act(async () => {
    save.dispatchEvent(new environment.window.Event('click'))
    save.dispatchEvent(new environment.window.Event('click'))
  })
  assert.equal(writes, 1)
  assert.equal(find(environment, 'SELECT').disabled, true)
  await act(async () => finish({ error: { code: '40001', message: 'stale' } }))
  await flush()
  assert.equal(writes, 1)
  assert.equal(reads, 3)
  assert.match(environment.container.textContent, /Another edit changed these records/)
})

test('mounted organization switch discards delayed old-organization data', async t => {
  let oldRead
  const client = { rpc(_name, args) {
    if (args.p_organization_id === 'org') return new Promise(resolve => { oldRead = resolve })
    return Promise.resolve({ data: data(args.p_organization_id, args.p_user_id) })
  } }
  const { environment, render } = await mount(t, client)
  await render({ organizationId: 'new-org', organizationName: 'New Organization' })
  assert.match(environment.container.textContent, /new-org Alice/)
  await act(async () => oldRead({ data: data('org') }))
  await flush()
  assert.match(environment.container.textContent, /new-org Alice/)
  assert.doesNotMatch(environment.container.textContent, /Selected Org/)
})

test('mounted missing migration shows an error and no writable snapshot', async t => {
  const { environment } = await mount(t, { rpc() { return Promise.resolve({ error: { code: 'PGRST202', message: 'Compatibility migration is not installed' } }) } })
  assert.match(environment.container.textContent, /migration is not installed/)
  assert.equal(find(environment, 'BUTTON', 'Save designation'), undefined)
  assert.ok(find(environment, 'BUTTON', 'Reload'))
})
