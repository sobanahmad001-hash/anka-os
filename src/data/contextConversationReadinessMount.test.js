import assert from 'node:assert/strict'
import test from 'node:test'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { createServer } from 'vite'
import { mountedEnvironment } from './testSupport/n1bMountedDom.js'

const descendants = node => [node, ...node.childNodes.flatMap(descendants)]
const button = (root, label) => descendants(root).find(node => node.tagName === 'BUTTON' && node.textContent.includes(label))
const reactProps = node => node[Object.keys(node).find(key => key.startsWith('__reactProps$'))]

async function mount(t, readiness, panelProps = {}, modelAllowlist) {
  const environment = mountedEnvironment()
  const values = { document: environment.document, window: environment.window,
    Event: environment.window.Event, Node: environment.window.Node,
    HTMLElement: environment.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true }
  const previous = Object.fromEntries(Object.keys(values).map(key => [key, globalThis[key]]))
  Object.assign(globalThis, values)
  const calls = []
  globalThis.__contextReadinessFixture = {
    rows: [{ id: 'conversation', owner_id: 'actor', title: 'Private', state: 'active' }],
    modelAllowlist,
    created: [],
    renamed: [],
    messages: [{ id: 'message', conversation_id: 'conversation', author_id: 'actor', role: 'user', body: 'Question', status: 'completed' }],
    readiness: input => { calls.push(input); return readiness(input) },
    runner: () => { throw new Error('Provider runner must not be called') },
  }
  const vite = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent',
    plugins: [{ name: 'offline-context-readiness', enforce: 'pre',
      resolveId(source) {
      if (source.endsWith('/lib/supabase.js')) return '\0offline-import-client'
        if (source.endsWith('PrivateDesignVideoTools.jsx')) return '\0context-video'
        if (source.endsWith('/context/AuthContext.jsx') || source.endsWith('../context/AuthContext.jsx')) return '\0context-auth'
        if (source.endsWith('/context/OrganizationContext.jsx') || source.endsWith('../context/OrganizationContext.jsx')) return '\0context-organization'
        if (source.endsWith('departmentChatRepository.js')) return '\0context-repository'
        if (source.endsWith('integrationRepository.js')) return '\0context-integrations'
        if (source.endsWith('contextChatRunnerRepository.js')) return '\0context-runner'
      },
      load(id) {
      if (id === '\0offline-import-client') return 'export const supabase = {functions:{invoke(){throw Error("Unexpected importer network request")}}}'
        if (id === '\0context-video') return `import { createElement, useEffect, useState } from 'react'; export default function Tools(props) {
          const [draft, setDraft] = useState('');
          globalThis.__contextReadinessFixture.videoProps = props;
          useEffect(() => { globalThis.__contextReadinessFixture.videoMounts = (globalThis.__contextReadinessFixture.videoMounts || 0) + 1 }, []);
          return createElement('input', { 'aria-label': 'Video fixture prompt', value: draft, onChange: event => setDraft(event.target.value) });
        }`
        if (id === '\0context-auth') return 'export const useAuth = () => ({ user: { id: "actor" } })'
        if (id === '\0context-organization') return 'export const useOrganization = () => ({ activeOrganizationId: "org", scopeRevision: 1, requestSignal: globalThis.__contextReadinessFixture.signal, handleOrganizationAccessError: () => {} })'
        if (id === '\0context-repository') return `export const departmentChat = {
          listContextConversations: async () => globalThis.__contextReadinessFixture.rows,
          getProjectContextSharing: async () => ({ candidates: [], recipients: [] }),
          createContextConversation: async input => {
            const fixture = globalThis.__contextReadinessFixture
            fixture.created.push(input)
            const row = { id: 'new-conversation', owner_id: 'actor', title: input.title }
            fixture.rows = [row, ...fixture.rows]
            return row
          },
          getContextConversation: async input => {
            const fixture = globalThis.__contextReadinessFixture
            const conversation = fixture.exactConversation?.id === input.conversation_id ? fixture.exactConversation : fixture.rows.find(row => row.id === input.conversation_id)
            return { conversation, messages: fixture.messages.filter(row => row.conversation_id === input.conversation_id), has_older: false }
          },
          appendContextHumanMessage: async input => {
            const message = { id: 'saved-human', conversation_id: input.conversation_id, author_id: 'actor', role: 'user', body: input.message, status: 'completed' }
            globalThis.__contextReadinessFixture.messages.push(message)
            return message
          },
          renameContextConversation: async input => {
            const fixture = globalThis.__contextReadinessFixture
            fixture.renamed.push(input)
            const row = fixture.rows.find(item => item.id === input.conversation_id)
            row.title = input.title
            return row
          },
          getContextChatReadiness: async input => globalThis.__contextReadinessFixture.readiness(input),
        }`
        if (id === '\0context-integrations') return `export const integrations = { listModelAllowlist: async () => globalThis.__contextReadinessFixture.modelAllowlist || ({ connections: [{ id: 'connector', organization_level: true, status: 'verified', provider: 'openai', display_name: 'OpenAI', context_model_configurations: [{ id: 'model', model_id: 'verified' }] }] }) }`
        if (id === '\0context-runner') return 'export const contextChatRunner = { run: () => globalThis.__contextReadinessFixture.runner(), recover: () => globalThis.__contextReadinessFixture.runner() }'
      },
    }] })
  t.after(() => vite.close())
  const { default: Panel } = await vite.ssrLoadModule('/src/components/ContextConversationPanel.jsx')
  const root = createRoot(environment.container)
  globalThis.__contextReadinessFixture.signal = new AbortController().signal
  t.after(async () => { await act(async () => root.unmount()); Object.assign(globalThis, previous); delete globalThis.__contextReadinessFixture })
  await act(async () => root.render(createElement(Panel, { contextKind: 'organization', label: 'Organization conversations', ...panelProps })))
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) })
  return { environment, calls, root, Panel }
}

