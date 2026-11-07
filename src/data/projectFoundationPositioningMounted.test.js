import test from 'node:test'
import assert from 'node:assert/strict'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { createServer } from 'vite'
import { mountedEnvironment } from './testSupport/n1bMountedDom.js'
import { createDirectChatFixture, createProjectNavigationPreviewFixture, actor, organizationId, allowlist } from '../../tools/direct-chat-fixture.js'
import { directChatRecoveryKey } from './directChatRecovery.js'
const descendants = n => [n, ...n.childNodes.flatMap(descendants)]
const props = n => n?.[Object.keys(n).find(k => k.startsWith('__reactProps$'))]
const tick = () => act(async () => { await new Promise(r => setTimeout(r, 10)) })
async function until(fn) { for (let i = 0; i < 120; i++) { if (fn()) return; await tick() } assert.ok(fn(), 'mounted state available') }
async function mount(t, pending = false) {
  const env = mountedEnvironment(), storage = new Map(), controller = new AbortController()
  const values = { requestAnimationFrame:fn=>fn(), document: env.document, window: env.window, Event: env.window.Event, Node: env.window.Node, HTMLElement: env.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true, sessionStorage: { getItem: k => storage.get(k) || null, setItem: (k, v) => storage.set(k, v), removeItem: k => storage.delete(k) } }
  const previous = Object.fromEntries(Object.keys(values).map(k => [k, globalThis[k]])); Object.assign(globalThis, values)
  const fixture = createDirectChatFixture({ surface: 'project', state: 'populated' }), workspace = createProjectNavigationPreviewFixture(fixture.scope.project_id).workspace
  const binding = { request_id: 'ee000000-0000-4000-8000-000000000006', checkpoint_id: 'ee000000-0000-4000-8000-000000000007', source_version: 2, brief_sha256: 'a'.repeat(64) }
  const brief = 'Exact selected positioning source.\nDO_NOT_DISCLOSE_REMAINDER'
  const source = { organization_id: organizationId, project_id: workspace.project.id, engagement_id: workspace.engagement.id, actor_id: actor, current_binding: binding, options: [], has_more: false, selected: { checkpoint_id: binding.checkpoint_id, source_version: 2, brief_sha256: binding.brief_sha256, brief_text: brief, matches_current_brief: true } }
  const calls = [], sent = [], append = fixture.chat.appendContextHumanMessage
  fixture.chat.appendContextHumanMessage = async input => { sent.push(structuredClone(input)); return append(input) }
  if (pending) storage.set(directChatRecoveryKey(actor, organizationId, 'project_team', workspace.project.id), JSON.stringify({ conversation_id: fixture.data.rows[0].id, client_request_id: binding.request_id }))
  globalThis.__foundationUi = { fixture, allowlist, actor, rpc: async (name,args) => {
    calls.push({name,args})
    if(name==='read_project_stage_plan')return {data:{organization_id:organizationId,project_id:workspace.project.id,engagement_id:workspace.engagement.id,state:'unconfigured',groups:[],bindings:[],can_manage:true}}
    if(name==='bind_project_foundation_brief'){
      assert.equal(args.p_expected_binding_id,null)
      source.current_binding={...binding,request_id:args.p_request_id}
      return {data:source.current_binding}
    }
    if(name==='recover_project_foundation_brief'){
      assert.equal(args.p_request_id,source.current_binding.request_id)
      return {data:source.current_binding}
    }
    assert.equal(name,'read_project_foundation_brief')
    return {data:{...source,options:[{checkpoint_id:binding.checkpoint_id,source_version:2}],selected:args.p_checkpoint_id?source.selected:null}}
  }}
  const vite = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent', plugins: [{ name: 'foundation-composer', enforce: 'pre', resolveId(source) {
    for (const [suffix, name] of [['WorkspaceDialog.jsx', 'dialog'], ['ProjectSetupPanel.jsx', 'empty'], ['ProjectContentJourney.jsx', 'empty'], ['ProjectWebsiteExecution.jsx', 'empty'], ['ProjectChatContentActions.jsx', 'empty'], ['ProjectChatDesignActions.jsx', 'empty'], ['ProjectChatAllowance.jsx', 'empty'], ['/lib/supabase.js', 'client'], ['departmentChatRepository.js', 'chat'], ['contextChatRunnerRepository.js', 'runner'], ['integrationRepository.js', 'models']]) if (source.endsWith(suffix)) return '\0foundation-' + name
  }, load(id) {
    if (id === '\0foundation-dialog') return "import {createElement} from 'react';export default function Dialog({children}){return createElement('section',null,children)}"
    if (id === '\0foundation-empty') return 'export default function Empty(){return null}'
    if (id === '\0foundation-client') return 'export const supabase={auth:{getUser:async()=>({data:{user:{id:globalThis.__foundationUi.actor}}})},rpc:(...a)=>{const p=globalThis.__foundationUi.rpc(...a);p.abortSignal=()=>p;return p},functions:{invoke(){throw Error("Unexpected import action")}}}'
    if (id === '\0foundation-chat') return 'export const departmentChat=new Proxy({},{get:(_,k)=>(...a)=>globalThis.__foundationUi.fixture.chat[k](...a)})'
    if (id === '\0foundation-runner') return 'export const contextChatRunner=new Proxy({},{get:(_,k)=>(...a)=>globalThis.__foundationUi.fixture.runner[k](...a)})'
    if (id === '\0foundation-models') return 'export const integrations={listModelAllowlist:async()=>globalThis.__foundationUi.allowlist}'
  } }] })
  const { default: Chat } = await vite.ssrLoadModule('/src/components/DirectContextChat.jsx'), root = createRoot(env.container)
  const all = () => descendants(env.container), named = name => all().find(n => props(n)?.['aria-label'] === name), button = name => all().find(n => n.tagName === 'BUTTON' && (props(n)?.['aria-label'] || n.textContent) === name)
  const click = async name => { assert.ok(button(name), name); await act(async () => props(button(name)).onClick?.({ preventDefault() {} })); await tick() }
  const consumed = []
  const render = async selection => { await act(async () => root.render(createElement(Chat, { systemOwner: true, contextKind: 'project_team', projectId: workspace.project.id, label: 'Project Chat', organizationId, user: { id: actor }, signal: controller.signal, initialConversation: fixture.data.rows[0], projectJourney: workspace, foundationSelection: selection, onFoundationSelectionConsumed: id => consumed.push(id) }))); await tick() }
  t.after(async () => { await act(async () => root.unmount()); await vite.close(); Object.assign(globalThis, previous); delete globalThis.__foundationUi })
  await render(); await until(() => named('Message'))
  const select = async () => { await until(() => named('Foundation checkpoint text')); await act(async () => props(named('Foundation checkpoint text')).onSelect({ target: { selectionStart: 0, selectionEnd: brief.indexOf('\n') } })); await click('Add selected passage to message') }
  return { all, env, fixture, workspace, binding, source, calls, sent, named, button, click, render, select, consumed }
}
test('real composer panel callback preserves draft, selects exact text, rechecks stale binding and uses normal Send', async t => {
  const m = await mount(t)
  await until(() => !m.named('Message').disabled)
  await act(async () => props(m.named('Message')).onChange({ target: { value: 'Preserved existing draft' } }))
  m.source.current_binding=null
  await m.click('Open pipeline and work details')
  await until(()=>m.button('Browse internal checkpoints'))
  await m.click('Browse internal checkpoints')
  const option=m.all().find(n=>n.tagName==='OPTION'&&props(n)?.value===m.binding.checkpoint_id)
  assert.ok(option)
  await act(async()=>props(option.parentNode).onChange({target:{value:m.binding.checkpoint_id}}))
  await m.click('Review selected checkpoint')
  await m.click('Bind reviewed checkpoint to Business brief')
  await until(()=>m.env.container.textContent.includes('Original checkpoint binding confirmed.'))
  await m.click('Go to Brand positioning & statement')
  await m.click('Check bound brief')
  await m.click('Continue in Chat for Brand positioning & statement')
  await m.select()
  assert.equal(m.calls.filter(c=>c.name==='bind_project_foundation_brief').length,1)
  const draft = m.named('Message').value
  assert.ok(draft.startsWith('Preserved existing draft\n\nContinue with brand positioning'))
  assert.doesNotMatch(draft, /DO_NOT_DISCLOSE_REMAINDER/); assert.equal(m.sent.length, 0); assert.equal(m.fixture.data.counters.run, 0)
  m.source.selected.matches_current_brief = false
  await act(async () => props(m.named('Chat composer')).onSubmit({ preventDefault() {} })); await tick()
  assert.equal(m.sent.length, 0); assert.equal(m.named('Message').value, draft)
  m.source.selected.matches_current_brief = true
  await act(async () => props(m.named('Chat composer')).onSubmit({ preventDefault() {} })); await until(() => m.sent.length === 1)
  assert.equal(m.sent[0].message, draft); assert.equal(Object.hasOwn(m.sent[0], 'project_stage_context'), false)
  await until(() => m.fixture.data.counters.run === 1)
})
test('external Work entry is consumed once and pending recovery prevents adding a passage', async t => {
  const m = await mount(t, true)
  await m.render({ selectionId: 'work-entry', organizationId, projectId: m.workspace.project.id, engagementId: m.workspace.engagement.id, actorId: actor, binding: m.binding })
  await until(() => m.consumed.length === 1)
  assert.equal(m.named('Foundation checkpoint text'), undefined); assert.equal(m.sent.length, 0); assert.equal(m.fixture.data.counters.run, 0)
  assert.ok(m.env.container.textContent.includes('Check recovery'))
})
test('external Work entry rejects foreign scope and otherwise opens exact disclosure without sending', async t => {
  const m = await mount(t)
  const entry = { selectionId: 'foreign', organizationId, projectId: m.workspace.project.id, engagementId: m.workspace.engagement.id, actorId: 'ee000000-0000-4000-8000-000000000099', binding: m.binding }
  await m.render(entry); await until(() => m.consumed.length === 1)
  assert.equal(m.named('Foundation checkpoint text'), undefined)
  await m.render({ ...entry, selectionId: 'valid', actorId: actor }); await m.select()
  assert.equal(m.sent.length, 0); assert.equal(m.fixture.data.counters.run, 0)
  assert.equal(m.consumed.length, 2)
})
test('explicit removal preserves other draft and conversation change closes an unfinished disclosure', async t => {
  const m = await mount(t)
  await until(() => !m.named('Message').disabled)
  await act(async () => props(m.named('Message')).onChange({ target: { value: 'Exact original draft' } }))
  const entry = { selectionId: 'remove-reference', organizationId, projectId: m.workspace.project.id, engagementId: m.workspace.engagement.id, actorId: actor, binding: m.binding }
  await m.render(entry); await m.select()
  await m.click('Remove staged foundation passage')
  assert.equal(m.named('Message').value, 'Exact original draft')
  await m.render({ ...entry, selectionId: 'unfinished-disclosure' }); await until(() => m.named('Foundation checkpoint text'))
  await m.click('New chat'); await until(() => !m.named('Foundation checkpoint text'))
  assert.equal(m.sent.length, 0); assert.equal(m.fixture.data.counters.run, 0)
})
