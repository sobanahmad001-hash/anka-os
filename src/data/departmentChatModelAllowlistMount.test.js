import assert from 'node:assert/strict'
import test from 'node:test'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { createServer } from 'vite'
import { mountedEnvironment } from './testSupport/n1bMountedDom.js'

const connection = { id: 'connection-1', provider: 'openai', display_name: 'Organization OpenAI',
  organization_level: true, status: 'pending', verified_model_ids: [], model_configurations: [],
  context_model_configurations: [], department_ids: [] }
const descendants = node => [node, ...node.childNodes.flatMap(descendants)]
const find = (root, tag, text) => descendants(root).find(node => node.tagName === tag && node.textContent.includes(text))

test('organization connector can be verified before model approval, without bypassing other gates', async t => {
  const environment = mountedEnvironment()
  const values = { document: environment.document, window: environment.window,
    Event: environment.window.Event, Node: environment.window.Node,
    HTMLElement: environment.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true }
  const previous = Object.fromEntries(Object.keys(values).map(key => [key, globalThis[key]]))
  Object.assign(globalThis, values)
  const calls = []
  let finishVerification
  globalThis.__chatModelAllowlistTest = {
    testForOrganization: (...args) => { calls.push(['verify', ...args]); return new Promise(resolve => { finishVerification = resolve }) },
    configureContextOrganizationModels: (...args) => { calls.push(['approve', ...args]); return Promise.resolve() },
    configureModelAllowlist: (...args) => { calls.push(['workshop', ...args]); return Promise.resolve() },
  }
  const vite = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent',
    plugins: [{ name: 'offline-chat-model-allowlist', enforce: 'pre',
      resolveId(source) { if (source.endsWith('integrationRepository.js')) return '\0offline-chat-model-allowlist' },
      load(id) { if (id === '\0offline-chat-model-allowlist') return 'export const integrations = new Proxy({}, { get(_target, key) { return (...args) => globalThis.__chatModelAllowlistTest[key](...args) } })' },
    }] })
  const { default: Panel } = await vite.ssrLoadModule('/src/components/DepartmentChatModelAllowlist.jsx')
  const root = createRoot(environment.container)
  t.after(async () => { await act(async () => root.unmount()); await vite.close(); Object.assign(globalThis, previous); delete globalThis.__chatModelAllowlistTest })
  const render = async (row, canManage) => act(async () => root.render(createElement(Panel,
    { organizationId: 'org-1', connections: [row], canManage, onSaved: () => {}, requestSignal: undefined })))

  await render(connection, false)
  assert.equal(find(environment.container, 'FIELDSET', 'Private organization conversations').disabled, true)
  assert.equal(find(environment.container, 'BUTTON', 'Verify connection'), undefined)

  await render(connection, true)
  const verify = find(environment.container, 'BUTTON', 'Verify connection')
  assert.ok(verify)
  assert.equal(find(environment.container, 'FIELDSET', 'Private organization conversations').disabled, false)
  assert.equal(verify.disabled, false)
  assert.equal(find(environment.container, 'BUTTON', 'Save private model access').disabled, true)
  assert.equal(find(environment.container, 'BUTTON', 'Save model access').disabled, true)
  await act(async () => verify.dispatchEvent(new environment.window.Event('click')))
  assert.equal(calls.length, 1)
  assert.equal(calls[0][0], 'verify')
  assert.equal(find(environment.container, 'BUTTON', 'Verifying…').disabled, true)
  assert.equal(find(environment.container, 'BUTTON', 'Save private model access').disabled, true)
  await act(async () => finishVerification())

  await render({ ...connection, status: 'verified', verified_model_ids: ['verified-model'] }, true)
  assert.equal(find(environment.container, 'BUTTON', 'Save private model access').disabled, false)
  assert.equal(find(environment.container, 'BUTTON', 'Verify connection'), undefined)
  assert.equal(calls.filter(call => call[0] !== 'verify').length, 0)
})
