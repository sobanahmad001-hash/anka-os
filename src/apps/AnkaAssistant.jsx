import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { DEPARTMENT_LABELS } from '../config/connectorCatalog.js'
import { useAuth } from '../context/AuthContext.jsx'
import { useOrganization } from '../context/OrganizationContext.jsx'
import OrganizationGate from '../components/OrganizationGate.jsx'
import ContextConversationPanel from '../components/ContextConversationPanel.jsx'
import ContextChatReleaseReviewPanel from '../components/ContextChatReleaseReviewPanel.jsx'
import _PrivateMemoryPanel from './PrivateMemoryPanel.jsx'
import _AssistantMemoryContext from './AssistantMemoryContext.jsx'
import _OrganizationPolicyPanel from './OrganizationPolicyPanel.jsx'
import _PromotedMemoryRetentionPanel from './PromotedMemoryRetentionPanel.jsx'
import { aiRepository } from '../data/aiRepository.js'
import { delivery } from '../data/delivery.js'
import { operatingSpine } from '../data/operatingSpine.js'

const CAPABILITIES = [
  ['project_pulse', 'Project Pulse', 'Status, risks, blockers, reviews, and next actions from live project records.'],
  ['daily_brief', 'Daily Brief', 'Your assigned work, overdue items, and recommended sequencing.'],
  ['research_support', 'Research Support', 'Separate evidence, inference, gaps, and next research steps.'],
  ['writing_support', 'Writing Support', 'Draft content grounded in the selected project context.'],
  ['quality_review', 'Quality Review', 'Identify issues against scope and criteria without approving anything.'],
  ['action_proposal', 'Action Proposal', 'Turn a request into one structured task or research proposal for your confirmation.'],
]
const INPUT = 'w-full rounded-xl border border-[var(--anka-line)] bg-[var(--anka-canvas)] px-3 py-2.5 text-sm text-[var(--anka-ink)] focus:border-[var(--anka-focus)]'
const labelize = value => String(value || '').replaceAll('_', ' ').replace(/\b\w/g, letter => letter.toUpperCase())
const dateTime = value => new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))

export default function AnkaAssistant() {
  return <OrganizationGate><ScopedAnkaAssistant /></OrganizationGate>
}

