import test from 'node:test'
import assert from 'node:assert/strict'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { createServer } from 'vite'
import { mountedEnvironment } from './testSupport/n1bMountedDom.js'
import { createDirectChatFixture, createProjectNavigationPreviewFixture, actor, organizationId, allowlist } from '../../tools/direct-chat-fixture.js'
import { directChatRecoveryKey } from './directChatRecovery.js'
const ownerParagraph = 'Owner-edited exact positioning wording. '.repeat(10).slice(0, 375)
const id = n => `ee000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const descendants = n => [n, ...n.childNodes.flatMap(descendants)]
const props = n => n?.[Object.keys(n).find(k => k.startsWith('__reactProps$'))]
const tick = () => act(async () => { await new Promise(r => setTimeout(r, 10)) })
async function until(fn) { for (let i = 0; i < 120; i++) { if (fn()) return; await tick() } assert.ok(fn(), 'mounted state available') }
async function mount(t, pendingChat = false, ownerWording = false) {
  const env = mountedEnvironment(), storage = new Map(), signal = new AbortController().signal
  const values = { requestAnimationFrame:fn=>fn(), document: env.document, window: env.window, Event: env.window.Event, Node: env.window.Node, HTMLElement: env.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true, sessionStorage: { getItem: k => storage.get(k) || null, setItem: (k, v) => storage.set(k, v), removeItem: k => storage.delete(k) } }
  const previous = Object.fromEntries(Object.keys(values).map(k => [k, globalThis[k]])); Object.assign(globalThis, values)
  const fixture = createDirectChatFixture({ surface: 'project', state: 'populated' }), workspace = createProjectNavigationPreviewFixture(fixture.scope.project_id).workspace, conversation = fixture.data.rows[0]
  const source = fixture.data.messages.find(m => m.role === 'assistant'); source.body = 'UNSELECTED_PREFIX\nExact saved positioning wording.\nUNSELECTED_TAIL'
  const approval = { id: id(8), conversation_id: conversation.id, author_id: actor, role: 'user', status: 'completed', sequence: 3, body: ownerWording ? `${'Synthetic owner introduction 📝'.padEnd(76, '.')}\n\n${ownerParagraph}\n\nOWNER_TAIL` : 'OWNER_APPROVAL_TEXT_LOCAL_ONLY', client_request_id: id(18) }; fixture.data.messages.push(approval)
  const state = { binding: id(6), saved: null, wording: '', unknown: false, missing: false }, calls = [], sent = []
  const append = fixture.chat.appendContextHumanMessage; fixture.chat.appendContextHumanMessage = async input => { sent.push(structuredClone(input)); return append(input) }
  const base = { organization_id: organizationId, project_id: workspace.project.id, engagement_id: workspace.engagement.id, actor_id: actor }
  if (pendingChat) storage.set(directChatRecoveryKey(actor, organizationId, 'project_team', workspace.project.id), JSON.stringify({ conversation_id: conversation.id, client_request_id: id(19) }))
  globalThis.__positioningUi = { fixture, allowlist, rpc: async (name, args) => {
    calls.push({ name, args })
    if(name==='read_project_stage_plan')return {data:{...base,state:'unconfigured',groups:[],bindings:[],can_manage:true}}
    if (name === 'read_project_positioning_output') return { data: { ...base, binding_id: state.binding, current: state.saved, selected: args.p_version_id && state.saved ? { ...state.saved, wording: state.wording } : null } }
    if (name === 'save_project_positioning_output') { state.saved = { version_id: args.p_request_id, version_number: 1, wording_sha256: 'a'.repeat(64), binding_id: state.binding, conversation_id: conversation.id }; state.wording = args.p_wording; if (state.unknown) throw Error('Synthetic response loss'); return { data: state.saved } }
    if (name === 'recover_project_positioning_output') return { data: state.missing ? null : state.saved }
    throw Error('Unexpected synthetic RPC ' + name)
  } }
  const vite = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent', plugins: [{ name: 'positioning-output-mounted', enforce: 'pre', resolveId(source) {
    for (const [suffix, name] of [['WorkspaceDialog.jsx', 'dialog'], ['ProjectSetupPanel.jsx', 'empty'], ['ProjectContentJourney.jsx', 'empty'], ['ProjectWebsiteExecution.jsx', 'empty'], ['ProjectChatContentActions.jsx', 'empty'], ['ProjectChatDesignActions.jsx', 'empty'], ['ProjectChatAllowance.jsx', 'empty'], ['/lib/supabase.js', 'client'], ['departmentChatRepository.js', 'chat'], ['contextChatRunnerRepository.js', 'runner'], ['integrationRepository.js', 'models']]) if (source.endsWith(suffix)) return '\0positioning-' + name
  }, load(name) {
    if (name === '\0positioning-dialog') return "import {createElement} from 'react';export default function Dialog({children}){return createElement('section',null,children)}"
    if (name === '\0positioning-empty') return 'export default function Empty(){return null}'
    if (name === '\0positioning-client') return 'export const supabase={rpc:(...a)=>{const p=globalThis.__positioningUi.rpc(...a);p.abortSignal=()=>p;return p},functions:{invoke(){throw Error("Unexpected external action")}}}'
    if (name === '\0positioning-chat') return 'export const departmentChat=new Proxy({},{get:(_,k)=>(...a)=>globalThis.__positioningUi.fixture.chat[k](...a)})'
    if (name === '\0positioning-runner') return 'export const contextChatRunner=new Proxy({},{get:(_,k)=>(...a)=>globalThis.__positioningUi.fixture.runner[k](...a)})'
    if (name === '\0positioning-models') return 'export const integrations={listModelAllowlist:async()=>globalThis.__positioningUi.allowlist}'
  } }] })
  const { default: Chat } = await vite.ssrLoadModule('/src/components/DirectContextChat.jsx'), root = createRoot(env.container), consumed = []
  const all = () => descendants(env.container), named = name => all().find(n => props(n)?.['aria-label'] === name), button = name => all().find(n => n.tagName === 'BUTTON' && (props(n)?.['aria-label'] || n.textContent) === name)
  const click = async name => { assert.ok(button(name), name); await act(async () => props(button(name)).onClick?.({ preventDefault() {} })); await tick() }
  const render = async selection => { await act(async () => root.render(createElement(Chat, { systemOwner: true, contextKind: 'project_team', projectId: workspace.project.id, label: 'Project Chat', organizationId, user: { id: actor }, signal, initialConversation: conversation, projectJourney: workspace, productStructureSelection: selection, onProductStructureSelectionConsumed: id => consumed.push(id) }))); await tick() }
  t.after(async () => { await act(async () => root.unmount()); await vite.close(); Object.assign(globalThis, previous); delete globalThis.__positioningUi })
  await render(); await until(() => named('Message'))
  async function reviewSelection() {
    await click('Review positioning wording from message 2'); await until(() => named('Saved positioning source message'))
    const start = source.body.indexOf('Exact'), end = source.body.indexOf('\nUNSELECTED_TAIL')
    await act(async () => props(named('Saved positioning source message')).onSelect({ target: { selectionStart: start, selectionEnd: end } }))
    await act(async () => props(named('Owner approval message')).onChange({ target: { value: approval.id } }))
  }
  const remount = async () => { await act(async()=>root.render(null)); await render(); await until(()=>named('Message')) }
  return { all, env, fixture, workspace, conversation, source, approval, state, calls, sent, consumed, named, button, click, render, remount, reviewSelection }
}
test('real saved-message selection and separate attestation save exact version, then disclose stage three without auto Send', async t => {
  const m = await mount(t); await until(() => !m.named('Message').disabled)
  await act(async () => props(m.named('Message')).onChange({ target: { value: 'Preserve my current draft' } }))
  await m.reviewSelection()
  assert.equal(m.button('Save reviewed positioning version').disabled, true)
  assert.equal(m.calls.filter(c => c.name.startsWith('save_')).length, 0)
  await act(async()=>props(m.named('Chat composer')).onSubmit({preventDefault(){}}));assert.equal(m.sent.length,0)
  await act(async () => props(m.named('Attest chosen wording and owner approval')).onChange({ target: { checked: true } }))
  await m.click('Save reviewed positioning version'); await until(() => m.button('Review product and service continuation'))
  const save = m.calls.find(c => c.name === 'save_project_positioning_output')
  assert.equal(save.args.p_wording, 'Exact saved positioning wording.'); assert.equal(save.args.p_approval_message_id, m.approval.id); assert.equal(save.args.p_source_message_id, m.source.id); assert.equal(save.args.p_attested, true)
  assert.equal(JSON.stringify(save).includes('OWNER_APPROVAL_TEXT_LOCAL_ONLY'), false)
  assert.equal(m.named('Message').value, 'Preserve my current draft'); assert.equal(m.sent.length, 0)
  await m.click('Open pipeline and work details');await until(()=>m.button('Go to Brand positioning & statement'))
  const start=m.calls.length
  await m.click('Go to Brand positioning & statement')
  await until(()=>m.env.container.textContent.includes('Saved version 1 · '+save.args.p_request_id))
  const stage=m.all().find(n=>n.tagName==='BUTTON'&&n.textContent.includes('Product')&&n.textContent.includes('structure'))
  await act(async()=>props(stage).onClick())
  await until(()=>m.button('Continue with this version in private Chat'))
  const metadata=m.calls.slice(start).filter(c=>c.name==='read_project_positioning_output')
  assert.ok(metadata.length>=2)
  assert.ok(metadata.every(c=>c.args.p_version_id===null&&c.args.p_conversation_id===null))
  await m.click('Continue with this version in private Chat')
  await until(()=>m.named('Disclose exact positioning version'))
  assert.ok(m.calls.slice(start).some(c=>c.args.p_version_id===save.args.p_request_id&&c.args.p_conversation_id===m.conversation.id))
  assert.equal(m.button('Add product and service continuation to message').disabled, true)
  await act(async () => props(m.named('Disclose exact positioning version')).onChange({ target: { checked: true } }))
  await m.click('Add product and service continuation to message')
  const draft = m.named('Message').value
  assert.ok(draft.startsWith('Preserve my current draft\n\nContinue with product and service structure'))
  assert.doesNotMatch(draft, /UNSELECTED_|OWNER_APPROVAL_TEXT/); assert.equal(m.fixture.data.counters.run, 0)
  m.state.binding = id(99)
  await act(async () => props(m.named('Chat composer')).onSubmit({ preventDefault() {} })); await tick()
  assert.equal(m.sent.length, 0); assert.equal(m.named('Message').value, draft)
  m.state.binding = id(6)
  await act(async () => props(m.named('Chat composer')).onSubmit({ preventDefault() {} })); await until(() => m.sent.length === 1)
  assert.equal(m.sent[0].message, draft); assert.equal(Object.hasOwn(m.sent[0], 'project_stage_context'), false)
})
test('uncertain positioning save checks original UUID and never resaves after missing recovery', async t => {
  const m = await mount(t); await until(() => !m.named('Message').disabled); m.state.unknown = true
  await m.reviewSelection(); await act(async () => props(m.named('Attest chosen wording and owner approval')).onChange({ target: { checked: true } }))
  await m.click('Save reviewed positioning version'); await until(() => m.button('Check original positioning save'))
  const original = m.calls.find(c => c.name === 'save_project_positioning_output').args.p_request_id
  await m.remount();await until(()=>m.button('Check original positioning save'))
  m.state.missing = true; await m.click('Check original positioning save')
  assert.ok(m.env.container.textContent.includes('Do not resend'))
  m.state.missing = false; await m.click('Check original positioning save'); await until(() => m.button('Review product and service continuation'))
  assert.equal(m.calls.filter(c => c.name === 'save_project_positioning_output').length, 1)
  assert.ok(m.calls.filter(c => c.name === 'recover_project_positioning_output').every(c => c.args.p_request_id === original)); assert.equal(m.sent.length, 0)
})
test('external continuation cannot disclose into a foreign originating conversation or bypass pending Chat recovery', async t => {
  const m = await mount(t, true)
  const output = { version_id: id(9), version_number: 1, wording_sha256: 'a'.repeat(64), binding_id: id(6), conversation_id: m.conversation.id }
  await m.render({ selectionId: 'pending-entry', actorId: actor, organizationId, projectId: m.workspace.project.id, engagementId: m.workspace.engagement.id, output })
  await until(() => m.consumed.length === 1)
  assert.equal(m.named('Disclose exact positioning version'), undefined); assert.equal(m.sent.length, 0)
  assert.equal(m.calls.filter(c => c.name === 'read_project_positioning_output').length, 0)
})
test('external continuation refuses another conversation and drops unfinished disclosure on navigation', async t => {
  const m=await mount(t);await until(()=>!m.named('Message').disabled)
  const output={version_id:id(9),version_number:1,wording_sha256:'a'.repeat(64),binding_id:id(6),conversation_id:m.conversation.id}
  m.state.saved=output;m.state.wording='Exact saved positioning wording.'
  const entry={selectionId:'wrong-conversation',actorId:actor,organizationId,projectId:m.workspace.project.id,engagementId:m.workspace.engagement.id,output:{...output,conversation_id:id(99)}}
  await m.render(entry);await until(()=>m.consumed.length===1)
  assert.equal(m.named('Disclose exact positioning version'),undefined);assert.equal(m.calls.length,0)
  await m.render({...entry,selectionId:'original-conversation',output});await until(()=>m.named('Disclose exact positioning version'))
  await m.click('New chat');await until(()=>!m.named('Disclose exact positioning version'))
  assert.equal(m.sent.length,0);assert.equal(m.fixture.data.counters.run,0)
})
test('owner-authored edited wording uses the same saved owner message via separate source and approval choices', async t => {
  const m=await mount(t,false,true);await until(()=>!m.named('Message').disabled)
  await m.click('Review positioning wording from message 3');await until(()=>m.named('Saved positioning source message'))
  const start = 78, end = 453
  assert.equal(Object.hasOwn(m.approval, 'organization_id'), false)
  assert.equal(m.approval.body.slice(start, end), ownerParagraph)
  await act(async()=>props(m.named('Saved positioning source message')).onSelect({target:{selectionStart:start,selectionEnd:end}}))
  assert.equal(m.named('Owner approval message').value,'')
  await act(async()=>props(m.named('Owner approval message')).onChange({target:{value:m.approval.id}}))
  assert.equal(m.button('Save reviewed positioning version').disabled,true)
  await act(async()=>props(m.named('Attest chosen wording and owner approval')).onChange({target:{checked:true}}))
  await m.click('Save reviewed positioning version')
  assert.equal(m.all().find(n => props(n)?.role === 'alert')?.textContent || '', '')
  await until(()=>m.button('Review product and service continuation'))
  const save=m.calls.find(c=>c.name==='save_project_positioning_output')
  assert.equal(save.args.p_source_message_id,m.approval.id);assert.equal(save.args.p_approval_message_id,m.approval.id)
  assert.equal(save.args.p_wording, ownerParagraph)
  assert.equal(m.calls.filter(c => c.name === 'save_project_positioning_output').length, 1)
  assert.doesNotMatch(JSON.stringify(save.args),/OWNER_PREFIX|OWNER_TAIL|Exact saved positioning wording/)
  assert.equal(m.fixture.data.messages.length,3);assert.equal(m.sent.length,0);assert.equal(m.fixture.data.counters.run,0)
})
