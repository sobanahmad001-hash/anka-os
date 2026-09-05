import { useCallback, useEffect, useRef, useMemo, useState } from 'react'
import { useOrganization } from '../context/OrganizationContext.jsx'
import { useNavigate } from 'react-router-dom'
import { filterPortfolioRows, PORTFOLIO_DUE_FILTERS } from '../data/portfolioWorkspaceModel'
import { portfolioWorkspace } from '../data/portfolioWorkspace'

const label = (value) => value.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())
const metric = (title, value, note) => ({ title, value, note })

export default function PortfolioWorkspace({ initialOwnerKind = 'all' }) {
  const navigate = useNavigate()

  const { activeOrganizationId, selectionRequired, loading: organizationLoading, scopeRevision, requestSignal, handleOrganizationAccessError } = useOrganization()
  const currentRequest = useRef(null)
  currentRequest.current = { organizationId: activeOrganizationId, revision: scopeRevision, recordId: null }
  const requestGeneration = useRef(0)
  const [snapshot, setSnapshot] = useState(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [filters, setFilters] = useState({ ownerKind: initialOwnerKind, status: 'all', due: 'all', owner: 'all', sort: 'due' })

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
      const result = await portfolioWorkspace.getSnapshot(activeOrganizationId, { signal: requestSignal })
      if (isCurrent()) setSnapshot(result)
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
    setSnapshot(null)
    setFilters({ ownerKind: initialOwnerKind, status: 'all', due: 'all', owner: 'all', sort: 'due' })
    setError('')
    setLoading(true)
    load()
    return () => { requestGeneration.current += 1 }
  }, [load, initialOwnerKind])

  useEffect(() => { setFilters((current) => ({ ...current, ownerKind: initialOwnerKind })) }, [initialOwnerKind])

  const rows = useMemo(() => filterPortfolioRows(snapshot?.rows || [], { ...filters, today: snapshot?.today }), [snapshot, filters])
  const statuses = useMemo(() => [...new Set((snapshot?.rows || []).map((row) => row.status))].sort(), [snapshot])
  const owners = useMemo(() => {
    const unique = new Map((snapshot?.rows || []).map((row) => [row.owner.id || 'unassigned', row.owner.name]))
    return [...unique].sort((a, b) => a[1].localeCompare(b[1]))
  }, [snapshot])
  const metrics = snapshot ? [
    metric('Active projects', snapshot.summary.activeProjects, 'Canonical project records'),
    metric('Client Work', snapshot.summary.clientWork, 'Non-internal projects'),
    metric('Internal Work', snapshot.summary.internalWork, "engagement_type = 'internal'"),
    metric('Project Tasks', snapshot.summary.openProjectTasks, 'Open project-level tasks'),
    metric('Engagement Work Items', snapshot.summary.openEngagementWorkItems, 'Open delivery work items'),
    metric('Awaiting review', snapshot.summary.awaitingReview, 'Deliverable versions'),
  ] : []

  const updateFilter = (key) => (event) => setFilters((current) => ({ ...current, [key]: event.target.value }))

  return (
    <main className="min-h-full bg-[#090c13] p-4 text-slate-100 sm:p-6 lg:p-8">
      <div className="mx-auto max-w-[1600px]">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-violet-300">Coordination</p>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight">Portfolio Workspace</h1>
            <p className="mt-2 max-w-3xl text-sm text-slate-400">A read-only, project-root view of Client Work and Internal Work. Project Tasks and Engagement Work Items remain separate.</p>
          </div>
          <button type="button" onClick={load} disabled={loading} className="rounded-xl border border-white/10 bg-white/[0.04] px-4 py-2 text-sm font-medium text-slate-200 hover:bg-white/[0.08] disabled:opacity-50">{loading ? 'Refreshing…' : 'Refresh'}</button>
        </div>

        {error && <div role="alert" className="mt-6 rounded-2xl border border-rose-500/25 bg-rose-500/10 p-4 text-sm text-rose-200">{error}</div>}
        {loading && !snapshot && <div className="mt-8 rounded-2xl border border-white/[0.07] bg-white/[0.025] p-10 text-center text-sm text-slate-400">Loading live portfolio data…</div>}

        {snapshot && <>
          <section aria-label="Portfolio summary" className="mt-7 grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
            {metrics.map((item) => <div key={item.title} className="rounded-2xl border border-white/[0.07] bg-white/[0.025] p-4"><p className="text-xs text-slate-500">{item.title}</p><p className="mt-2 text-2xl font-semibold">{item.value}</p><p className="mt-1 text-[11px] text-slate-600">{item.note}</p></div>)}
          </section>

          <PortfolioFilters filters={filters} statuses={statuses} owners={owners} updateFilter={updateFilter} />
          <DepartmentLoad rows={snapshot.departmentLoad} />
          <PortfolioTable rows={rows} navigate={navigate} />
        </>}
      </div>
    </main>
  )
}