function ScopedAnkaAssistant() {
  const { user, profile } = useAuth()
  const { activeOrganizationId, scopeRevision, requestSignal, handleOrganizationAccessError } = useOrganization()
  const [searchParams] = useSearchParams()
  const requestedDepartment = searchParams.get('department')
  const [projects, setProjects] = useState([])
  const [engagements, setEngagements] = useState([])
  const [workspace, setWorkspace] = useState(null)
  const [projectId, setProjectId] = useState('')
  const [engagementWorkspace, setEngagementWorkspace] = useState(null)
  const [departmentId, setDepartmentId] = useState(
    DEPARTMENT_LABELS[requestedDepartment] ? requestedDepartment : '',
  )
  const [capability, setCapability] = useState('project_pulse')
  const [input, setInput] = useState('')
  const [result, setResult] = useState(null)
  const [runs, setRuns] = useState([])
  const [activeTab, setActiveTab] = useState('conversations')
  const [chatScope, setChatScope] = useState('organization')
  const [chatProjectId, setChatProjectId] = useState('')
  const [loading, setLoading] = useState(true)
  const [running, setRunning] = useState(false)
  const [decisionSaving, setDecisionSaving] = useState(false)
  const [error, setError] = useState('')
  const engagementId = useMemo(
    () => engagements.find(engagement => engagement.project_id === projectId)?.id || '',
    [engagements, projectId],
  )

  useEffect(() => {
    let current = true
    setLoading(true)
    setError('')
    Promise.all([
      delivery.listProjects(activeOrganizationId, { signal: requestSignal }),
      operatingSpine.listEngagements(activeOrganizationId, { signal: requestSignal }),
      aiRepository.listRuns(activeOrganizationId, { signal: requestSignal }),
    ]).then(([projectRows, engagementRows, runRows]) => {
      if (!current || requestSignal.aborted) return
      setProjects(projectRows)
      setChatProjectId('')
      setEngagements(engagementRows)
      setRuns(runRows)
      setProjectId(engagementRows[0]?.project_id || projectRows[0]?.id || '')
    }).catch((cause) => {
      if (!current || requestSignal.aborted || cause?.name === 'AbortError') return
      handleOrganizationAccessError(cause, { membershipMismatch: cause.membershipMismatch })
      setError(cause.message)
    }).finally(() => { if (current && !requestSignal.aborted) setLoading(false) })
    return () => { current = false }
  }, [activeOrganizationId, handleOrganizationAccessError, requestSignal, scopeRevision])
  useEffect(() => {
    if (!departmentId && DEPARTMENT_LABELS[profile?.department]) setDepartmentId(profile.department)
  }, [departmentId, profile?.department])
  useEffect(() => {
    setWorkspace(null)
    if (!projectId) return undefined
    let current = true
    delivery.getProjectWorkspace(projectId, activeOrganizationId, { signal: requestSignal }).then((nextWorkspace) => {
      if (!current || requestSignal.aborted) return
      setWorkspace(nextWorkspace)
      const availableDepartments = [...new Set(nextWorkspace.workstreams.map(item => item.department_id).filter(id => DEPARTMENT_LABELS[id]))]
      setDepartmentId(value => availableDepartments.includes(value) ? value : availableDepartments[0] || '')
    }).catch((cause) => {
      if (!current || requestSignal.aborted || cause?.name === 'AbortError') return
      handleOrganizationAccessError(cause, { membershipMismatch: cause.membershipMismatch })
      setError(cause.message)
    })
    return () => { current = false }
  }, [activeOrganizationId, handleOrganizationAccessError, projectId, requestSignal, scopeRevision])
  useEffect(() => {
    setEngagementWorkspace(null)
    if (!engagementId) return undefined
    let current = true
    operatingSpine.getEngagement(engagementId, activeOrganizationId, { signal: requestSignal }).then((nextWorkspace) => {
      if (!current || requestSignal.aborted) return
      setEngagementWorkspace(nextWorkspace)
      const availableDepartments = [...new Set(nextWorkspace.services.map(item => item.service_catalog?.department_id).filter(id => DEPARTMENT_LABELS[id]))]
      setDepartmentId(value => availableDepartments.includes(value) ? value : availableDepartments[0] || '')
    }).catch((cause) => {
      if (!current || requestSignal.aborted || cause?.name === 'AbortError') return
      handleOrganizationAccessError(cause, { membershipMismatch: cause.membershipMismatch })
      setError(cause.message)
    })
    return () => { current = false }
  }, [activeOrganizationId, engagementId, handleOrganizationAccessError, requestSignal, scopeRevision])

  async function runAssistant(event) {
    event.preventDefault()
    if (!projectId && capability !== 'daily_brief') return setError('Select a project for this capability.')
    if (projectId && workspace?.project?.organization_id !== activeOrganizationId) return setError('Selected project is unavailable in the active organization.')
    setRunning(true)
    setError('')
    setResult(null)
    try {
      if (!departmentId) return setError('Select an operating department.')
      const response = await aiRepository.run({ organizationId: activeOrganizationId, capability, projectId: projectId || null, engagementId: engagementId || null, departmentId, input })
      setResult({ ...response, capability, runContext: { projectId: projectId || null, engagementId: engagementId || null, departmentId } })
      setRuns(current => [{
        id: response.run_id, project_id: projectId || null, engagement_id: engagementId || null, capability,
        status: 'completed', output_text: response.content,
        proposed_action: response.proposed_action,
        provider: response.provider, model: response.model,
        input_tokens: response.usage?.input_tokens,
        output_tokens: response.usage?.output_tokens,
        estimated_cost_microusd: response.usage?.estimated_cost_microusd,
        context_manifest: response.context_manifest,
        human_decision: response.proposed_action ? 'pending' : 'not_applicable',
        created_at: new Date().toISOString(),
      }, ...current])
    } catch (runError) {
      setError(runError.message)
    } finally {
      setRunning(false)
    }
  }

  async function rejectProposal() {
    if (!result?.run_id) return
    setDecisionSaving(true)
    try {
      await aiRepository.recordDecision(result.run_id, 'rejected', 'Rejected by the user without execution.')
      setResult(current => ({ ...current, decision: 'rejected' }))
      await refreshRuns()
    } catch (decisionError) { setError(decisionError.message) }
    finally { setDecisionSaving(false) }
  }

  async function confirmProposal() {
    const action = result?.proposed_action
    if (!action || !user?.id || workspace?.project?.organization_id !== activeOrganizationId || result?.runContext?.projectId !== projectId || workspace?.project?.id !== result?.runContext?.projectId) return setError('Reopen this audited proposal in its original project before confirming it.')
    setDecisionSaving(true)
    setError('')
    try {
      let created
      if (action.type === 'create_task') {
        const workstream = workspace.workstreams.find(item => item.id === action.params.workstream_id)
        created = await delivery.createTask({
          projectId,
          workstreamId: workstream?.id || null,
          departmentId: workstream?.department_id || null,
          title: action.params.title,
          description: action.params.description || '',
          acceptanceCriteria: action.params.acceptance_criteria || '',
          priority: action.params.priority || 'medium',
          dueDate: action.params.due_date || null,
        }, user.id)
      } else if (action.type === 'create_research_record') {
        created = await delivery.createResearchRecord({
          projectId,
          workstreamId: action.params.workstream_id || null,
          title: action.params.title,
          researchType: action.params.research_type || 'general',
          question: action.params.question || '',
          findings: '',
          recommendation: action.params.recommendation || '',
          sources: [],
        }, user.id)
      } else {
        throw new Error('Unsupported proposal type')
      }
      await aiRepository.recordDecision(result.run_id, 'accepted', `Created ${action.type} record ${created.id}`)
      setResult(current => ({ ...current, decision: 'accepted', createdRecordId: created.id }))
      setWorkspace(await delivery.getProjectWorkspace(projectId, activeOrganizationId, { signal: requestSignal }))
      await refreshRuns()
    } catch (decisionError) {
      setError(decisionError.message)
    } finally {
      setDecisionSaving(false)
    }
  }

  async function refreshRuns() {
    if (requestSignal.aborted) return
    const nextRuns = await aiRepository.listRuns(activeOrganizationId, { signal: requestSignal })
    if (!requestSignal.aborted) setRuns(nextRuns)
  }

  const selectedCapability = CAPABILITIES.find(item => item[0] === capability)
  const departmentOptions = useMemo(() => {
    if (!workspace && !engagementWorkspace) return Object.entries(DEPARTMENT_LABELS)
    const ids = [...new Set([
      ...(workspace?.workstreams || []).map(item => item.department_id),
      ...(engagementWorkspace?.services || []).map(item => item.service_catalog?.department_id),
    ].filter(id => DEPARTMENT_LABELS[id]))]
    return ids.map(id => [id, DEPARTMENT_LABELS[id]])
  }, [workspace, engagementWorkspace])
  const projectById = useMemo(() => new Map(projects.map(project => [project.id, project])), [projects])
  const engagementById = useMemo(() => new Map(engagements.map(engagement => [engagement.id, engagement])), [engagements])
  const usage = useMemo(() => ({
    runs: runs.filter(run => run.status === 'completed').length,
    inputTokens: runs.reduce((sum, run) => sum + Number(run.input_tokens || 0), 0),
    outputTokens: runs.reduce((sum, run) => sum + Number(run.output_tokens || 0), 0),
    cost: runs.reduce((sum, run) => sum + Number(run.estimated_cost_microusd || 0), 0),
  }), [runs])

  if (loading) return <div className="flex h-full items-center justify-center bg-[var(--anka-canvas)]"><div className="h-8 w-8 animate-spin rounded-full border-b-2 border-[var(--anka-violet)]" /></div>

  return <div className="min-h-full bg-[var(--anka-canvas)] text-[var(--anka-ink)]">
    <header className="border-b border-[var(--anka-line)] bg-[var(--anka-surface)] px-6 py-6"><div className="workspace-container flex flex-wrap items-end justify-between gap-4"><div><p className="workspace-eyebrow">Human-controlled intelligence</p><h1 className="workspace-title">Anka AI Assistant</h1><p className="mt-1 text-sm text-[var(--anka-muted)]">Private conversations for organization and project work, with separate audited record tools.</p></div><div className="flex flex-wrap gap-2"><button onClick={() => setActiveTab('conversations')} className={`rounded-xl px-4 py-2 text-sm ${activeTab === 'conversations' ? "bg-[var(--anka-violet)] text-[var(--anka-on-violet)]" : "bg-[var(--anka-surface-raised)] text-[var(--anka-muted)]"}`}>Chat</button><button onClick={() => setActiveTab('assistant')} className={`rounded-xl px-4 py-2 text-sm ${activeTab === 'assistant' ? "bg-[var(--anka-violet)] text-[var(--anka-on-violet)]" : "bg-[var(--anka-surface-raised)] text-[var(--anka-muted)]"}`}>Record tools</button><button onClick={() => setActiveTab('private')} className={`rounded-xl px-4 py-2 text-sm ${activeTab === 'private' ? "bg-[var(--anka-violet)] text-[var(--anka-on-violet)]" : "bg-[var(--anka-surface-raised)] text-[var(--anka-muted)]"}`}>Private memory</button><button onClick={() => setActiveTab('policy')} className={"rounded-xl px-4 py-2 text-sm " + (activeTab === 'policy' ? "bg-[var(--anka-violet)] text-[var(--anka-on-violet)]" : "bg-[var(--anka-surface-raised)] text-[var(--anka-muted)]")}>Organization policy</button><button onClick={() => setActiveTab('audit')} className={`rounded-xl px-4 py-2 text-sm ${activeTab === 'audit' ? "bg-[var(--anka-violet)] text-[var(--anka-on-violet)]" : "bg-[var(--anka-surface-raised)] text-[var(--anka-muted)]"}`}>AI Audit</button></div></div></header>
    <div className="border-b border-[var(--anka-warning)] bg-[var(--anka-warning-soft)] px-6 py-3 text-center text-xs text-[var(--anka-warning)]">AI can analyze, draft, review, and propose. It cannot approve, publish, deploy, launch spend, change scope, or act without your confirmation.</div>
    {error && <div className="mx-auto mt-4 max-w-7xl rounded-xl border border-[var(--anka-danger)] bg-[var(--anka-danger-soft)] px-4 py-3 text-sm text-[var(--anka-danger)]">{error}</div>}

    {activeTab === 'assistant' ? <main className="workspace-container workspace-page grid gap-6 xl:grid-cols-[360px_1fr]">
      <form onSubmit={runAssistant} className="h-fit space-y-5 workspace-card p-5"><div><h2 className="font-semibold">Request assistance</h2><p className="mt-1 text-xs text-[var(--anka-muted)]">The server retrieves the canonical project plus its Operating Spine extension, when present, and uses the verified connector mapped to the selected department.</p></div><Field label="Capability"><div className="space-y-2">{CAPABILITIES.map(([id, label, description]) => <button type="button" disabled={id === 'action_proposal' && !workspace?.workstreams?.length} key={id} onClick={() => setCapability(id)} className={`w-full rounded-xl border p-3 text-left disabled:cursor-not-allowed disabled:opacity-40 ${capability === id ? "border-[var(--anka-violet)] bg-[var(--anka-violet-soft)]" : "border-[var(--anka-line)] bg-[var(--anka-canvas)]"}`}><p className="text-sm font-medium">{label}</p><p className="mt-1 text-xs text-[var(--anka-muted)]">{description}</p></button>)}</div></Field><Field label="Project context"><select className={INPUT} value={projectId} disabled={running || Boolean(result?.proposed_action && !result?.decision)} onChange={event => setProjectId(event.target.value)}><option value="">My work only</option>{projects.map(project => <option key={project.id} value={project.id}>{project.name}</option>)}</select></Field>{engagementId && <p className="rounded-xl border border-[var(--anka-violet)] bg-[var(--anka-violet-soft)] px-3 py-2 text-xs text-[var(--anka-violet)]">Operating Spine services and artifacts are included automatically.</p>}<Field label="Operating department"><select required className={INPUT} value={departmentId} onChange={event => setDepartmentId(event.target.value)}><option value="">Select department</option>{departmentOptions.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></Field><_AssistantMemoryContext organizationId={activeOrganizationId} projectId={projectId} departmentId={departmentId} scopeRevision={scopeRevision} onAccessError={handleOrganizationAccessError} /><Field label={capability === 'project_pulse' ? 'Specific focus (optional)' : 'Request'}><textarea className={INPUT} rows="5" value={input} onChange={event => setInput(event.target.value)} placeholder={placeholder(capability)} /></Field><button disabled={running || !departmentId || (projectId && !workspace) || (engagementId && !engagementWorkspace) || (!projectId && capability !== 'daily_brief')} className="w-full rounded-xl bg-[var(--anka-violet)] px-4 py-2.5 text-sm font-semibold disabled:opacity-50 text-[var(--anka-on-violet)]">{running ? 'Analyzing authorized context…' : `Run ${selectedCapability?.[1]}`}</button></form>

      <section className="min-w-0 space-y-5">{result ? <><article className="workspace-card p-6"><div className="flex flex-wrap items-center justify-between gap-3"><div><p className="workspace-eyebrow">{labelize(result.capability || capability)}</p><p className="mt-1 text-xs text-[var(--anka-muted)]">{DEPARTMENT_LABELS[result.department_id] || labelize(result.department_id)} · {result.provider} · {result.model} · Run {result.run_id}</p></div><Usage usage={result.usage} /></div><pre className="mt-5 whitespace-pre-wrap font-sans text-sm leading-7 text-[var(--anka-ink)]">{result.content}</pre><SourceManifest manifest={result.context_manifest} /></article>{result.proposed_action && <ProposalCard result={result} workspace={workspace} saving={decisionSaving} onConfirm={confirmProposal} onReject={rejectProposal} />}</> : <div className="flex min-h-[540px] items-center justify-center rounded-2xl border border-dashed border-[var(--anka-line)] bg-[var(--anka-surface)] p-8 text-center"><div><div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-[var(--anka-violet)] text-2xl font-bold text-[var(--anka-on-violet)]">A</div><h2 className="mt-5 text-lg font-semibold">Select a capability, project, and department</h2><p className="mx-auto mt-2 max-w-lg text-sm leading-6 text-[var(--anka-muted)]">Anka will use canonical tasks, research, deliverables, requests, the Living Project Record, and the verified connector assigned to that department. Record IDs and connector scope are preserved in the audit manifest.</p></div></div>}</section>
    </main> : activeTab === 'conversations' ? <main className="mx-auto max-w-6xl space-y-5 p-6">
      <div className="workspace-card p-4">
        <h2 className="font-semibold">Choose conversation context</h2>
        <p className="mt-1 text-sm text-[var(--anka-muted)]">Organization and project conversations keep separate histories and access rules. Use Record tools for structured work across canonical records.</p>
        <div className="mt-3 flex flex-wrap gap-3">
          <label className="text-sm">Context <select className={INPUT} value={chatScope} onChange={event => { setChatScope(event.target.value); if (event.target.value === 'organization') { setChatProjectId(''); setProjectId('') } }}>
            <option value="organization">Organization</option><option value="project">Project</option>
          </select></label>
          {chatScope === 'project' && <label className="min-w-64 flex-1 text-sm">Project <select className={INPUT}
            value={projects.some(project => project.id === chatProjectId) ? chatProjectId : ''}
            onChange={event => { setChatProjectId(event.target.value); setProjectId(event.target.value) }}>
            <option value="">Choose project</option>
            {projects.map(project => <option key={project.id} value={project.id}>{project.name}</option>)}
          </select></label>}
        </div>
      </div>
      {chatScope === 'organization'
        ? <ContextConversationPanel directSend contextKind="organization" label="Organization chat" />
        : projects.some(project => project.id === chatProjectId)
          ? <ContextConversationPanel directSend contextKind="project_team" projectId={chatProjectId} label="Project chat" />
          : <p className="rounded-xl border border-[var(--anka-line)] p-5 text-sm text-[var(--anka-muted)]">Choose an accessible project to view its conversations.</p>}
      {result && <AssistantRunCard result={result} capability={result.capability || capability}
        projectName={projects.find(project => project.id === result.runContext?.projectId)?.name || 'Organization work'}
        matchingProject={result.runContext?.projectId === (chatScope === 'project' ? chatProjectId : null)
          && (!result.runContext?.projectId || workspace?.project?.id === result.runContext.projectId)}
        workspace={workspace} decisionSaving={decisionSaving} onConfirm={confirmProposal} onReject={rejectProposal}
        onViewAudit={() => setActiveTab('audit')} />}
      <AssistantConversationActions projectMode={chatScope === 'project'}
        projectReady={Boolean(chatScope === 'project' && chatProjectId && workspace?.project?.id === chatProjectId)}
        onOpen={nextCapability => {
          setCapability(nextCapability)
          setInput('')
          setActiveTab('assistant')
        }} />
      <ContextChatReleaseReviewPanel />
    </main> : activeTab === 'private' ? <main className="mx-auto max-w-5xl p-6"><_PrivateMemoryPanel organizationId={activeOrganizationId} ownerId={user?.id} scopeRevision={scopeRevision} onAccessError={handleOrganizationAccessError} /></main> : activeTab === 'policy' ? <main className="mx-auto max-w-5xl p-6"><_OrganizationPolicyPanel organizationId={activeOrganizationId} scopeRevision={scopeRevision} onAccessError={handleOrganizationAccessError} /><_PromotedMemoryRetentionPanel organizationId={activeOrganizationId} scopeRevision={scopeRevision} onAccessError={handleOrganizationAccessError} /></main> : <AuditView runs={runs} projects={projectById} engagements={engagementById} usage={usage} />}
  </div>
}

function AssistantConversationActions({ projectMode, projectReady, onOpen }) {
  const actions = projectMode
    ? [
        ['project_pulse', 'Project status and blockers'],
        ['writing_support', 'Draft project content'],
        ['quality_review', 'Review project work'],
        ['action_proposal', 'Propose a project task'],
      ]
    : [['daily_brief', 'Prepare my daily brief']]
  return <section aria-label="Conversation record actions" className="workspace-card p-4">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="font-semibold">Record tools</h2>
      <p className="mt-1 max-w-2xl text-xs leading-5 text-[var(--anka-muted)]">Run an audited capability alongside this chat. The chat transcript is not copied into the request; enter any prompt in Record tools. Results stay in AI Audit and appear here for this session.</p></div>
      {!projectMode && <span className="rounded-full border border-[var(--anka-line)] px-2.5 py-1 text-xs text-[var(--anka-muted)]">Organization scope</span>}
      {projectMode && <span className={`rounded-full border px-2.5 py-1 text-xs ${projectReady ? "border-[var(--anka-violet)] text-[var(--anka-success)]" : "border-[var(--anka-warning)] text-[var(--anka-warning)]"}`}>{projectReady ? 'Selected project ready' : 'Choose an accessible project first'}</span>}
    </div>
    <div className="mt-3 flex flex-wrap gap-2">{actions.map(([id, title]) => <button key={id} type="button" disabled={projectMode && !projectReady}
      onClick={() => onOpen(id)} className="rounded-xl border border-[var(--anka-violet)] bg-[var(--anka-violet-soft)] px-3 py-2 text-sm font-medium text-[var(--anka-violet)] hover:bg-[var(--anka-violet-soft)] disabled:cursor-not-allowed disabled:opacity-40">{title}</button>)}</div>
  </section>
}

function AssistantRunCard({ result, capability, projectName, matchingProject, workspace, decisionSaving, onConfirm, onReject, onViewAudit }) {
  return <article aria-label="Audited record tool result" className="rounded-2xl border border-violet-900/60 bg-violet-950/20 p-5">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs font-semibold uppercase tracking-wider text-violet-300">{labelize(capability)} · audited run</p>
      <p className="mt-1 text-xs text-slate-400">{projectName} · {result.provider} · {result.model} · Run {result.run_id}</p></div><button type="button" onClick={onViewAudit} className="rounded-lg border border-white/10 px-3 py-1.5 text-xs text-slate-300">Open AI Audit</button></div>
    <p className="mt-3 text-xs leading-5 text-slate-400">This result is displayed beside chat but is not saved as a conversation message. Its durable record is the audited AI run.</p>
    <pre className="mt-4 whitespace-pre-wrap font-sans text-sm leading-7 text-slate-200">{result.content}</pre>
    <SourceManifest manifest={result.context_manifest} />
    {result.proposed_action && <>{matchingProject
      ? <ProposalCard result={result} workspace={workspace} saving={decisionSaving} onConfirm={onConfirm} onReject={onReject} />
      : <p role="status" className="mt-4 rounded-xl border border-amber-800 bg-amber-950/30 p-3 text-xs text-amber-200">This proposal belongs to a different project. Reopen that project chat or Record tools to review it; confirmation is disabled in this context.</p>}</>}
  </article>
}
function ProposalCard({ result, workspace, saving, onConfirm, onReject }) {
  const action = result.proposed_action
  const workstream = workspace?.workstreams.find(item => item.id === action.params.workstream_id)
  return <article className="rounded-2xl border border-amber-800 bg-amber-950/20 p-5"><div className="flex justify-between gap-3"><div><p className="text-xs font-semibold uppercase tracking-wider text-amber-300">Human confirmation required</p><h3 className="mt-2 font-semibold">{labelize(action.type)} · {action.params.title}</h3><p className="mt-2 text-sm text-slate-400">{action.params.description || action.params.question || 'No additional description.'}</p><div className="mt-3 flex flex-wrap gap-2 text-xs text-slate-500"><span className="rounded-full bg-slate-900 px-2 py-1">{workstream?.name || 'Project-wide'}</span>{action.params.priority && <span className="rounded-full bg-slate-900 px-2 py-1">{labelize(action.params.priority)}</span>}</div></div><span className="h-fit rounded-full bg-amber-900 px-2 py-1 text-xs text-amber-200">{result.decision || 'Pending'}</span></div>{!result.decision && <div className="mt-5 flex gap-3"><button disabled={saving} onClick={onConfirm} className="rounded-xl bg-emerald-700 px-4 py-2 text-sm font-semibold disabled:opacity-50">Confirm and create record</button><button disabled={saving} onClick={onReject} className="rounded-xl border border-slate-700 px-4 py-2 text-sm text-slate-300 disabled:opacity-50">Reject proposal</button></div>}{result.createdRecordId && <p className="mt-4 text-xs text-emerald-300">Created canonical record {result.createdRecordId}</p>}</article>
}

function AuditView({ runs, projects, engagements, usage }) { return <main className="workspace-container space-y-6 workspace-page"><section className="grid gap-4 md:grid-cols-4"><Metric label="Completed runs" value={usage.runs} /><Metric label="Input tokens" value={usage.inputTokens.toLocaleString()} /><Metric label="Output tokens" value={usage.outputTokens.toLocaleString()} /><Metric label="Estimated cost" value={usage.cost ? `$${(usage.cost / 1_000_000).toFixed(4)}` : 'Not configured'} /></section><section className="overflow-hidden workspace-card"><div className="border-b border-[var(--anka-line)] p-5"><h2 className="font-semibold">Audited AI runs</h2><p className="mt-1 text-xs text-[var(--anka-muted)]">Your runs, or organization runs visible to authorized leadership through RLS.</p></div><div className="overflow-x-auto"><table className="w-full min-w-[1000px] text-left text-sm"><thead className="bg-[var(--anka-canvas)] text-xs uppercase tracking-wider text-[var(--anka-muted)]"><tr><th className="px-4 py-3">Time</th><th className="px-4 py-3">Capability</th><th className="px-4 py-3">Department</th><th className="px-4 py-3">Context</th><th className="px-4 py-3">Provider</th><th className="px-4 py-3">Usage</th><th className="px-4 py-3">Human decision</th><th className="px-4 py-3">Status</th></tr></thead><tbody>{runs.map(run => <tr key={run.id} className="border-t border-[var(--anka-line)]"><td className="px-4 py-3 text-xs text-[var(--anka-muted)]">{dateTime(run.created_at)}</td><td className="px-4 py-3">{labelize(run.capability)}</td><td className="px-4 py-3 text-[var(--anka-muted)]">{DEPARTMENT_LABELS[run.context_manifest?.department_id] || 'Legacy run'}</td><td className="px-4 py-3 text-[var(--anka-muted)]">{engagements.get(run.engagement_id)?.name || projects.get(run.project_id)?.name || 'My work'}</td><td className="px-4 py-3 text-[var(--anka-muted)]">{run.provider ? `${run.provider} · ${run.model}` : '—'}</td><td className="px-4 py-3 text-xs text-[var(--anka-muted)]">{Number(run.input_tokens || 0) + Number(run.output_tokens || 0)} tokens</td><td className="px-4 py-3"><Badge value={run.human_decision} /></td><td className="px-4 py-3"><Badge value={run.status} /></td></tr>)}</tbody></table></div>{!runs.length && <div className="py-16 text-center text-sm text-[var(--anka-muted)]">No AI runs recorded yet.</div>}</section></main> }
function SourceManifest({ manifest }) { const records = manifest?.record_ids || {}; const reviewedMemory = [manifest?.project_memory, manifest?.policy_memory, manifest?.client_brand_memory, manifest?.department_memory].reduce((sum, rows) => sum + (Array.isArray(rows) ? rows.length : 0), 0); return <div className="mt-6 border-t border-slate-800 pt-4"><p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Authorized source manifest</p><div className="mt-2 flex flex-wrap gap-2"><span className="rounded-full bg-purple-950 px-2.5 py-1 text-xs text-purple-300">{DEPARTMENT_LABELS[manifest?.department_id] || 'Department not recorded'}</span>{reviewedMemory > 0 && <span className="rounded-full bg-slate-950 px-2.5 py-1 text-xs text-slate-500">Reviewed scoped memory · {reviewedMemory}</span>}{Object.entries(records).map(([type, ids]) => <span key={type} className="rounded-full bg-slate-950 px-2.5 py-1 text-xs text-slate-500">{labelize(type)} · {ids.length}</span>)}</div></div> }
function Usage({ usage }) { return <div className="text-right text-[11px] text-slate-600"><p>{Number(usage?.input_tokens || 0) + Number(usage?.output_tokens || 0)} tokens</p><p>{usage?.estimated_cost_microusd === null ? 'Cost rate not configured' : `$${(Number(usage?.estimated_cost_microusd || 0) / 1_000_000).toFixed(4)}`}</p></div> }
function Metric({ label, value }) { return <div className="workspace-card p-5"><p className="text-2xl font-semibold">{value}</p><p className="mt-1 text-xs uppercase tracking-wider text-[var(--anka-muted)]">{label}</p></div> }
function Badge({ value }) { return <span className="rounded-full bg-[var(--anka-surface-raised)] px-2 py-1 text-xs text-[var(--anka-ink)]">{labelize(value)}</span> }
function Field({ label, children }) { return <label><span className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-[var(--anka-muted)]">{label}</span>{children}</label> }
function placeholder(capability) { return ({ project_pulse: 'Focus on launch readiness and current blockers…', daily_brief: 'Optional focus for today…', research_support: 'What do we know about this audience, market, or decision?', writing_support: 'Draft the homepage messaging using approved project context…', quality_review: 'Paste the work to review and state what it should achieve…', action_proposal: 'Create a high-priority internal task to review the homepage against the approved brief…' })[capability] }