for (const [label, readiness, expected] of [
  ['paid off', () => ({ paid_execution_enabled: false, spend_tracking_configured: true, spend_guard_mode: 'local_monthly_cap', model_status: 'configured' }), 'AI execution is currently off'],
  ['tracking missing', () => ({ paid_execution_enabled: true, spend_tracking_configured: false, spend_guard_mode: null, model_status: 'configured' }), 'Organization spend tracking is not configured'],
  ['price missing', () => ({ paid_execution_enabled: true, spend_tracking_configured: true, spend_guard_mode: 'local_monthly_cap', model_status: 'price_unavailable' }), 'fresh verified price'],
  ['provider managed', () => ({ paid_execution_enabled: true, spend_tracking_configured: true, spend_guard_mode: 'provider_managed', model_status: 'configured' }), 'cannot verify or enforce'],
]) test('private context shows server readiness: ' + label, async t => {
  const { environment, calls } = await mount(t, readiness)
  assert.ok(calls.some(input => input.model_configuration_id === 'model'))
  assert.ok(environment.container.textContent.includes(expected))
  const ask = button(environment.container, 'Ask Anka AI')
  assert.ok(ask)
  assert.equal(ask.disabled, label !== 'provider managed', 'readiness gates remain independent of consent')
})

for (const departmentId of ['design', 'content', 'marketing']) test(`compact ${departmentId} private composer confirms once per scope and retains mounted draft`, async t => {
  const { environment } = await mount(t, () => ({ paid_execution_enabled: true, spend_tracking_configured: true, model_status: 'configured' }),
    { contextKind: 'department_private', departmentId, workshopLayout: true, hideConversationList: true })
  const all = () => descendants(environment.container)
  const toolbar = all().find(node => reactProps(node)?.className === 'private-composer-toolbar')
  assert.ok(toolbar)
  const transcript = all().find(node => reactProps(node)?.['aria-live'] === 'polite')
  const composer = all().find(node => node.tagName === 'TEXTAREA')
  assert.ok(all().indexOf(transcript) < all().indexOf(toolbar))
  assert.ok(all().indexOf(toolbar) < all().indexOf(composer))
  const creation = all().find(node => reactProps(node)?.className === 'private-new-conversation')
  assert.equal(creation.tagName, 'DETAILS')
  assert.ok(!reactProps(creation).open)
  const details = descendants(toolbar).find(node => node.tagName === 'DETAILS')
  assert.equal(reactProps(details).open, false)
  assert.equal(descendants(toolbar).filter(node => node.tagName === 'INPUT').length, 0, 'private exploration offers neither per-message consent nor canonical records')
  assert.match(toolbar.textContent, /OpenAI · verified/)
  assert.equal(button(environment.container, 'Ask Anka AI').disabled, false)
  await act(async () => reactProps(composer).onChange({ target: { value: 'Keep private draft' } }))
  let dispatches = 0
  globalThis.__contextReadinessFixture.runner = () => { dispatches++; return { status: 'pending' } }
  await act(async () => { void reactProps(button(environment.container, 'Ask Anka AI')).onClick() })
  assert.equal(dispatches, 0)
  assert.match(environment.container.textContent, /Teammate-authored messages, private files and private memory are excluded/)
  await act(async () => reactProps(button(environment.container, 'Allow and ask Anka AI')).onClick())
  assert.equal(dispatches, 1)
  await act(async () => reactProps(button(environment.container, 'Ask Anka AI')).onClick())
  assert.equal(dispatches, 2, 'same scope needs no second click')
  const sendForm = all().find(node => node.tagName === 'FORM' && descendants(node).includes(composer))
  await act(async () => reactProps(sendForm).onSubmit({ preventDefault() {} }))
  await act(async () => reactProps(button(environment.container, 'Ask Anka AI')).onClick())
  assert.equal(dispatches, 3, 'saving human text does not invalidate consent')
  assert.equal(globalThis.__contextReadinessFixture.created.length, 0)
})

