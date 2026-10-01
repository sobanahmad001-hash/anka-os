import { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import Layout from '../src/components/Layout.jsx'
import { ThemeProvider, useTheme } from '../src/hooks/useTheme.jsx'
import WorkshopChatWorkspace from '../src/components/WorkshopChatWorkspace.jsx'
import WorkshopConversationList from '../src/components/WorkshopConversationList.jsx'
import ContentArtifactChat from '../src/components/ContentArtifactChat.jsx'
import ProjectPipelineConfigurationPanel from '../src/components/ProjectPipelineConfigurationPanel.jsx'
import PipelineExecutionDefinitionPanel from '../src/components/PipelineExecutionDefinitionPanel.jsx'
import PipelineRunIntentPanel from '../src/components/PipelineRunIntentPanel.jsx'
import DesignVideoBriefEditor from '../src/components/DesignVideoBriefEditor.jsx'
import {emptyVideoBrief} from '../supabase/functions/_shared/designVideoBrief.js'
import ContextConversationPanel from '../src/components/ContextConversationPanel.jsx'
import { actor, organizationId, threadId, requestId, dispatchId, humanId, createDirectChatFixture, createPipelinePreviewFixture } from './direct-chat-fixture.js'
import { clearDirectChatDraft } from '../src/data/directChatDraft.js'
import { directChatRecoveryKey, writeDirectChatRecovery } from '../src/data/directChatRecovery.js'
import { browserStorage, writeThemePreference } from '../src/data/themePreference.js'
import '../src/index.css'

const params = new URLSearchParams(location.search)
const surface = ['project','organization','marketing','design'].includes(params.get('surface')) ? params.get('surface') : 'content'
const state = ['populated', 'failed', 'uncertain', 'output-open'].includes(params.get('state')) ? params.get('state') : 'empty'
const storageKey = `anka-offline-b1-fixture:${surface}:${state}`
let stored
try { stored = JSON.parse(sessionStorage.getItem(storageKey)) } catch { /* Empty fixture. */ }
const fixture = createDirectChatFixture({ surface, state, stored, persist: data => { sessionStorage.setItem(storageKey, JSON.stringify(data)); window.dispatchEvent(new Event('fixture-counters')) } })
fixture.allowEngagementAnswer = params.get('answer') === 'fixture'
const scope = fixture.scope
if (!stored && ['failed', 'uncertain'].includes(state)) writeDirectChatRecovery(directChatRecoveryKey(actor, organizationId, scope.context_kind, scope.project_id, scope.department_id), { conversation_id: threadId, client_request_id: requestId, dispatch_request_id: dispatchId, message_id: humanId })
const membership = { organizationId, organization: { id: organizationId, name: 'Anka preview' }, role: 'operations_admin', departmentId: 'content', departmentIds: ['content'] }
if (params.has('theme')) writeThemePreference(browserStorage(), actor, params.get('theme'))
globalThis.__directChatPreview = { fixture, pipeline:createPipelinePreviewFixture({declared:params.get('stage-contracts')==='1'}), organization: { activeOrganizationId: organizationId, memberships: [membership], activeMembership: membership, selectionRequired: false, loading: false, error: null, selectOrganization: () => {}, scopeRevision: 1, requestSignal: new AbortController().signal, handleOrganizationAccessError: () => {} } }

function Preview() {
  const { theme, setTheme } = useTheme()
  const [selectedConversation, setSelectedConversation] = useState(state === 'empty' ? null : fixture.data.rows[0])
  const [selectionRevision, setSelectionRevision] = useState(0)
  const [navigationBusy, setNavigationBusy] = useState(false)
  const [draftDirty, setDraftDirty] = useState(false)
  const [conversationListRevision, setConversationListRevision] = useState(0)
  const [mode, setMode] = useState('private')
  const [briefScript, setBriefScript] = useState(''), [briefSettings,setBriefSettings] = useState(emptyVideoBrief), [confirmedBrief,setConfirmedBrief] = useState(null)
  const [engagementSelection, setEngagementSelection] = useState(null)
  const [mobile, setMobile] = useState(params.get('size') === 'mobile')
  const [counters, setCounters] = useState({ ...fixture.data.counters })

  useEffect(() => {
    const update = () => setCounters({ ...fixture.data.counters })
    window.addEventListener('fixture-counters', update)
    return () => window.removeEventListener('fixture-counters', update)
  }, [])
  useEffect(() => {
    if (state !== 'output-open') return
    const observer = new MutationObserver(() => {
      const button = [...document.querySelectorAll('button')].find(item => item.textContent === 'Open reply')
      if (button) { observer.disconnect(); button.click() }
    })
    observer.observe(document.getElementById('preview-chat'), { childList: true, subtree: true })
    return () => observer.disconnect()
  }, [])
  if (params.get('panel') === 'pipelines') return <div className="workspace-page"><h1 className="workspace-title">Project pipelines</h1><p className="workspace-description">Provider-free local fixture · synthetic published sources · no production writes</p><div className="mt-5 space-y-5"><ProjectPipelineConfigurationPanel organizationId={organizationId} engagement={{...fixture.engagements[0],status:'active'}} services={globalThis.__directChatPreview.pipeline.services} membership={membership} /><PipelineRunIntentPanel organizationId={organizationId} engagement={{...fixture.engagements[0],status:'active'}} assets={[]} membership={membership} /></div></div>
  if (params.get('panel') === 'video-brief') return <div className="workspace-page design-workshop"><h1 className="workspace-title">Confirmed video brief · local prototype</h1><p>No provider requests or production writes. Canonical saving/recovery uses an isolated fixture; database and Generate integration remain unverified.</p><DesignVideoBriefEditor studio={fixture.designWorkshop} context={{private_conversation_id:threadId}} actorId={actor} organizationId={organizationId} settings={briefSettings} script={briefScript} onScriptChange={setBriefScript} onRestoreSettings={setBriefSettings} onConfirmed={setConfirmedBrief} onNavigationBusyChange={setNavigationBusy} onDraftDirtyChange={setDraftDirty} /><p role="status">{confirmedBrief ? 'Exact mocked version confirmed; no generation performed.' : navigationBusy ? 'Original confirmation needs settlement.' : 'Prepare the exact video brief.'}</p></div>
  if(params.get('panel')==='definitions')return <div className="workspace-page"><h1 className="workspace-title">Pipeline stage definitions</h1><p className="text-sm text-[var(--anka-muted)]">Offline verification · no provider calls or production writes. Head signoff and publication remain unverified.</p><PipelineExecutionDefinitionPanel organizationId={organizationId} catalog={globalThis.__directChatPreview.pipeline.definitionCatalog} services={globalThis.__directChatPreview.pipeline.definitionServices} membership={membership} signal={globalThis.__directChatPreview.organization.requestSignal} /></div>
  if (params.get('panel') === 'writer') return <div className="workspace-page"><h1 className="workspace-title">Content Workshop</h1><details className="text-xs text-[var(--anka-muted)]"><summary>Offline verification fixture</summary><p>No provider calls or production writes. Actual shared shell, grouped history and engagement Chat.</p></details><WorkshopChatWorkspace compactChat draftDirty={draftDirty} mode="chat" departmentName="Content" projectName="Website Content" engagementName={fixture.contentWorkspace.engagement.name} navigationBusy={navigationBusy} onModeChange={setMode} onConversationSelect={setEngagementSelection} conversationList={onOpen => <WorkshopConversationList activeEngagementId={fixture.engagements[0].id} compact navigationBusy={navigationBusy} refreshKey={conversationListRevision} organizationId={organizationId} actorId={actor} scopeRevision={1} departmentId="content" engagements={fixture.engagements} workstreams={fixture.workstreams} signal={globalThis.__directChatPreview.organization.requestSignal} onOpen={onOpen} />}><ContentArtifactChat sideEditor hideConversationList projectId={fixture.engagements[0].project_id} engagement={fixture.contentWorkspace.engagement} presentation="workbench" onNavigationBusyChange={setNavigationBusy} onDraftDirtyChange={setDraftDirty} onConversationListChange={() => setConversationListRevision(value=>value+1)} /></WorkshopChatWorkspace></div>
  return <div className="workspace-page" style={{ maxWidth: 1500, margin: 'auto' }}>
    <h1 className="workspace-title">{surface === 'project' ? 'Launch project · Chat' : surface === 'design' ? 'Design Workshop · Chat' : 'Content Workshop · Chat'}</h1><p className="text-sm text-[var(--anka-muted)]">Offline fixture · No provider calls</p><details className="preview-controls"><summary>Preview controls · test fixtures</summary>
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, margin: '20px 0' }}>
      <label>Surface <select value={surface} onChange={event => { params.set('surface', event.target.value); location.search = params.toString() }}><option value="content">Content private</option><option value="project">Project AI</option></select></label>
      <label>State <select value={state} onChange={event => { params.set('state', event.target.value); location.search = params.toString() }}>{['empty', 'populated', 'failed', 'uncertain', 'output-open'].map(value => <option key={value}>{value}</option>)}</select></label>
      <label>Appearance <select value={theme} onChange={event => { void setTheme(event.target.value) }}>{['system', 'light', 'dark'].map(value => <option key={value}>{value}</option>)}</select></label>
      <label><input type="checkbox" checked={mobile} onChange={event => setMobile(event.target.checked)} />390px mobile</label>
      <button onClick={() => { fixture.recoveryAvailable = true }}>Make fixture recovery available</button>
      <button onClick={() => { sessionStorage.removeItem(storageKey); clearDirectChatDraft(directChatRecoveryKey(actor, organizationId, scope.context_kind, scope.project_id, scope.department_id)); sessionStorage.removeItem(directChatRecoveryKey(actor, organizationId, scope.context_kind, scope.project_id, scope.department_id)); location.reload() }}>Reset this fixture</button>
    </div><p role="status">Created {counters.created} · Messages {counters.messages} · Run {counters.run} · Recover {counters.recover}</p>
    </details><div id="preview-chat" style={{ width: mobile ? 390 : '100%', maxWidth: '100%', margin: '16px auto' }}>
      {['content','marketing','design'].includes(surface) ? <WorkshopChatWorkspace presentation={surface === 'design' ? 'design' : undefined} mode={mode} draftDirty={draftDirty} compactPrivate={mode === 'private'} departmentName={surface === 'design' ? 'Design' : surface === 'marketing' ? 'Marketing' : 'Content'} navigationBusy={navigationBusy} onModeChange={setMode} onConversationSelect={item => { if (navigationBusy) return; if (item.kind === 'private') { setSelectedConversation(item.row); setSelectionRevision(value => value + 1) } else setEngagementSelection(item) }} conversationList={onOpen => <WorkshopConversationList compact navigationBusy={navigationBusy} refreshKey={conversationListRevision} organizationId={organizationId} actorId={actor} scopeRevision={1} departmentId={scope.department_id} engagements={fixture.engagements} workstreams={fixture.workstreams} signal={globalThis.__directChatPreview.organization.requestSignal} onOpen={onOpen} />}><>{mode === 'private' ? <ContextConversationPanel key={selectionRevision} directSend contextKind={scope.context_kind} departmentId={scope.department_id} label={surface === 'design' ? 'Design · Private chat' : surface === 'marketing' ? 'Marketing · Private chat' : 'Content · Private chat'} initialConversation={selectedConversation} onConversationListChange={() => setConversationListRevision(value => value + 1)} onNavigationBusyChange={setNavigationBusy} onDraftDirtyChange={setDraftDirty} /> : <section aria-label="Separate engagement history"><h2>{engagementSelection?.row.title || 'Project engagement'}</h2><p>Separate project history selected. The live specialist route is preserved in DepartmentWorkshop; this isolated B1 fixture exercises private chat only.</p></section>}</></WorkshopChatWorkspace>
        : <ContextConversationPanel directSend contextKind={scope.context_kind} projectId={scope.project_id} label={surface === 'organization' ? 'Universal Chat' : 'Launch project · Project AI'} initialConversation={state === 'empty' ? null : fixture.data.rows[0]} />}
    </div>
  </div>
}
const router = createMemoryRouter([{ element: <Layout />, children: [{ path: '*', element: <Preview /> }] }], { initialEntries: ['/sphere/workspace'] })
createRoot(document.getElementById('root')).render(<ThemeProvider><RouterProvider router={router} /></ThemeProvider>)