function PortfolioFilters({ filters, statuses, owners, updateFilter }) {
  const selectClass = 'rounded-xl border border-white/10 bg-[#111622] px-3 py-2 text-sm text-slate-200'
  return (
    <section aria-label="Portfolio filters" className="mt-6 grid gap-3 rounded-2xl border border-white/[0.07] bg-white/[0.02] p-4 sm:grid-cols-2 xl:grid-cols-5">
      <Filter label="Work type"><select className={selectClass} value={filters.ownerKind} onChange={updateFilter('ownerKind')}><option value="all">All work</option><option value="client">Client Work</option><option value="internal">Internal Work</option></select></Filter>
      <Filter label="Status"><select className={selectClass} value={filters.status} onChange={updateFilter('status')}><option value="all">All statuses</option>{statuses.map((status) => <option key={status} value={status}>{label(status)}</option>)}</select></Filter>
      <Filter label="Due"><select className={selectClass} value={filters.due} onChange={updateFilter('due')}>{PORTFOLIO_DUE_FILTERS.map((due) => <option key={due} value={due}>{due === 'all' ? 'All due dates' : label(due)}</option>)}</select></Filter>
      <Filter label="Owner"><select className={selectClass} value={filters.owner} onChange={updateFilter('owner')}><option value="all">All owners</option>{owners.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></Filter>
      <Filter label="Sort"><select className={selectClass} value={filters.sort} onChange={updateFilter('sort')}><option value="due">Due date</option><option value="name">Name</option><option value="status">Status</option><option value="owner">Owner</option></select></Filter>
    </section>
  )
}

function Filter({ label: title, children }) {
  return <label className="flex min-w-0 flex-col gap-1.5 text-xs font-medium text-slate-500"><span>{title}</span>{children}</label>
}

function DepartmentLoad({ rows }) {
  if (!rows.length) return null
  return (
    <section className="mt-6 rounded-2xl border border-white/[0.07] bg-white/[0.02] p-4">
      <h2 className="text-sm font-semibold">Department load</h2>
      <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {rows.map((row) => <div key={row.department} className="rounded-xl border border-white/[0.06] bg-black/10 p-3"><p className="text-sm font-medium">{label(row.department)}</p><p className="mt-2 text-xs text-slate-500">{row.projects} projects</p><div className="mt-2 flex flex-wrap gap-2 text-[11px]"><span className="rounded-full bg-sky-500/10 px-2 py-1 text-sky-300">{row.projectTasks} Project Tasks</span><span className="rounded-full bg-violet-500/10 px-2 py-1 text-violet-300">{row.engagementWorkItems} Engagement Work Items</span></div></div>)}
      </div>
    </section>
  )
}

function PortfolioTable({ rows, navigate }) {
  return (
    <section className="mt-6 overflow-hidden rounded-2xl border border-white/[0.07] bg-white/[0.02]">
      <div className="flex items-center justify-between border-b border-white/[0.07] px-4 py-3"><h2 className="text-sm font-semibold">Projects</h2><span className="text-xs text-slate-500">{rows.length} shown</span></div>
      {!rows.length ? <p className="p-10 text-center text-sm text-slate-500">No projects match these filters.</p> : <div className="overflow-x-auto"><table className="min-w-full text-left text-sm"><thead className="bg-white/[0.025] text-[11px] uppercase tracking-wide text-slate-500"><tr><th className="px-4 py-3">Project</th><th className="px-4 py-3">Status</th><th className="px-4 py-3">Owner / due</th><th className="px-4 py-3">Project Tasks</th><th className="px-4 py-3">Engagement Work Items</th><th className="px-4 py-3">Attention signals</th></tr></thead><tbody className="divide-y divide-white/[0.06]">{rows.map((row) => <ProjectRow key={row.id} row={row} navigate={navigate} />)}</tbody></table></div>}
    </section>
  )
}

function ProjectRow({ row, navigate }) {
  const taskText = `${row.projectTasks.open} open · ${row.projectTasks.blocked} blocked · ${row.projectTasks.overdue} overdue`
  const itemText = `${row.engagementWorkItems.open} open · ${row.engagementWorkItems.blocked} blocked · ${row.engagementWorkItems.overdue} overdue`
  return <tr className="align-top text-slate-300"><td className="px-4 py-4"><div className="font-medium text-white">{row.name}</div><div className="mt-1 text-xs text-slate-500">{row.ownerKind === 'internal' ? 'Internal Work' : `Client Work${row.clientName ? ` · ${row.clientName}` : ''}`}{row.brandName ? ` · ${row.brandName}` : ''}</div><button type="button" onClick={() => navigate(`/sphere/workspace/projects/${row.id}`)} className="mt-2 text-xs font-medium text-violet-300 hover:text-violet-200">Open project workspace →</button></td><td className="px-4 py-4"><span className="rounded-full border border-white/10 px-2 py-1 text-xs">{label(row.status)}</span><div className="mt-2 text-xs text-slate-500">{label(row.health)}</div></td><td className="px-4 py-4"><div>{row.owner.name}</div><div className="mt-1 text-xs text-slate-500">{row.dueDate || 'No due date'}</div></td><td className="px-4 py-4 text-xs">{taskText}</td><td className="px-4 py-4 text-xs"><div>{itemText}</div>{row.engagementWorkItems.automationFlags > 0 && <div className="mt-1 text-amber-300">{row.engagementWorkItems.automationFlags} automation flags</div>}</td><td className="max-w-xs px-4 py-4 text-xs">{row.attentionSignals.length ? <ul className="space-y-1 text-amber-200">{row.attentionSignals.map((signal) => <li key={signal}>• {signal}</li>)}</ul> : <span className="text-slate-600">None</span>}</td></tr>
}