test('Design asset switch retains mounted text/video drafts and ORs video navigation busy', async t => {
  const reports = []
  const { environment } = await mount(t, () => ({ paid_execution_enabled: false }),
    { contextKind: 'department_private', departmentId: 'design', workshopLayout: true, onNavigationBusyChange: value => reports.push(value) })
  const all = () => descendants(environment.container)
  const asset = () => all().find(node => reactProps(node)?.['aria-label'] === 'Private Design asset type')
  const textDraft = all().find(node => node.tagName === 'TEXTAREA')
  await act(async () => reactProps(textDraft).onChange({ target: { value: 'Unsent private text' } }))
  await act(async () => reactProps(asset()).onChange({ target: { value: 'video' } }))
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)) })
  const fixture = globalThis.__contextReadinessFixture
  assert.equal(fixture.videoProps.conversationId, 'conversation')
  fixture.exactConversation = { id: 'conversation', owner_id: 'actor', organization_id: 'org', context_kind: 'department_private', department_id: 'design', state: 'active' }
  await fixture.videoProps.beforeGenerate('conversation')
  fixture.exactConversation = { ...fixture.exactConversation, state: 'archived' }
  await assert.rejects(fixture.videoProps.beforeGenerate('conversation'), /unavailable/)
  fixture.exactConversation = { ...fixture.exactConversation, state: 'active', owner_id: 'another-user' }
  await assert.rejects(fixture.videoProps.beforeGenerate('conversation'), /unavailable/)
  const videoDraft = all().find(node => reactProps(node)?.['aria-label'] === 'Video fixture prompt')
  await act(async () => reactProps(videoDraft).onChange({ target: { value: 'Unsent private video' } }))
  await act(async () => reactProps(asset()).onChange({ target: { value: 'text' } }))
  assert.equal(reactProps(textDraft).value, 'Unsent private text')
  await act(async () => reactProps(asset()).onChange({ target: { value: 'video' } }))
  assert.equal(reactProps(videoDraft).value, 'Unsent private video')
  assert.equal(fixture.videoMounts, 1)
  await act(async () => fixture.videoProps.onNavigationBusyChange(true))
  assert.equal(reports.at(-1), true)
  assert.equal(reactProps(asset()).disabled, true)
  assert.equal(button(environment.container, 'New conversation').disabled, true)
  await act(async () => reactProps(asset()).onChange({ target: { value: 'text' } }))
  assert.equal(reactProps(asset()).value, 'video')
  await act(async () => fixture.videoProps.onNavigationBusyChange(false))
  assert.equal(reports.at(-1), false)
  assert.equal(fixture.created.length, 0)
  const staleVideoCallback = fixture.videoProps.onNavigationBusyChange
  const createForm = all().find(node => node.tagName === 'FORM' && node.textContent.includes('New conversation'))
  await act(async () => reactProps(createForm).onSubmit({ preventDefault() {} }))
  await act(async () => staleVideoCallback(true))
  assert.equal(reports.at(-1), false, 'old pane cannot lock the new conversation')
  assert.equal(reactProps(asset()).value, 'text')
})

