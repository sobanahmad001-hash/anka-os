import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { DEPARTMENT_LABELS } from '../config/connectorCatalog.js'
import { useAuth } from '../context/AuthContext.jsx'
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
const INPUT = 'w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm text-white outline-none focus:border-purple-500'
const labelize = value => String(value || '').replaceAll('_', ' ').replace(/\b\w/g, letter => letter.toUpperCase())
const dateTime = value => new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))

export default function AnkaAssistant() {
  const { user, profile } = useAuth()
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
  const [activeTab, setActiveTab] = useState('assistant')
  const [loading, setLoading] = useState(true)
  const [running, setRunning] = useState(false)
  const [decisionSaving, setDecisionSaving] = useState(false)
  const [error, setError] = useState('')
  const engagementId = useMemo(
    () => engagements.find(engagement => engagement.project_id === projectId)?.id || '',
    [engagements, projectId],
  )

  useEffect(() => { load() }, [])
  useEffect(() => {
    if (!departmentId && DEPARTMENT_LABELS[profile?.department]) setDepartmentId(profile.department)
  }, [departmentId, profile?.department])
  useEffect(() => {
    if (!projectId) return setWorkspace(null)
    setWorkspace(null)
    delivery.getProjectWorkspace(projectId).then((nextWorkspace) => {
      setWorkspace(nextWorkspace)
      const availableDepartments = [...new Set(nextWorkspace.workstreams.map(item => item.department_id).filter(id => DEPARTMENT_LABELS[id]))]
      setDepartmentId(current => availableDepartments.includes(current) ? current : availableDepartments[0] || '')
    }).catch(loadError => setError(loadError.message))
  }, [projectId])
  useEffect(() => {
    if (!engagementId) return setEngagementWorkspace(null)
    setEngagementWorkspace(null)
    operatingSpine.getEngagement(engagementId).then((nextWorkspace) => {
      setEngagementWorkspace(nextWorkspace)
      const availableDepartments = [...new Set(nextWorkspace.services.map(item => item.service_catalog?.department_id).filter(id => DEPARTMENT_LABELS[id]))]
      setDepartmentId(current => availableDepartments.includes(current) ? current : availableDepartments[0] || '')
    }).catch(loadError => setError(loadError.message))
  }, [engagementId])

  async function load() {
    setLoading(true)
    setError('')
    try {
      const [projectRows, engagementRows, runRows] = await Promise.all([
        delivery.listProjects(), operatingSpine.listEngagements(), aiRepository.listRuns(),
      ])
      setProjects(projectRows)
      setEngagements(engagementRows)
      setRuns(runRows)
      setProjectId(current => current || engagementRows[0]?.project_id || projectRows[0]?.id || '')
    } catch (loadError) {
      setError(loadError.message)
    } finally {
      setLoading(false)
    }
  }

  async function runAssistant(event) {
    event.preventDefault()
    if (!projectId && capability !== 'daily_brief') return setError('Select a project for this capability.')
    setRunning(true)
    setError('')
    setResult(null)
    try {
      if (!departmentId) return setError('Select an operating department.')
      const response = await aiRepository.run({ capability, projectId: projectId || null, engagementId: engagementId || null, departmentId, input })
      setResult(response)
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
    if (!action || !user?.id || !workspace) return
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
      setWorkspace(await delivery.getProjectWorkspace(projectId))
      await refreshRuns()
    } catch (decisionError) {
      setError(decisionError.message)
    } finally {
      setDecisionSaving(false)
    }
  }

  async function refreshRuns() { setRuns(await aiRepository.listRuns()) }

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

  if (loading) return <div className="flex h-full items-center justify-center bg-slate-950"><div className="h-8 w-8 animate-spin rounded-full border-b-2 border-purple-500" /></div>

  return <div className="min-h-full bg-slate-950 text-white">
    <header className="border-b border-slate-800 bg-gradient-to-r from-purple-950/50 to-slate-950 px-6 py-6"><div className="mx-auto flex max-w-7xl flex-wrap items-end justify-between gap-4"><div><p className="text-xs font-semibold uppercase tracking-[0.18em] text-purple-400">Human-controlled intelligence</p><h1 className="mt-1 text-2xl font-semibold">Anka AI Assistant</h1><p className="mt-1 text-sm text-slate-400">Permission-scoped project support with source manifests, cost tracking, and audited human decisions.</p></div><div className="flex gap-2"><button onClick={() => setActiveTab('assistant')} className={`rounded-xl px-4 py-2 text-sm ${activeTab === 'assistant' ? 'bg-purple-600' : 'bg-slate-800 text-slate-400'}`}>Assistant</button><button onClick={() => setActiveTab('audit')} className={`rounded-xl px-4 py-2 text-sm ${activeTab === 'audit' ? 'bg-purple-600' : 'bg-slate-800 text-slate-400'}`}>AI Audit</button></div></div></header>
    <div className="border-b border-amber-900/50 bg-amber-950/20 px-6 py-3 text-center text-xs text-amber-300">AI can analyze, draft, review, and propose. It cannot approve, publish, deploy, launch spend, change scope, or act without your confirmation.</div>
    {error && <div className="mx-auto mt-4 max-w-7xl rounded-xl border border-red-900 bg-red-950/50 px-4 py-3 text-sm text-red-300">{error}</div>}

    {activeTab === 'assistant' ? <main className="mx-auto grid max-w-7xl gap-6 p-6 xl:grid-cols-[360px_1fr]">
      <form onSubmit={runAssistant} className="h-fit space-y-5 rounded-2xl border border-slate-800 bg-slate-900/70 p-5"><div><h2 className="font-semibold">Request assistance</h2><p className="mt-1 text-xs text-slate-500">The server retrieves the canonical project plus its Operating Spine extension, when present, and uses the verified connector mapped to the selected department.</p></div><Field label="Capability"><div className="space-y-2">{CAPABILITIES.map(([id, label, description]) => <button type="button" disabled={id === 'action_proposal' && !workspace?.workstreams?.length} key={id} onClick={() => setCapability(id)} className={`w-full rounded-xl border p-3 text-left disabled:cursor-not-allowed disabled:opacity-40 ${capability === id ? 'border-purple-600 bg-purple-950/40' : 'border-slate-800 bg-slate-950/40'}`}><p className="text-sm font-medium">{label}</p><p className="mt-1 text-xs text-slate-500">{description}</p></button>)}</div></Field><Field label="Project context"><select className={INPUT} value={projectId} onChange={event => setProjectId(event.target.value)}><option value="">My work only</option>{projects.map(project => <option key={project.id} value={project.id}>{project.name}</option>)}</select></Field>{engagementId && <p className="rounded-xl border border-violet-900/60 bg-violet-950/20 px-3 py-2 text-xs text-violet-300">Operating Spine services and artifacts are included automatically.</p>}<Field label="Operating department"><select required className={INPUT} value={departmentId} onChange={event => setDepartmentId(event.target.value)}><option value="">Select department</option>{departmentOptions.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></Field><Field label={capability === 'project_pulse' ? 'Specific focus (optional)' : 'Request'}><textarea className={INPUT} rows="5" value={input} onChange={event => setInput(event.target.value)} placeholder={placeholder(capability)} /></Field><button disabled={running || !departmentId || (projectId && !workspace) || (engagementId && !engagementWorkspace) || (!projectId && capability !== 'daily_brief')} className="w-full rounded-xl bg-purple-600 px-4 py-2.5 text-sm font-semibold disabled:opacity-50">{running ? 'Analyzing authorized context…' : `Run ${selectedCapability?.[1]}`}</button></form>

      <section className="min-w-0 space-y-5">{result ? <><article className="rounded-2xl border border-slate-800 bg-slate-900/70 p-6"><div className="flex flex-wrap items-center justify-between gap-3"><div><p className="text-xs font-semibold uppercase tracking-wider text-purple-400">{labelize(capability)}</p><p className="mt-1 text-xs text-slate-600">{DEPARTMENT_LABELS[result.department_id] || labelize(result.department_id)} · {result.provider} · {result.model} · Run {result.run_id}</p></div><Usage usage={result.usage} /></div><pre className="mt-5 whitespace-pre-wrap font-sans text-sm leading-7 text-slate-200">{result.content}</pre><SourceManifest manifest={result.context_manifest} /></article>{result.proposed_action && <ProposalCard result={result} workspace={workspace} saving={decisionSaving} onConfirm={confirmProposal} onReject={rejectProposal} />}</> : <div className="flex min-h-[540px] items-center justify-center rounded-2xl border border-dashed border-slate-800 bg-slate-900/30 p-8 text-center"><div><div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-purple-600 text-2xl font-bold">A</div><h2 className="mt-5 text-lg font-semibold">Select a capability, project, and department</h2><p className="mx-auto mt-2 max-w-lg text-sm leading-6 text-slate-500">Anka will use canonical tasks, research, deliverables, requests, the Living Project Record, and the verified connector assigned to that department. Record IDs and connector scope are preserved in the audit manifest.</p></div></div>}</section>
    </main> : <AuditView runs={runs} projects={projectById} engagements={engagementById} usage={usage} />}
  </div>
}

function ProposalCard({ result, workspace, saving, onConfirm, onReject }) {
  const action = result.proposed_action
  const workstream = workspace?.workstreams.find(item => item.id === action.params.workstream_id)
  return <article className="rounded-2xl border border-amber-800 bg-amber-950/20 p-5"><div className="flex justify-between gap-3"><div><p className="text-xs font-semibold uppercase tracking-wider text-amber-300">Human confirmation required</p><h3 className="mt-2 font-semibold">{labelize(action.type)} · {action.params.title}</h3><p className="mt-2 text-sm text-slate-400">{action.params.description || action.params.question || 'No additional description.'}</p><div className="mt-3 flex flex-wrap gap-2 text-xs text-slate-500"><span className="rounded-full bg-slate-900 px-2 py-1">{workstream?.name || 'Project-wide'}</span>{action.params.priority && <span className="rounded-full bg-slate-900 px-2 py-1">{labelize(action.params.priority)}</span>}</div></div><span className="h-fit rounded-full bg-amber-900 px-2 py-1 text-xs text-amber-200">{result.decision || 'Pending'}</span></div>{!result.decision && <div className="mt-5 flex gap-3"><button disabled={saving} onClick={onConfirm} className="rounded-xl bg-emerald-700 px-4 py-2 text-sm font-semibold disabled:opacity-50">Confirm and create record</button><button disabled={saving} onClick={onReject} className="rounded-xl border border-slate-700 px-4 py-2 text-sm text-slate-300 disabled:opacity-50">Reject proposal</button></div>}{result.createdRecordId && <p className="mt-4 text-xs text-emerald-300">Created canonical record {result.createdRecordId}</p>}</article>
}

function AuditView({ runs, projects, engagements, usage }) { return <main className="mx-auto max-w-7xl space-y-6 p-6"><section className="grid gap-4 md:grid-cols-4"><Metric label="Completed runs" value={usage.runs} /><Metric label="Input tokens" value={usage.inputTokens.toLocaleString()} /><Metric label="Output tokens" value={usage.outputTokens.toLocaleString()} /><Metric label="Estimated cost" value={usage.cost ? `$${(usage.cost / 1_000_000).toFixed(4)}` : 'Not configured'} /></section><section className="overflow-hidden rounded-2xl border border-slate-800 bg-slate-900/70"><div className="border-b border-slate-800 p-5"><h2 className="font-semibold">Audited AI runs</h2><p className="mt-1 text-xs text-slate-500">Your runs, or organization runs visible to authorized leadership through RLS.</p></div><div className="overflow-x-auto"><table className="w-full min-w-[1000px] text-left text-sm"><thead className="bg-slate-950/70 text-xs uppercase tracking-wider text-slate-500"><tr><th className="px-4 py-3">Time</th><th className="px-4 py-3">Capability</th><th className="px-4 py-3">Department</th><th className="px-4 py-3">Context</th><th className="px-4 py-3">Provider</th><th className="px-4 py-3">Usage</th><th className="px-4 py-3">Human decision</th><th className="px-4 py-3">Status</th></tr></thead><tbody>{runs.map(run => <tr key={run.id} className="border-t border-slate-800"><td className="px-4 py-3 text-xs text-slate-500">{dateTime(run.created_at)}</td><td className="px-4 py-3">{labelize(run.capability)}</td><td className="px-4 py-3 text-slate-400">{DEPARTMENT_LABELS[run.context_manifest?.department_id] || 'Legacy run'}</td><td className="px-4 py-3 text-slate-400">{engagements.get(run.engagement_id)?.name || projects.get(run.project_id)?.name || 'My work'}</td><td className="px-4 py-3 text-slate-400">{run.provider ? `${run.provider} · ${run.model}` : '—'}</td><td className="px-4 py-3 text-xs text-slate-500">{Number(run.input_tokens || 0) + Number(run.output_tokens || 0)} tokens</td><td className="px-4 py-3"><Badge value={run.human_decision} /></td><td className="px-4 py-3"><Badge value={run.status} /></td></tr>)}</tbody></table></div>{!runs.length && <div className="py-16 text-center text-sm text-slate-500">No AI runs recorded yet.</div>}</section></main> }
function SourceManifest({ manifest }) { const records = manifest?.record_ids || {}; return <div className="mt-6 border-t border-slate-800 pt-4"><p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Authorized source manifest</p><div className="mt-2 flex flex-wrap gap-2"><span className="rounded-full bg-purple-950 px-2.5 py-1 text-xs text-purple-300">{DEPARTMENT_LABELS[manifest?.department_id] || 'Department not recorded'}</span>{Object.entries(records).map(([type, ids]) => <span key={type} className="rounded-full bg-slate-950 px-2.5 py-1 text-xs text-slate-500">{labelize(type)} · {ids.length}</span>)}</div></div> }
function Usage({ usage }) { return <div className="text-right text-[11px] text-slate-600"><p>{Number(usage?.input_tokens || 0) + Number(usage?.output_tokens || 0)} tokens</p><p>{usage?.estimated_cost_microusd === null ? 'Cost rate not configured' : `$${(Number(usage?.estimated_cost_microusd || 0) / 1_000_000).toFixed(4)}`}</p></div> }
function Metric({ label, value }) { return <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5"><p className="text-2xl font-semibold">{value}</p><p className="mt-1 text-xs uppercase tracking-wider text-slate-500">{label}</p></div> }
function Badge({ value }) { return <span className="rounded-full bg-slate-800 px-2 py-1 text-xs text-slate-300">{labelize(value)}</span> }
function Field({ label, children }) { return <label><span className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-slate-400">{label}</span>{children}</label> }
function placeholder(capability) { return ({ project_pulse: 'Focus on launch readiness and current blockers…', daily_brief: 'Optional focus for today…', research_support: 'What do we know about this audience, market, or decision?', writing_support: 'Draft the homepage messaging using approved project context…', quality_review: 'Paste the work to review and state what it should achieve…', action_proposal: 'Create a high-priority internal task to review the homepage against the approved brief…' })[capability] }
