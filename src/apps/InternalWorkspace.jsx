import { useCallback, useEffect, useRef, useState } from 'react'
import { useOrganization } from '../context/OrganizationContext.jsx'
import { useNavigate } from 'react-router-dom'
import { internalWorkspace } from '../data/internalWorkspace'

const TABS = [['overview', 'Overview'], ['tasks', 'Project Tasks'], ['engagement-work', 'Engagement Work Items'], ['coordination', 'Milestones & Requests'], ['deliverables', 'Deliverables'], ['records', 'Activity & Records']]
const label = (value) => value ? value.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase()) : 'Unknown'
const date = (value) => value ? new Date(`${value.slice(0, 10)}T00:00:00Z`).toLocaleDateString() : 'No date'

export default function InternalWorkspace() {
  const navigate = useNavigate()

  const { activeOrganizationId, selectionRequired, loading: organizationLoading, scopeRevision, requestSignal, handleOrganizationAccessError } = useOrganization()
  const currentRequest = useRef(null)
  currentRequest.current = { organizationId: activeOrganizationId, revision: scopeRevision, recordId: null }
  const requestGeneration = useRef(0)
  const [workspace, setWorkspace] = useState(null)
  const [tab, setTab] = useState('overview')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const load = useCallback(async () => {
    if (organizationLoading || selectionRequired || !activeOrganizationId || requestSignal?.aborted) return
    const scope = currentRequest.current
    const generation = ++requestGeneration.current
    const isCurrent = () => generation === requestGeneration.current && !requestSignal?.aborted
      && scope.organizationId === currentRequest.current.organizationId
      && scope.revision === currentRequest.current.revision
      && scope.recordId === currentRequest.current.recordId
    setLoading(true)
    setError('')
    try {
      const result = await internalWorkspace.get(activeOrganizationId, { signal: requestSignal })
      if (isCurrent()) setWorkspace(result)
    } catch (cause) {
      if (isCurrent() && cause.name !== 'AbortError' && cause.cause?.name !== 'AbortError') {
        handleOrganizationAccessError(cause, { membershipMismatch: cause.membershipMismatch })
        setError(cause.message || 'Unable to load this workspace.')
      }
    } finally {
      if (isCurrent()) setLoading(false)
    }
  }, [activeOrganizationId, handleOrganizationAccessError, organizationLoading, requestSignal, scopeRevision, selectionRequired])

  useEffect(() => {
    setWorkspace(null)
    setTab('overview')
    setError('')
    setLoading(true)
    load()
    return () => { requestGeneration.current += 1 }
  }, [load])

  if (loading && !workspace) return <State>Loading Internal Work…</State>
  if (!workspace) return <State error={error}>Internal Work is unavailable.</State>
  const { summary } = workspace
  return <main className="min-h-full bg-[#090c13] p-4 text-slate-100 sm:p-6 lg:p-8"><div className="mx-auto max-w-[1600px]">
    <header className="flex flex-wrap items-start justify-between gap-5"><div><p className="text-xs font-semibold uppercase tracking-[0.2em] text-amber-300">Coordination</p><h1 className="mt-2 text-3xl font-semibold tracking-tight">Internal Work</h1><p className="mt-2 max-w-3xl text-sm leading-6 text-slate-400">Canonical projects explicitly classified as internal. Project Tasks remain separate from any legitimate Engagement Work Items.</p></div><button type="button" onClick={load} disabled={loading} className="rounded-xl border border-white/10 px-4 py-2 text-sm disabled:opacity-50">{loading ? 'Refreshing…' : 'Refresh'}</button></header>
    {error && <div role="alert" className="mt-5 rounded-xl border border-rose-500/25 bg-rose-500/10 p-4 text-sm text-rose-200">{error}</div>}
    <section aria-label="Internal Work summary" className="mt-7 grid gap-3 sm:grid-cols-2 xl:grid-cols-7"><Metric title="Active projects" value={summary.activeProjects} /><Metric title="Project Tasks" value={summary.openProjectTasks} /><Metric title="Engagement Work Items" value={summary.openEngagementWorkItems} /><Metric title="Milestones" value={summary.openMilestones} /><Metric title="Requests" value={summary.openRequests} /><Metric title="Deliverables" value={summary.activeDeliverables} /><Metric title="Living Records" value={summary.livingRecords} /></section>
    <nav aria-label="Internal Work sections" className="mt-7 flex gap-1 overflow-x-auto border-b border-white/[0.08]">{TABS.map(([id, title]) => <button type="button" key={id} onClick={() => setTab(id)} className={`whitespace-nowrap border-b-2 px-3 py-3 text-sm font-medium ${tab === id ? 'border-amber-400 text-white' : 'border-transparent text-slate-500 hover:text-slate-200'}`}>{title}</button>)}</nav>
    <div className="mt-6">{tab === 'overview' && <Overview workspace={workspace} navigate={navigate} />}{tab === 'tasks' && <WorkList title="Project Tasks" description="Canonical project-level planning and execution tasks." rows={workspace.projects.flatMap((project) => project.projectTasks.map((row) => ({ ...row, projectName: project.name })))} />}{tab === 'engagement-work' && <EngagementWork projects={workspace.projects} />}{tab === 'coordination' && <Coordination projects={workspace.projects} />}{tab === 'deliverables' && <Deliverables projects={workspace.projects} />}{tab === 'records' && <Records workspace={workspace} />}</div>
  </div></main>
}

