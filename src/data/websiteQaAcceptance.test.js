import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {createRequire} from 'node:module'
import React, {act} from 'react'
import {createRoot} from 'react-dom/client'
import {transformSync} from 'esbuild'
import {mountedEnvironment, elements} from './testSupport/designVideoDom.js'
import {WEBSITE_QA_EVIDENCE, completeQaEvidence, qaAcceptanceKey} from './websiteQaAcceptance.js'
import {createWebsiteStagingRepository} from './websiteStagingRepository.js'

const id = n => 'e0000000-0000-4000-8000-' + String(n).padStart(12, '0')
const scope = {organizationId: id(1), projectId: id(2), engagementId: id(3), actorId: id(4)}
const row = {organization_id: id(1), project_id: id(2), engagement_id: id(3)}
const manual = Object.fromEntries(WEBSITE_QA_EVIDENCE.map(([key]) => [key, 'Manually checked against this exact preview.']))
const context = () => ({snapshot: {...row, run_id: id(5), artifact_id: null, artifact_version_id: null, page_id: id(6), package_sha256: 'b'.repeat(64), publication_authorized: false}, review_sha256: 'a'.repeat(64), artifacts: [], records: []})
const receipt = requestId => ({...row, id: id(7), run_id: id(5), created_by: id(4), artifact_version_id: id(8), request_id: requestId})

test('QA evidence and private recovery identities are bounded and actor-scoped', () => {
  assert.equal(completeQaEvidence(manual), true)
  for (const value of [null, [], {...manual, keyboard: 'short'}, {...manual, security: 'x'.repeat(1001)}, {...manual, other: 'extra'}]) assert.equal(Boolean(completeQaEvidence(value)), false)
  assert.notEqual(qaAcceptanceKey(scope), qaAcceptanceKey({...scope, actorId: id(20)}))
})
test('QA RPC repository pins original request context and actor, without an Edge or WordPress call', async () => {
  const calls = []
  const repo = createWebsiteStagingRepository({rpc: async (name, args) => {calls.push({name, args}); return {data: name === 'get_website_qa_review' ? context() : receipt(args.p_request_id), error: null}}})
  await repo.qaReview(scope, id(5), null)
  const input = {runId: id(5), artifactId: null, expectedVersionId: null, reviewSha256: 'a'.repeat(64), evidence: manual, confirmed: true, requestId: id(9)}
  assert.equal((await repo.qaSave(scope, input)).request_id, id(9))
  assert.equal((await repo.qaRecover(scope, id(9))).request_id, id(9))
  assert.deepEqual(calls.map(call => call.name), ['get_website_qa_review', 'save_website_qa_acceptance', 'get_website_qa_record'])
  assert.equal(calls[1].args.p_expected_version_id, null)
  assert.equal('p_actor_id' in calls[1].args, false)
})
test('QA repository rejects foreign saves and aborted contexts', async () => {
  let count = 0
  const repo = createWebsiteStagingRepository({rpc: async () => {count++; return {data: {...receipt(id(9)), project_id: id(90)}}}})
  await assert.rejects(repo.qaRecover(scope, id(9)), /another context/)
  const signal = new AbortController(); signal.abort()
  await assert.rejects(repo.qaReview(scope, id(5), null, {signal: signal.signal}), /context changed/)
  assert.equal(count, 1)
})

