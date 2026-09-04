import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useOrganization } from '../context/OrganizationContext.jsx'
import { Link, useNavigate } from 'react-router-dom'
import { internalWorkspace } from '../data/internalWorkspace'
import InternalProjectSetupPanel from './InternalProjectSetupPanel.jsx'

const TABS = [['overview', 'Overview'], ['tasks', 'Project Tasks'], ['engagement-work', 'Engagement Work Items'], ['coordination', 'Milestones & Requests'], ['deliverables', 'Deliverables'], ['records', 'Activity & Records']]
const INPUT = 'rounded-xl border border-white/10 bg-black/20 px-3 py-2.5 text-sm text-white outline-none focus:border-amber-400 focus:ring-2 focus:ring-amber-400/20'
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
  const [failureKind, setFailureKind] = useState('')
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState('all')
  const [ownerId, setOwnerId] = useState('all')
  const [showSetup, setShowSetup] = useState(false)
  const [setupResult, setSetupResult] = useState(null)
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
    setFailureKind('')
    try {
      const result = await internalWorkspace.get(activeOrganizationId, { signal: requestSignal })
      if (isCurrent()) setWorkspace(result)
    } catch (cause) {
      if (isCurrent() && cause.name !== 'AbortError' && cause.cause?.name !== 'AbortError') {
        handleOrganizationAccessError(cause, { membershipMismatch: cause.membershipMismatch })
        setError(cause.message || 'Unable to load this workspace.')
        setFailureKind(cause.membershipMismatch || cause.status === 409 ? 'stale' : [401, 403].includes(cause.status) ? 'denied' : 'error')
      }
    } finally {
      if (isCurrent()) setLoading(false)
    }
  }, [activeOrganizationId, handleOrganizationAccessError, organizationLoading, requestSignal, scopeRevision, selectionRequired])

  useEffect(() => {
    setWorkspace(null)
    setTab('overview')
    setError('')
    setFailureKind('')
    setQuery('')
    setStatus('all')
    setOwnerId('all')
    setShowSetup(false)
    setSetupResult(null)
    setLoading(true)
    load()
    return () => { requestGeneration.current += 1 }
  }, [load])

  const statuses = useMemo(() => [...new Set((workspace?.projects || []).map((row) => row.status).filter(Boolean))].sort(), [workspace])
  const owners = useMemo(() => [...new Map((workspace?.projects || []).map((row) => [row.owner.id || 'unassigned', row.owner])).entries()].sort((left, right) => left[1].name.localeCompare(right[1].name)), [workspace])
  const filteredProjects = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase()
    return (workspace?.projects || []).filter((project) => (!needle || [project.name, project.description, project.owner.name, ...project.workstreams.map((row) => row.name)].filter(Boolean).join(' ').toLocaleLowerCase().includes(needle))
      && (status === 'all' || project.status === status)
      && (ownerId === 'all' || (project.owner.id || 'unassigned') === ownerId))
  }, [ownerId, query, status, workspace])

  async function completeSetup(result) {
    setShowSetup(false)
    setSetupResult(result)
    await load()
  }

  if (organizationLoading) return <State title="Resolving organization">Internal Work will load after the active organization is confirmed.</State>
  if (selectionRequired || !activeOrganizationId) return <State title="Choose an organization">Internal Work never chooses or switches an organization from a link.</State>
  if (loading && !workspace) return <State title="Loading Internal Work">Loading authorized internal projects for the active organization.</State>
  if (!workspace) return <State title={failureKind === 'denied' ? 'Access denied' : failureKind === 'stale' ? 'Internal Work is stale' : 'Unable to load Internal Work'} error={error} action={load}>{failureKind === 'denied' ? 'You are not authorized to view Internal Work in the active organization.' : failureKind === 'stale' ? 'The response did not match the active organization. The organization was not changed.' : 'Internal Work is unavailable.'}</State>
  const { summary } = workspace
  const filteredProjectIds = new Set(filteredProjects.map((row) => row.id))
  const visibleWorkspace = { ...workspace, projects: filteredProjects, dueWork: workspace.dueWork.filter((row) => filteredProjectIds.has(row.project_id)), activity: workspace.activity.filter((row) => filteredProjectIds.has(row.project_id)) }
  return <main className="min-h-full bg-[#090c13] p-4 text-slate-100 sm:p-6 lg:p-8"><div className="mx-auto max-w-[1600px]">
    <DirectoryNavigation />
    <header className="mt-6 flex flex-wrap items-start justify-between gap-5"><div><p className="text-xs font-semibold uppercase tracking-[0.2em] text-amber-300">Workspace directory</p><h1 className="mt-2 text-3xl font-semibold tracking-tight">Internal Work</h1><p className="mt-2 max-w-3xl text-sm leading-6 text-slate-400">Canonical projects explicitly classified as internal. Project Tasks remain separate from any legitimate Engagement Work Items.</p></div><div className="flex flex-wrap gap-3"><button type="button" onClick={() => { setShowSetup(true); setSetupResult(null) }} disabled={loading || showSetup} className="rounded-xl bg-amber-300 px-4 py-2 text-sm font-semibold text-slate-950 outline-none focus:ring-2 focus:ring-amber-100 disabled:opacity-40">New Internal Work</button><button type="button" onClick={load} disabled={loading} className="rounded-xl border border-white/10 px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-amber-400 disabled:opacity-50">{loading ? 'Refreshing...' : 'Refresh'}</button></div></header>
    {error && <div role="alert" className="mt-5 rounded-xl border border-rose-500/25 bg-rose-500/10 p-4 text-sm text-rose-200">{error}</div>}
    {setupResult && <div role="status" className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-emerald-400/25 bg-emerald-500/10 p-4 text-sm text-emerald-100"><p>Internal Work created atomically with {setupResult.workstreams.length} initial workstream{setupResult.workstreams.length === 1 ? '' : 's'}{setupResult.idempotent_replay ? ' from the original confirmed request' : ''}.</p><button type="button" onClick={() => navigate(`/sphere/workspace/projects/${setupResult.project_id}`)} className="rounded-lg border border-emerald-200/20 px-3 py-2 font-medium outline-none focus:ring-2 focus:ring-emerald-300">Open project workspace</button></div>}
    {showSetup && <InternalProjectSetupPanel activeOrganization={activeOrganizationId} scopeRevision={scopeRevision} requestSignal={requestSignal} onCreated={completeSetup} onCancel={() => setShowSetup(false)} onAccessError={handleOrganizationAccessError} />}
    <section aria-label="Internal Work summary" className="mt-7 grid gap-3 sm:grid-cols-2 xl:grid-cols-7"><Metric title="Active projects" value={summary.activeProjects} /><Metric title="Project Tasks" value={summary.openProjectTasks} /><Metric title="Engagement Work Items" value={summary.openEngagementWorkItems} /><Metric title="Milestones" value={summary.openMilestones} /><Metric title="Requests" value={summary.openRequests} /><Metric title="Deliverables" value={summary.activeDeliverables} /><Metric title="Living Records" value={summary.livingRecords} /></section>
    <p className="mt-3 text-xs leading-5 text-slate-500">Counts cover all authorized, non-archived projects with engagement_type = internal in the active organization. Open counts exclude completed or cancelled records. Dates are stored due or target dates; overdue is evaluated against today.</p>
    <section aria-label="Filter Internal Work" className="mt-6 grid gap-3 rounded-2xl border border-white/[0.07] bg-white/[0.025] p-4 md:grid-cols-[minmax(0,1fr)_220px_220px]"><label className="text-xs font-semibold text-slate-400">Search projects, workstreams, or owners<input className={INPUT + ' mt-2 w-full'} value={query} onChange={(event) => setQuery(event.target.value)} type="search" placeholder="Search Internal Work" /></label><Filter title="Project status" value={status} onChange={setStatus} options={statuses.map((value) => [value, label(value)])} /><Filter title="Owner" value={ownerId} onChange={setOwnerId} options={owners.map(([id, owner]) => [id, owner.name])} /></section>
    <p className="mt-4 text-sm text-slate-500" aria-live="polite">Showing {filteredProjects.length} of {workspace.projects.length} internal projects.</p>
    <nav aria-label="Internal Work sections" className="mt-7 flex gap-1 overflow-x-auto border-b border-white/[0.08]">{TABS.map(([id, title]) => <button type="button" key={id} onClick={() => setTab(id)} className={`whitespace-nowrap border-b-2 px-3 py-3 text-sm font-medium ${tab === id ? 'border-amber-400 text-white' : 'border-transparent text-slate-500 hover:text-slate-200'}`}>{title}</button>)}</nav>
    <div className="mt-6">{tab === 'overview' && <Overview workspace={visibleWorkspace} navigate={navigate} />}{tab === 'tasks' && <WorkList title="Project Tasks" description="Canonical project-level planning and execution tasks." rows={filteredProjects.flatMap((project) => project.projectTasks.map((row) => ({ ...row, projectName: project.name })))} />}{tab === 'engagement-work' && <EngagementWork projects={filteredProjects} />}{tab === 'coordination' && <Coordination projects={filteredProjects} />}{tab === 'deliverables' && <Deliverables projects={filteredProjects} />}{tab === 'records' && <Records workspace={visibleWorkspace} />}</div>
    {workspace.projects.length > 0 && !filteredProjects.length && <Empty title="No matching Internal Work" note="Clear or change the local filters. The authorized directory was not changed." />}
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

function DirectoryNavigation() {
  return <nav aria-label="Work directories" className="flex flex-wrap gap-2"><Link to="/sphere/portfolio" className="rounded-xl border border-white/10 px-3 py-2 text-sm font-medium text-slate-400 outline-none hover:text-white focus:ring-2 focus:ring-amber-400">Company work</Link><Link to="/sphere/clients" className="rounded-xl border border-white/10 px-3 py-2 text-sm font-medium text-slate-400 outline-none hover:text-white focus:ring-2 focus:ring-amber-400">Client Work</Link><Link to="/sphere/internal" aria-current="page" className="rounded-xl border border-amber-400/40 bg-amber-500/15 px-3 py-2 text-sm font-medium text-amber-100 outline-none focus:ring-2 focus:ring-amber-400">Internal Work</Link></nav>
}
function Filter({ title, value, onChange, options }) { return <label className="text-xs font-semibold text-slate-400">{title}<select className={INPUT + ' mt-2 w-full'} value={value} onChange={(event) => onChange(event.target.value)}><option value="all">All</option>{options.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label> }
function Panel({ title, description, children }) { return <section className="rounded-2xl border border-white/[0.07] bg-white/[0.025] p-5"><h2 className="font-semibold">{title}</h2>{description && <p className="mt-1 text-xs leading-5 text-slate-500">{description}</p>}<div className="mt-4">{children}</div></section> }
function RecordList({ rows, empty, render }) { return rows.length ? <div className="space-y-3">{rows.map(render)}</div> : <p className="text-sm text-slate-500">{empty}</p> }
function Record({ title, note, status, attention = false }) { return <div className={`flex items-start justify-between gap-3 rounded-xl border p-3 ${attention ? 'border-amber-500/20 bg-amber-500/[0.04]' : 'border-white/[0.07] bg-black/10'}`}><div><p className="text-sm font-medium text-white">{title}</p><p className="mt-1 text-xs leading-5 text-slate-500">{note}</p></div>{status && <Status value={status} />}</div> }
function Metric({ title, value }) { return <div className="rounded-2xl border border-white/[0.07] bg-white/[0.025] p-4"><p className="text-xs text-slate-500">{title}</p><p className="mt-2 text-2xl font-semibold">{value}</p></div> }
function Status({ value }) { return <span className="shrink-0 rounded-full border border-white/10 bg-white/[0.03] px-2 py-1 text-[11px] text-slate-300">{label(value)}</span> }
function Empty({ title, note }) { return <div className="mt-5 rounded-2xl border border-dashed border-white/10 p-10 text-center"><p className="font-medium text-slate-300">{title}</p><p className="mt-2 text-sm text-slate-500">{note}</p></div> }
function State({ title, children, error, action }) { return <main className="flex min-h-full items-center justify-center bg-[#090c13] p-6 text-center text-slate-400"><div><p className={error ? 'font-medium text-rose-300' : 'font-medium text-slate-200'}>{title}</p><p className="mt-2 max-w-xl text-sm text-slate-500">{children}</p>{error && <p className="mt-2 text-xs text-rose-300">{error}</p>}{action && <button type="button" onClick={action} className="mt-4 rounded-xl border border-white/10 px-4 py-2 text-sm text-white outline-none focus:ring-2 focus:ring-amber-400">Try again</button>}</div></main> }