function Overview({ workspace, navigate }) {
  return <div className="grid gap-5 xl:grid-cols-[1.4fr_1fr]"><Panel title="Internal projects" description="Membership requires projects.engagement_type = 'internal'; a missing client alone is never enough."><RecordList rows={workspace.projects} empty="No canonical Internal Work projects." render={(project) => <button type="button" key={project.id} onClick={() => navigate(`/sphere/workspace/projects/${project.id}`)} className="w-full text-left"><Record title={project.name} note={`${project.owner.name} · Due ${date(project.due_date)} · ${project.workstreams.length} workstreams`} status={project.status} /></button>} /></Panel><div className="space-y-5"><Panel title="Due work"><RecordList rows={workspace.dueWork.slice(0, 8)} empty="No open dated work." render={(item) => <Record key={`${item.source}-${item.id}`} title={item.title} note={`${item.source} · ${item.projectName} · ${date(item.date)}`} status={item.status} attention={item.overdue} />} /></Panel><Panel title="Attention"><RecordList rows={workspace.projects.flatMap((project) => project.attentionSignals.map((signal) => `${project.name}: ${signal}`))} empty="No current attention signals." render={(signal) => <p key={signal} className="rounded-xl border border-amber-500/15 bg-amber-500/[0.05] px-3 py-2 text-sm text-amber-200">{signal}</p>} /></Panel></div></div>
}

function WorkList({ title, description, rows }) { return <Panel title={title} description={description}><RecordList rows={rows} empty={`No ${title} recorded.`} render={(item) => <Record key={item.id} title={item.title} note={`${item.projectName} · ${item.owner.name} · Due ${date(item.due_date)}`} status={item.status} attention={item.overdue} />} /></Panel> }

function EngagementWork({ projects }) {
  const rows = projects.flatMap((project) => project.engagementWorkItems.map((row) => ({ ...row, projectName: project.name })))
  return <Panel title="Engagement Work Items" description="Shown only when an Internal Work project has a valid existing engagement extension. No extension is synthesized."><RecordList rows={rows} empty="No legitimate engagement extension or Engagement Work Items apply to Internal Work." render={(item) => <Record key={item.id} title={item.title} note={`${item.projectName} · ${item.owner.name} · Due ${date(item.due_date)}`} status={item.status} attention={item.overdue} />} /></Panel>
}

function Coordination({ projects }) {
  const milestones = projects.flatMap((project) => project.milestones.map((row) => ({ ...row, projectName: project.name })))
  const requests = projects.flatMap((project) => project.requests.map((row) => ({ ...row, projectName: project.name })))
  return <div className="grid gap-5 xl:grid-cols-2"><Panel title="Milestones"><RecordList rows={milestones} empty="No milestones recorded." render={(item) => <Record key={item.id} title={item.name} note={`${item.projectName} · Target ${date(item.target_date)}`} status={item.status} attention={item.overdue} />} /></Panel><Panel title="Requests"><RecordList rows={requests} empty="No requests recorded." render={(item) => <Record key={item.id} title={item.title} note={`${item.projectName} · ${label(item.request_type)} · Required ${date(item.required_by)}`} status={item.status} attention={item.overdue} />} /></Panel></div>
}

function Deliverables({ projects }) {
  const rows = projects.flatMap((project) => project.deliverables.map((row) => ({ ...row, projectName: project.name })))
  return <Panel title="Deliverables"><RecordList rows={rows} empty="No deliverables recorded." render={(item) => <Record key={item.id} title={item.title} note={`${item.projectName} · ${label(item.deliverable_type)} · Due ${date(item.due_date)}`} status={item.status} attention={item.overdue} />} /></Panel>
}

function Records({ workspace }) {
  return <div className="grid gap-5 xl:grid-cols-[1.2fr_1fr]"><Panel title="Recent activity"><RecordList rows={workspace.activity} empty="No activity recorded." render={(item) => <Record key={item.id} title={label(item.action)} note={`${item.actor.name} · ${new Date(item.occurred_at).toLocaleString()}`} />} /></Panel><Panel title="Living Records"><RecordList rows={workspace.projects} empty="No Internal Work projects." render={(project) => project.livingRecord ? <Record key={project.id} title={project.name} note={`Source version ${project.livingRecord.source_version} · Updated ${new Date(project.livingRecord.updated_at).toLocaleString()}`} status="available" /> : <Record key={project.id} title={project.name} note="No generated Living Record yet." status="not_generated" />} /></Panel></div>
}

function Panel({ title, description, children }) { return <section className="rounded-2xl border border-white/[0.07] bg-white/[0.025] p-5"><h2 className="font-semibold">{title}</h2>{description && <p className="mt-1 text-xs leading-5 text-slate-500">{description}</p>}<div className="mt-4">{children}</div></section> }
function RecordList({ rows, empty, render }) { return rows.length ? <div className="space-y-3">{rows.map(render)}</div> : <p className="text-sm text-slate-500">{empty}</p> }
function Record({ title, note, status, attention = false }) { return <div className={`flex items-start justify-between gap-3 rounded-xl border p-3 ${attention ? 'border-amber-500/20 bg-amber-500/[0.04]' : 'border-white/[0.07] bg-black/10'}`}><div><p className="text-sm font-medium text-white">{title}</p><p className="mt-1 text-xs leading-5 text-slate-500">{note}</p></div>{status && <Status value={status} />}</div> }
function Metric({ title, value }) { return <div className="rounded-2xl border border-white/[0.07] bg-white/[0.025] p-4"><p className="text-xs text-slate-500">{title}</p><p className="mt-2 text-2xl font-semibold">{value}</p></div> }
function Status({ value }) { return <span className="shrink-0 rounded-full border border-white/10 bg-white/[0.03] px-2 py-1 text-[11px] text-slate-300">{label(value)}</span> }
function State({ children, error }) { return <main className="flex min-h-full items-center justify-center bg-[#090c13] p-6 text-center text-slate-400"><p className={error ? 'text-rose-300' : ''}>{error || children}</p></main> }