async function mount(t, options = {}) {
  const env = mountedEnvironment(), names = ['window', 'document', 'sessionStorage', 'IS_REACT_ACT_ENVIRONMENT'], old = Object.fromEntries(names.map(name => [name, globalThis[name]]))
  const storage = options.storage || new Map()
  Object.assign(globalThis, {window: env.window, document: env.document, IS_REACT_ACT_ENVIRONMENT: true, sessionStorage: {getItem: key => storage.get(key) || null, setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key)}})
  const native = createRequire(import.meta.url), module = {exports: {}}, code = transformSync(readFileSync(new URL('../components/WebsiteQaAcceptancePanel.jsx', import.meta.url), 'utf8'), {loader: 'jsx', format: 'cjs', jsxFactory: 'React.createElement'}).code
  new Function('require', 'module', 'exports', 'React', code)(native, module, module.exports, React)
  const state = {review: context(), lost: false, absent: false, rollback: false, record: null}, calls = []
  const repository = {qaReview: async () => {calls.push('review'); return structuredClone(state.review)}, qaSave: async (_scope, input) => {calls.push('save'); if (state.rollback) throw Object.assign(Error('QA input changed'), {knownRollback: true}); state.record = receipt(input.requestId); if (state.lost) throw Error('Synthetic response lost'); return state.record}, qaRecover: async () => {calls.push('recover'); return state.absent ? null : state.record}}
  const root = createRoot(env.container), controller = new AbortController(), Component = module.exports.default, locks = []
  let propsValue = {scope, runId: id(5), repository, canRecord: true, disabled: false, signal: controller.signal, onLockChange: value => locks.push(value), ...options.props}
  const render = async changes => {propsValue = {...propsValue, ...changes}; await act(async () => root.render(React.createElement(Component, propsValue)))}
  await render({})
  t.after(async () => {await act(async () => root.unmount()); Object.assign(globalThis, old)})
  const props = node => node?.[Object.keys(node).find(key => key.startsWith('__reactProps$'))], button = name => elements(env.container, 'button').find(node => node.textContent === name)
  const click = name => act(async () => props(button(name)).onClick())
  const fill = async () => {
    await click('Review exact QA acceptance inputs')
    for (const [, label] of WEBSITE_QA_EVIDENCE) await act(async () => props(elements(env.container, 'textarea').find(node => props(node)['aria-label'] === label)).onChange({target: {value: 'Checked this exact staged page manually.'}}))
  }
  const confirm = () => act(async () => props(elements(env.container, 'input')[0]).onChange({target: {checked: true}}))
  return {env, state, calls, storage, locks, render, controller, props, button, click, fill, confirm}
}
test('manual QA save requires explicit unchecked confirmation and all seven evidence notes', async t => {
  const ui = await mount(t); await ui.fill()
  assert.equal(ui.props(ui.button('Record reviewed QA acceptance')).disabled, true)
  await ui.click('Record reviewed QA acceptance'); assert.equal(ui.calls.includes('save'), false)
  await ui.confirm(); await ui.click('Record reviewed QA acceptance')
  assert.equal(ui.calls.filter(call => call === 'save').length, 1)
  assert.match(ui.env.container.textContent, /immutable Development launch-checklist version/)
  assert.equal(ui.storage.has(qaAcceptanceKey(scope)), false)
})
test('lost response preserves original request and read-only recovery never saves again', async t => {
  const ui = await mount(t); await ui.fill(); await ui.confirm(); ui.state.lost = true
  await ui.click('Record reviewed QA acceptance')
  const original = JSON.parse(ui.storage.get(qaAcceptanceKey(scope)))
  assert.equal(original.runId, id(5)); assert.ok(ui.locks.at(-1))
  await ui.click('Recover original QA save')
  assert.deepEqual(ui.calls, ['review', 'save', 'recover'])
  assert.equal(ui.storage.has(qaAcceptanceKey(scope)), false)
})
test('missing recovery receipt remains uncertain and cannot unlock new writes', async t => {
  const ui = await mount(t); await ui.fill(); await ui.confirm(); ui.state.lost = true; ui.state.absent = true
  await ui.click('Record reviewed QA acceptance'); await ui.click('Recover original QA save')
  assert.ok(ui.storage.has(qaAcceptanceKey(scope)))
  assert.match(ui.env.container.textContent, /no save was resent/)
  assert.equal(ui.button('Record reviewed QA acceptance'), undefined)
})
test('retained save handler cannot acquire revoked authority or cross aborted context', async t => {
  const ui = await mount(t); await ui.fill(); await ui.confirm()
  const retained = ui.props(ui.button('Record reviewed QA acceptance')).onClick
  await ui.render({canRecord: false}); await act(async () => retained())
  assert.equal(ui.calls.includes('save'), false)
  await ui.render({canRecord: true}); ui.controller.abort(); await act(async () => retained())
  assert.equal(ui.calls.includes('save'), false)
})
test('changed reviewed snapshot retains old notes and prevents acceptance until explicit discard', async t => {
  const ui = await mount(t); await ui.fill(); ui.state.review.review_sha256 = 'c'.repeat(64)
  await ui.click('Review exact QA acceptance inputs')
  assert.match(ui.env.container.textContent, /Preserve or discard the old QA notes/)
  assert.equal(ui.button('Record reviewed QA acceptance'), undefined)
  assert.ok([...ui.storage.keys()].some(key => key.endsWith(':draft')))
  await ui.click('Discard unsaved QA notes'); await ui.click('Review exact QA acceptance inputs')
  assert.equal(ui.props(ui.button('Record reviewed QA acceptance')).disabled, true)
})
test('known database rollback releases original request and retains scoped draft evidence', async t => {
  const ui = await mount(t); await ui.fill(); await ui.confirm(); ui.state.rollback = true
  await ui.click('Record reviewed QA acceptance')
  assert.equal(ui.storage.has(qaAcceptanceKey(scope)), false)
  assert.ok([...ui.storage.keys()].some(key => key.endsWith(':draft')))
  assert.match(ui.env.container.textContent, /QA input changed/)
})
test('restored pending request remains recoverable after write authority is lost without redispatch', async t => {
  const storage = new Map([[qaAcceptanceKey(scope), JSON.stringify({requestId: id(99), runId: id(5)})]])
  const ui = await mount(t, {storage, props: {canRecord: false}})
  ui.state.record = receipt(id(99))
  assert.deepEqual(ui.calls, [])
  await ui.click('Recover original QA save')
  assert.deepEqual(ui.calls, ['recover'])
  assert.equal(storage.has(qaAcceptanceKey(scope)), false)
})
test('a mismatched recovery receipt retains the original pending save and never creates another version', async t => {
  const ui = await mount(t); await ui.fill(); await ui.confirm(); ui.state.lost = true
  await ui.click('Record reviewed QA acceptance'); ui.state.record.run_id = id(90)
  await ui.click('Recover original QA save')
  assert.ok(ui.storage.has(qaAcceptanceKey(scope)))
  assert.match(ui.env.container.textContent, /another page preview/)
  assert.equal(ui.calls.filter(call => call === 'save').length, 1)
})
test('saved acceptance survives a later Development history refresh failure', async t => {
  const ui = await mount(t, {props: {onSaved: async () => {throw Error('Synthetic read failed')}}})
  await ui.fill(); await ui.confirm(); await ui.click('Record reviewed QA acceptance')
  assert.equal(ui.storage.has(qaAcceptanceKey(scope)), false)
  assert.match(ui.env.container.textContent, /QA acceptance is saved/)
  assert.equal(ui.calls.filter(call => call === 'save').length, 1)
})