test('Development private conversation retains default presentation', async t => {
  const { environment } = await mount(t, () => ({ paid_execution_enabled: false }),
    { contextKind: 'department_private', departmentId: 'development', workshopLayout: true, hideConversationList: true })
  assert.ok(!descendants(environment.container).some(node => reactProps(node)?.className === 'private-composer-toolbar'))
  assert.ok(!descendants(environment.container).some(node => reactProps(node)?.className === 'private-new-conversation'))
  assert.ok(button(environment.container, 'New conversation'))
})

test('Workshop conversation search, creation and department reset stay private', async t => {
  const { environment, root, Panel } = await mount(t, () => ({ paid_execution_enabled: false }),
    { contextKind: 'department_private', departmentId: 'design', workshopLayout: true })
  const props = node => node[Object.keys(node).find(key => key.startsWith('__reactProps$'))]
  const search = () => descendants(environment.container).find(node => node.tagName === 'INPUT' && props(node)['aria-label'] === 'Search loaded conversations')
  await act(async () => props(search()).onChange({ target: { value: 'missing' } }))
  assert.match(environment.container.textContent, /No matching loaded conversations/)
  assert.equal(button(environment.container, 'Private'), undefined)
  assert.match(environment.container.textContent, /Question/, 'search must not replace the open transcript')
  await act(async () => props(search()).onChange({ target: { value: '' } }))
  assert.ok(button(environment.container, 'Private'))
  const title = descendants(environment.container).find(node => node.tagName === 'INPUT' && props(node)['aria-label'] === 'Optional conversation title')
  await act(async () => props(title).onChange({ target: { value: 'New direction' } }))
  const form = descendants(environment.container).find(node => node.tagName === 'FORM' && node.textContent.includes('New conversation'))
  await act(async () => props(form).onSubmit({ preventDefault() {} }))
  assert.deepEqual(globalThis.__contextReadinessFixture.created, [{ context_kind: 'department_private', department_id: 'design', title: 'New direction' }])
  assert.ok(button(environment.container, 'New direction'))
  assert.match(environment.container.textContent, /AI unavailable; you can still save messages/)
  await act(async () => props(search()).onChange({ target: { value: 'old search' } }))
  globalThis.__contextReadinessFixture.rows = []
  await act(async () => root.render(createElement(Panel, { contextKind: 'department_private', departmentId: 'content', workshopLayout: true })))
  assert.equal(props(search()).value, '')
  assert.doesNotMatch(environment.container.textContent, /New direction|Question/)
})

