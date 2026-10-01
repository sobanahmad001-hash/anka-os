import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createHash } from 'node:crypto'
import {videoBriefCreativeContent} from '../../supabase/functions/_shared/designVideoBrief.js'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { createServer } from 'vite'
import { mountedEnvironment, elements } from './testSupport/designVideoDom.js'

// Optional read-only snapshot root. No production source is copied or modified.
const sourceRoot = process.env.ANKA_DESIGN_TEST_SOURCE_ROOT || process.cwd()
const paths = ['src/components/DesignVideoCapabilities.jsx', 'src/data/designVideoQuoteTransport.js']
const snapshots = new Map(paths.map(path => [path, readFileSync(resolve(sourceRoot, path), 'utf8')]))
for (const [path, source] of snapshots) console.log('Test source SHA256', path, createHash('sha256').update(source).digest('hex'))
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no }); return { promise, resolve, reject } }
const propsOf = node => node[Object.keys(node).find(key => key.startsWith('__reactProps$'))]
const button = (container, text) => elements(container, 'button').find(node => node.textContent.includes(text))
const connection = { id: 'a0000000-0000-4000-8000-000000000008', display_name: 'Offline fixture', provider: 'higgsfield', status: 'verified', secret_configured: true, organization_level: true, department_ids: [], secret_name: 'ANKA_HIGGSFIELD_TEST' }
let fixture
test('mounted video submission context and uncertainty regressions', async t => {
  const server = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent',
    plugins: [{ name: 'design-offline-fixture', enforce: 'pre', load(id) {
      const path = id.replaceAll('\\', '/').split('?')[0]
      for (const [relative, source] of snapshots) if (path.endsWith('/' + relative)) return source
      if (path.endsWith('/src/data/designWorkshopRepository.js')) return 'export const designWorkshop = { forOrganization: (...args) => globalThis.__designVideoFixture.studio };'
      if (path.endsWith('/src/data/integrationRepository.js')) return 'export const integrations = { listForOrganization: async organization_id => ({ organization_id, connections: globalThis.__designVideoFixture.connections }) };'
      if (path.endsWith('/src/context/AuthContext.jsx')) return 'export const useAuth=()=>({user:{id:"a0000000-0000-4000-8000-000000000003"}})'
      if (path.endsWith('/src/context/OrganizationContext.jsx')) return 'export const useOrganization = () => globalThis.__designVideoFixture.scope;'
    } }] })
  t.after(() => server.close())
  const { default: Component } = await server.ssrLoadModule('/src/components/DesignVideoCapabilities.jsx')
  async function mount(t, { historyError = false, beforeGenerate, onNavigationBusyChange, presentation, rows = [], privateConversationId, privateApi = true, bothAnchors = false } = {}) {
    const env = mountedEnvironment()
    const names = ['document', 'window', 'Event', 'Node', 'HTMLElement', 'IS_REACT_ACT_ENVIRONMENT', '__designVideoFixture', 'sessionStorage','fetch']
    const previous = Object.fromEntries(names.map(name => [name, globalThis[name]]))
    const submit = deferred()
    const calls = [],briefs=new Map(),storage=new Map()
    fixture = { scope: { activeOrganizationId: 'a0000000-0000-4000-8000-000000000001', scopeRevision: 1, requestSignal: new AbortController().signal }, connections: [connection], rows, historyError }
    fixture.studio = {
      getVideoBrief:async input=>briefs.get(JSON.stringify([fixture.scope.activeOrganizationId,input.private_conversation_id || input.direction_version_id])) || {},
      confirmVideoBrief:async input=>{const key=JSON.stringify([fixture.scope.activeOrganizationId,input.private_conversation_id || input.direction_version_id]),prior=briefs.get(key),id=crypto.randomUUID(),context=input.private_conversation_id ? {private_conversation_id:input.private_conversation_id} : {direction_version_id:input.direction_version_id};const result={brief:{id:prior?.brief.id || crypto.randomUUID(),organization_id:fixture.scope.activeOrganizationId,created_by:'a0000000-0000-4000-8000-000000000003',visibility:'private',revision:(prior?.brief.revision || 0)+2,frozen_version_id:id},version:{id,organization_id:fixture.scope.activeOrganizationId,created_by:'a0000000-0000-4000-8000-000000000003',creative_brief_id:null,operation_key:input.operation_key,version_number:(prior?.version.version_number || 0)+1,validation_snapshot:{valid:true,video_confirmation:{action:'confirm_video_brief',actor_id:'a0000000-0000-4000-8000-000000000003',expected_revision:input.expected_revision,requested_root_id:input.creative_brief_id}},content:videoBriefCreativeContent(input.video_brief,context)}};result.version.creative_brief_id=result.brief.id;briefs.set(key,result);return result},
      listVideoJobs: async () => { if (fixture.historyError) throw new Error('offline history failure'); return fixture.rows },
      getVideoQuote: async input => ({ paid_execution_enabled: true, organization_cap_configured: true, spend_tracking_configured: true, spend_guard_mode: 'local_monthly_cap',
        quote: { ...input, id: 'a0000000-0000-4000-8000-000000000009', provider: 'higgsfield', model_id: 'bytedance/seedance-2.5/text-to-video', currency: 'USD', max_charge_microusd: 1000000, verified_at: new Date(Date.now() - 1000).toISOString(), valid_until: new Date(Date.now() + 60000).toISOString() } }),
      generateVideo: input => { calls.push(input); return submit.promise },
    }
    if (privateConversationId && privateApi) {
      fixture.studio.listPrivateVideoJobs = fixture.studio.listVideoJobs
      fixture.studio.getPrivateVideoQuote = fixture.studio.getVideoQuote
      fixture.studio.generatePrivateVideo = fixture.studio.generateVideo
      fixture.studio.listVideoJobs = fixture.studio.getVideoQuote = fixture.studio.generateVideo = () => { throw new Error('Private video must not use project APIs') }
    }
    Object.assign(globalThis, { document: env.document, window: env.window, Event: env.window.Event, Node: env.window.Node, HTMLElement: env.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true, __designVideoFixture: fixture,
      sessionStorage:{getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,value),removeItem:key=>storage.delete(key)},
      fetch: () => { throw new Error('Network forbidden in mounted video tests') } })
    const root = createRoot(env.container)
    t.after(async () => { await act(async () => root.unmount()); Object.assign(globalThis, previous) })
    const render = async anchor => act(async () => root.render(createElement(Component, { ...(privateConversationId ? { privateConversationId: anchor, ...(bothAnchors ? { directionVersionId: 'invalid' } : {}) } : { directionVersionId: anchor }), beforeGenerate, onNavigationBusyChange, presentation })))
    await render(privateConversationId || 'a0000000-0000-4000-8000-000000000004')
    const change = async (node, value, checked) => act(async () => propsOf(node).onChange({ target: { value, checked } }))
    async function prepare() {
      await act(async () => propsOf(button(env.container, 'Check exact quote')).onClick())
      const fields={Purpose:'Synthetic local video',Audience:'Offline testers','Channel / placement':'Website','Source assets / reuse plan':'None','Script / storyboard':'Offline prompt','Brand constraints':'No unlicensed marks','Required text':'None'}
      for(const [name,value] of Object.entries(fields)){const field=elements(env.container,'textarea').find(node=>propsOf(node)['aria-label']===name);if(field && !propsOf(field).disabled)await change(field,value)}
      const preview=button(env.container,'Preview complete video brief');if(preview && !propsOf(preview).disabled){await act(async()=>propsOf(preview).onClick());await act(async()=>propsOf(button(env.container,'Confirm video brief version')).onClick())}
      await change(elements(env.container, 'select').find(node => node.textContent.includes('Choose connection')), 'a0000000-0000-4000-8000-000000000008')
      await change(elements(env.container, 'input').at(-1), undefined, true)
    }
    const submitNow = () => propsOf(elements(env.container, 'form')[0]).onSubmit({ preventDefault() {} })
    return { env, submit, calls, render, prepare, change,submitNow, unmount: () => act(async () => root.unmount()) }
  }
  for (const kind of ['direction', 'organization', 'scope revision']) await t.test(kind + ' switch clears consent/prompt and old pending busy', async t => {
    const m = await mount(t); await m.prepare()
    assert.equal(propsOf(button(m.env.container, 'Generate one video')).disabled, false)
    await act(async () => { void m.submitNow() })
    assert.equal(m.calls.length, 1)
    if (kind === 'organization') fixture.scope = { ...fixture.scope, activeOrganizationId: 'a0000000-0000-4000-8000-000000000002', requestSignal: new AbortController().signal }
    if (kind === 'scope revision') fixture.scope = { ...fixture.scope, scopeRevision: 2 }
    await m.render(kind === 'direction' ? 'a0000000-0000-4000-8000-000000000005' : 'a0000000-0000-4000-8000-000000000004')
    assert.equal(elements(m.env.container, 'textarea')[0].value,kind==='scope revision' ? 'Synthetic local video' : '')
    assert.equal(elements(m.env.container, 'input').at(-1).checked, false)
    assert.doesNotMatch(m.env.container.textContent, /Recording original request/)
    await act(async () => m.submit.resolve({ status: 'queued' }))
    assert.doesNotMatch(m.env.container.textContent, /Original video request recorded/)
    await m.prepare()
    assert.equal(propsOf(button(m.env.container, 'Generate one video')).disabled, false, 'new scope must not stay busy')
  })
  await t.test('private exact conversation payload and same-key recovery never use project APIs', async t => {
    const busy = []
    const m = await mount(t, { privateConversationId: 'a0000000-0000-4000-8000-000000000006', onNavigationBusyChange: value => busy.push(value) })
    await m.prepare()
    assert.equal(propsOf(button(m.env.container, 'Generate one video')).disabled, false)
    await act(async () => { void m.submitNow(); void m.submitNow() })
    assert.equal(m.calls.length, 1)
    const original = m.calls[0]
    assert.equal(original.private_conversation_id, 'a0000000-0000-4000-8000-000000000006')
    assert.match(original.prompt,/Script \/ storyboard:\nOffline prompt/);assert.ok(original.creative_brief_version_id)
    for (const key of ['direction_version_id', 'project_id', 'engagement_id', 'messages', 'history', 'attachments']) assert.ok(!(key in original))
    assert.equal(busy.at(-1), true)
    await act(async () => m.submit.reject(new Error('response interrupted')))
    assert.equal(propsOf(elements(m.env.container,'fieldset').find(node=>propsOf(node).className?.includes('grid'))).disabled,true)
    fixture.studio.generatePrivateVideo = async input => { m.calls.push(input); return { status: 'queued' } }
    await act(async () => propsOf(button(m.env.container, 'Reconcile same video request')).onClick({ preventDefault() {} }))
    assert.deepEqual(m.calls[1], original)
    assert.equal(busy.at(-1), false)
    assert.equal(elements(m.env.container, 'input').at(-1).checked, false)
  })
  for (const options of [{ privateApi: false }, { bothAnchors: true }]) await t.test('private unavailable or ambiguous anchor ' + JSON.stringify(options), async t => {
    const m = await mount(t, { privateConversationId: 'a0000000-0000-4000-8000-000000000006', ...options })
    assert.equal(propsOf(button(m.env.container, 'Check exact quote')).disabled, true)
    assert.equal(propsOf(button(m.env.container, 'Generate one video')).disabled, true)
    assert.match(m.env.container.textContent, /No generation or project fallback/)
    assert.equal(m.calls.length, 0)
  })
  await t.test('private foreign history fails closed', async t => {
    const m = await mount(t, { privateConversationId: 'a0000000-0000-4000-8000-000000000006', rows: [{ id: 'foreign', private_conversation_id: 'a0000000-0000-4000-8000-000000000007', status: 'ready' }] })
    await m.prepare()
    assert.match(m.env.container.textContent, /history is unavailable/)
    assert.equal(propsOf(button(m.env.container, 'Generate one video')).disabled, true)
    assert.equal(button(m.env.container, 'Open private preview'), undefined)
  })
  await t.test('private signed output is exact and clears on conversation change', async t => {
    const m = await mount(t, { privateConversationId: 'a0000000-0000-4000-8000-000000000006', presentation: 'workbench' })
    const signed = []
    fixture.studio.signVideoOutput = async id => { signed.push(id); return { signed_url: 'https://offline.invalid/private-video' } }
    fixture.studio.listEngagements = async () => []
    fixture.rows = [{ id: 'private-job', private_conversation_id: 'a0000000-0000-4000-8000-000000000006', status: 'ready', mode: 'explore', duration_seconds: 5, resolution: '720p', created_at: new Date().toISOString() }]
    fixture.scope = { ...fixture.scope, scopeRevision: 2 }
    await m.render('a0000000-0000-4000-8000-000000000006')
    await act(async () => propsOf(button(m.env.container, 'Open private preview')).onClick())
    assert.deepEqual(signed, ['private-job'])
    assert.equal(propsOf(elements(m.env.container, 'video')[0]).src, 'https://offline.invalid/private-video')
    assert.match(m.env.container.textContent, /Private conversation: a0000000-0000-4000-8000-000000000006/)
    assert.match(m.env.container.textContent, /Use in project/)
    fixture.rows = []
    await m.render('a0000000-0000-4000-8000-000000000007')
    assert.equal(elements(m.env.container, 'video').length, 0)
    assert.equal(m.calls.length, 0)
  })
  await t.test('private deferred context check cannot dispatch after unmount', async t => {
    const check = deferred()
    const m = await mount(t, { privateConversationId: 'a0000000-0000-4000-8000-000000000006', beforeGenerate: () => check.promise })
    await m.prepare()
    let pending
    await act(async () => { pending = m.submitNow() })
    assert.equal(m.calls.length, 0)
    await m.unmount()
    await act(async () => { check.resolve(); await pending })
    assert.equal(m.calls.length, 0, 'cleanup invalidates job generation before any provider dispatch')
  })
  await t.test('private durable unknown history keeps navigation locked after remount', async t => {
    const busy = []
    await mount(t, { privateConversationId: 'a0000000-0000-4000-8000-000000000006', onNavigationBusyChange: value => busy.push(value), rows: [{ id: 'unknown', private_conversation_id: 'a0000000-0000-4000-8000-000000000006', status: 'outcome_unknown', created_at: new Date().toISOString() }] })
    assert.equal(busy.at(-1), true)
  })
  await t.test('quote and spend consent cannot bypass an unconfirmed brief',async t=>{
    const m=await mount(t)
    await act(async()=>propsOf(button(m.env.container,'Check exact quote')).onClick())
    await m.change(elements(m.env.container,'select').find(node=>node.textContent.includes('Choose connection')),'a0000000-0000-4000-8000-000000000008')
    assert.equal(propsOf(button(m.env.container,'Generate one video')).disabled,true)
    await act(async()=>m.submitNow());assert.equal(m.calls.length,0)
  })
  await t.test('a retained Generate callback cannot use an edited or newly confirmed different version',async t=>{
    const m=await mount(t);await m.prepare();const old=propsOf(elements(m.env.container,'form')[0]).onSubmit
    await m.change(elements(m.env.container,'textarea').find(node=>propsOf(node)['aria-label']==='Required text'),'Changed exact overlay')
    assert.equal(propsOf(button(m.env.container,'Generate one video')).disabled,true);await act(async()=>old({preventDefault(){}}));assert.equal(m.calls.length,0)
    await m.prepare();assert.equal(propsOf(button(m.env.container,'Generate one video')).disabled,false)
    await act(async()=>old({preventDefault(){}}));assert.equal(m.calls.length,0)
  })
  await t.test('Generate freezes canonical brief editing even through a retained field callback',async t=>{
    const m=await mount(t);await m.prepare();const purpose=elements(m.env.container,'textarea').find(node=>propsOf(node)['aria-label']==='Purpose'),edit=propsOf(purpose).onChange
    await act(async()=>{void m.submitNow()});assert.equal(m.calls.length,1)
    await act(async()=>edit({target:{value:'Should not replace the pending brief'}}));assert.equal(purpose.value,'Synthetic local video')
    await act(async()=>m.submit.resolve({status:'queued'}))
  })
  await t.test('rapid double submit invokes one mocked request', async t => {
    const m = await mount(t); await m.prepare()
    await act(async () => { void m.submitNow(); void m.submitNow() })
    assert.equal(m.calls.length, 1)
    assert.ok(m.calls[0].operation_key)
    await act(async () => m.submit.resolve({ status: 'queued' }))
  })
  await t.test('unknown outcome remains blocked after fresh quote and remount with unresolved history', async t => {
    const m = await mount(t); await m.prepare()
    await act(async () => { void m.submitNow() })
    fixture.rows = [{ id: 'job', status: 'outcome_unknown', mode: 'explore', duration_seconds: 5, resolution: '720p', created_at: new Date().toISOString() }]
    await act(async () => m.submit.reject(new Error('lost response')))
    await m.prepare()
    assert.equal(propsOf(button(m.env.container, 'Generate one video')).disabled, true)
    fixture.scope = { ...fixture.scope, scopeRevision: 2 }
    await m.render('a0000000-0000-4000-8000-000000000004'); await m.prepare()
    assert.equal(propsOf(button(m.env.container, 'Generate one video')).disabled, true)
    await act(async () => { void m.submitNow() })
    assert.equal(m.calls.length, 1)
  })
  await t.test('unavailable history fails closed despite quote and consent', async t => {
    const m = await mount(t, { historyError: true }); await m.prepare()
    assert.match(m.env.container.textContent, /history is unavailable/)
    assert.equal(propsOf(button(m.env.container, 'Generate one video')).disabled, true)
    await act(async () => { void m.submitNow() })
    assert.equal(m.calls.length, 0)
  })
  await t.test('fresh context rejection blocks paid dispatch after quote and consent', async t => {
    const m = await mount(t, { beforeGenerate: async () => { throw new Error('Context revoked') } })
    await m.prepare()
    await act(async () => m.submitNow())
    assert.equal(m.calls.length, 0)
  })
  await t.test('uncertain video freezes settings and reconciles the exact original payload and key', async t => {
    const busy = []
    const m = await mount(t, { onNavigationBusyChange: value => busy.push(value) })
    await m.prepare()
    await act(async () => { void m.submitNow() })
    assert.equal(busy.at(-1), true)
    await act(async () => m.submit.reject(new Error('lost response')))
    assert.equal(propsOf(elements(m.env.container,'fieldset').find(node=>propsOf(node).className?.includes('grid'))).disabled,true)
    const original = m.calls[0]
    fixture.studio.generateVideo = async input => { m.calls.push(input); return { status: 'queued' } }
    await act(async () => propsOf(button(m.env.container, 'Reconcile same video request')).onClick({ preventDefault() {} }))
    assert.deepEqual(m.calls[1], original)
    assert.equal(busy.at(-1), false)
  })
  await t.test('workbench signed video preview stays private, exact and separate from draft promotion', async t => {
    const m = await mount(t, { presentation: 'workbench' })
    const signed = []
    fixture.studio.signVideoOutput = async id => { signed.push(id); return { signed_url: 'https://offline.invalid/exact-video' } }
    fixture.studio.listEngagements = async () => []
    fixture.rows = [{ id: 'ready-job', status: 'ready', mode: 'explore', duration_seconds: 5, resolution: '720p', created_at: new Date().toISOString() }]
    fixture.scope = { ...fixture.scope, scopeRevision: 2 }
    await m.render('a0000000-0000-4000-8000-000000000004')
    assert.equal(elements(m.env.container, 'video').length, 0)
    assert.match(m.env.container.textContent, /Private video preview/)
    await act(async () => propsOf(button(m.env.container, 'Open private preview')).onClick())
    assert.deepEqual(signed, ['ready-job'])
    assert.equal(propsOf(elements(m.env.container, 'video')[0]).src, 'https://offline.invalid/exact-video')
    assert.match(m.env.container.textContent, /No project copy or approval inferred/)
    assert.match(m.env.container.textContent, /Copies this exact saved video to an unapproved draft/)
    assert.equal(m.calls.length, 0)
    await m.render('a0000000-0000-4000-8000-000000000005')
    assert.equal(elements(m.env.container, 'video').length, 0, 'new direction cannot inherit the prior signed preview')
  })
})