test('first saved message titles a new conversation and the owner can rename it', async t => {
  const { environment } = await mount(t, () => ({ paid_execution_enabled: false }))
  const props = node => node[Object.keys(node).find(key => key.startsWith('__reactProps$'))]
  const all = () => descendants(environment.container)
  const createForm = all().find(node => node.tagName === 'FORM' && node.textContent.includes('New conversation'))
  await act(async () => props(createForm).onSubmit({ preventDefault() {} }))
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) })
  const composer = all().find(node => node.tagName === 'TEXTAREA')
  await act(async () => props(composer).onChange({ target: { value: '  Explain   the launch plan  ' } }))
  const sendForm = all().find(node => node.tagName === 'FORM' && descendants(node).includes(composer))
  await act(async () => props(sendForm).onSubmit({ preventDefault() {} }))
  assert.deepEqual(globalThis.__contextReadinessFixture.created[0], {
    context_kind: 'organization', title: 'New conversation',
  })
  assert.deepEqual(globalThis.__contextReadinessFixture.renamed[0], {
    conversation_id: 'new-conversation', title: 'Explain the launch plan',
  })
  const renameInput = all().find(node => node.tagName === 'INPUT' && props(node)['aria-label'] === 'Rename conversation')
  await act(async () => props(renameInput).onChange({ target: { value: 'Launch notes' } }))
  const renameForm = all().find(node => node.tagName === 'FORM' && descendants(node).includes(renameInput))
  await act(async () => props(renameForm).onSubmit({ preventDefault() {} }))
  assert.equal(globalThis.__contextReadinessFixture.renamed[1].title, 'Launch notes')
  assert.ok(button(environment.container, 'Launch notes'))
})
test('canonical context stays opt-in per reply and selection alone never calls a provider', async t => {
  const { environment } = await mount(t, () => ({ paid_execution_enabled: true, spend_tracking_configured: true, model_status: 'configured' }))
  const all = () => descendants(environment.container)
  const canonical = () => all().find(node => node.tagName === 'INPUT' && reactProps(node)?.type === 'checkbox')
  let dispatches = 0
  globalThis.__contextReadinessFixture.runner = () => { dispatches++; return { status: 'pending' } }
  assert.equal(reactProps(canonical()).checked, false)
  await act(async () => { void reactProps(button(environment.container, 'Ask Anka AI')).onClick() })
  await act(async () => reactProps(button(environment.container, 'Allow and ask Anka AI')).onClick())
  assert.equal(dispatches, 1)
  await act(async () => reactProps(canonical()).onChange({ target: { checked: true } }))
  assert.equal(dispatches, 1, 'records-only selection is not execution')
  await act(async () => { void reactProps(button(environment.container, 'Ask Anka AI')).onClick() })
  assert.equal(dispatches, 1, 'changing canonical inclusion requires fresh consent')
  const model = all().find(node => node.tagName === 'SELECT' && reactProps(node)?.id === 'organization-conversation-model')
  assert.equal(reactProps(model).disabled, true)
  await act(async () => reactProps(model).onChange({ target: { value: 'another-model' } }))
  assert.equal(reactProps(model).value, 'model', 'pending consent preserves the captured dispatch model')
  assert.match(environment.container.textContent, /Include the bounded OpenAI canonical summary/)
  await act(async () => reactProps(button(environment.container, 'Allow and ask Anka AI')).onClick())
  assert.equal(dispatches, 2)
  assert.equal(reactProps(canonical()).checked, false, 'canonical sources remain an explicit per-reply choice')
  await act(async () => { void reactProps(button(environment.container, 'Ask Anka AI')).onClick() })
  assert.equal(dispatches, 2)
  await act(async () => reactProps(button(environment.container, 'Allow and ask Anka AI')).onClick())
  assert.equal(dispatches, 3)
  assert.equal(reactProps(canonical()).checked, false)
})

const approvedPreferenceModels = ids => ({ connections: [{
  id: 'connector', organization_level: true, status: 'verified', provider: 'openai', display_name: 'OpenAI',
  context_model_configurations: ids.map(model_id => ({ id: model_id, model_id })),
}] })

for (const [contextKind, models, expected] of [
  ['project_team', ['gpt-6-luna', 'gpt-6-astra', 'gpt-6.1-sol'], 'gpt-6.1-sol'],
  ['organization', ['gpt-6.1-sol', 'gpt-6-luna'], 'gpt-6-luna'],
  ['department_private', ['gpt-6-luna', 'gpt-6.1-sol'], 'gpt-6.1-sol'],
  ['project_team', ['gpt-6-astra', 'gpt-4.1'], 'gpt-4.1'],
  ['project_team', ['gpt-6-astra'], ''],
]) test(`conversation panel ${contextKind} chooses eligible preference ${expected || 'none'}`, async t => {
  const panelProps = { contextKind, projectId: contextKind === 'project_team' ? 'project' : '', departmentId: contextKind === 'department_private' ? 'content' : '' }
  const { environment, root, Panel } = await mount(t, () => ({ paid_execution_enabled: false }), panelProps, approvedPreferenceModels(models))
  const selected = () => descendants(environment.container).find(node => reactProps(node)?.id === 'organization-conversation-model')
  assert.equal(reactProps(selected()).value, expected)
  if (models.includes('gpt-6-luna') && expected !== 'gpt-6-luna') {
    await act(async () => reactProps(selected()).onChange({ target: { value: 'gpt-6-luna' } }))
    await act(async () => root.render(createElement(Panel, { ...panelProps, label: 'Changed label' })))
    assert.equal(reactProps(selected()).value, 'gpt-6-luna', 'explicit eligible choice survives rerender')
  }
})
