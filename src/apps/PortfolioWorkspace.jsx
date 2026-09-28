import { useCallback, useEffect, useRef, useMemo, useState } from 'react'
import { useOrganization } from '../context/OrganizationContext.jsx'
import { useNavigate } from 'react-router-dom'
import { filterPortfolioRows, PORTFOLIO_DUE_FILTERS } from '../data/portfolioWorkspaceModel'
import { portfolioWorkspace } from '../data/portfolioWorkspace'
import { canShowAuthorityAdministration } from '../data/authorityAdministration.js'
import ProjectDraftSetupPanel from './ProjectDraftSetupPanel.jsx'
import ProjectRequestPanel from './ProjectRequestPanel.jsx'

const label = (value) => value.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())
const metric = (title, value, note) => ({ title, value, note })

export default function PortfolioWorkspace({ initialOwnerKind = 'all' }) {
  const navigate = useNavigate()

  const { activeOrganizationId, activeMembership, selectionRequired, loading: organizationLoading, scopeRevision, requestSignal, handleOrganizationAccessError } = useOrganization()
  const currentRequest = useRef(null)
  currentRequest.current = { organizationId: activeOrganizationId, revision: scopeRevision, recordId: null }
  const requestGeneration = useRef(0)
  const [snapshot, setSnapshot] = useState(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [showSetup, setShowSetup] = useState(false)
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
    setShowSetup(false)
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
    <main className="workspace-page">
      <div className="workspace-container">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="workspace-eyebrow">Coordination</p>
            <h1 className="workspace-title">Portfolio Workspace</h1>
            <p className="workspace-description">A project-root view of Client Work and Internal Work. Project Tasks and Engagement Work Items remain separate.</p>
          </div>
          <div className="flex gap-2">{canShowAuthorityAdministration(activeMembership) && <button type="button" onClick={() => setShowSetup(true)} disabled={showSetup} className="rounded-xl workspace-button workspace-button-primary px-4 py-2 text-sm font-semibold disabled:opacity-50">New draft project</button>}<button type="button" onClick={load} disabled={loading} className="workspace-button font-medium text-[var(--anka-ink)] hover:bg-[var(--anka-surface-raised)] disabled:opacity-50">{loading ? 'Refreshing…' : 'Refresh'}</button></div>
        </div>

        {showSetup && canShowAuthorityAdministration(activeMembership) && <ProjectDraftSetupPanel organizationId={activeOrganizationId} scopeRevision={scopeRevision} requestSignal={requestSignal} initialType="project" onCreated={(result) => navigate(`/sphere/workspace/projects/${result.project_id}?tab=services`)} onCancel={() => setShowSetup(false)} onAccessError={handleOrganizationAccessError} />}

        {!organizationLoading && !selectionRequired && activeOrganizationId && <ProjectRequestPanel organizationId={activeOrganizationId} membership={activeMembership} scopeRevision={scopeRevision} requestSignal={requestSignal} onAccessError={handleOrganizationAccessError} />}

        {error && <div role="alert" className="mt-6 rounded-2xl border border-[var(--anka-danger)] bg-[var(--anka-danger-soft)] p-4 text-sm text-[var(--anka-danger)]">{error}</div>}
        {loading && !snapshot && <div className="mt-8 workspace-card p-10 text-center text-sm text-[var(--anka-muted)]">Loading live portfolio data…</div>}

        <nav aria-label="Project work type" className="mt-5 flex flex-wrap gap-2">{[['all', 'All Projects'], ['client', 'Client Work'], ['internal', 'Internal Work']].map(([kind, title]) => <button type="button" key={kind} aria-pressed={filters.ownerKind === kind} onClick={() => setFilters(current => ({ ...current, ownerKind: kind }))} className={`rounded-xl border px-4 py-2 text-sm ${filters.ownerKind === kind ? 'border-[var(--anka-violet)] bg-[var(--anka-violet-soft)] text-[var(--anka-violet)]' : 'border-[var(--anka-line)] text-[var(--anka-muted)]'}`}>{title}</button>)}</nav>
        {snapshot && <>
          <section aria-label="Portfolio summary" className="mt-7 grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
            {metrics.map((item) => <div key={item.title} className="workspace-card p-4"><p className="text-xs text-[var(--anka-muted)]">{item.title}</p><p className="mt-2 text-2xl font-semibold">{item.value}</p><p className="mt-1 text-[11px] text-[var(--anka-muted)]">{item.note}</p></div>)}
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
  const selectClass = 'rounded-xl border border-[var(--anka-line)] bg-[var(--anka-surface)] px-3 py-2 text-sm text-[var(--anka-ink)]'
  return (
    <section aria-label="Portfolio filters" className="mt-6 grid gap-3 workspace-card p-4 sm:grid-cols-2 xl:grid-cols-5">
      <Filter label="Work type"><select className={selectClass} value={filters.ownerKind} onChange={updateFilter('ownerKind')}><option value="all">All work</option><option value="client">Client Work</option><option value="internal">Internal Work</option></select></Filter>
      <Filter label="Status"><select className={selectClass} value={filters.status} onChange={updateFilter('status')}><option value="all">All statuses</option>{statuses.map((status) => <option key={status} value={status}>{label(status)}</option>)}</select></Filter>
      <Filter label="Due"><select className={selectClass} value={filters.due} onChange={updateFilter('due')}>{PORTFOLIO_DUE_FILTERS.map((due) => <option key={due} value={due}>{due === 'all' ? 'All due dates' : label(due)}</option>)}</select></Filter>
      <Filter label="Owner"><select className={selectClass} value={filters.owner} onChange={updateFilter('owner')}><option value="all">All owners</option>{owners.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></Filter>
      <Filter label="Sort"><select className={selectClass} value={filters.sort} onChange={updateFilter('sort')}><option value="due">Due date</option><option value="name">Name</option><option value="status">Status</option><option value="owner">Owner</option></select></Filter>
    </section>
  )
}

function Filter({ label: title, children }) {
  return <label className="flex min-w-0 flex-col gap-1.5 text-xs font-medium text-[var(--anka-muted)]"><span>{title}</span>{children}</label>
}

function DepartmentLoad({ rows }) {
  if (!rows.length) return null
  return (
    <section className="mt-6 workspace-card p-4">
      <h2 className="text-sm font-semibold">Department load</h2>
      <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {rows.map((row) => <div key={row.department} className="rounded-xl border border-[var(--anka-line)] bg-[var(--anka-surface-raised)] p-3"><p className="text-sm font-medium">{label(row.department)}</p><p className="mt-2 text-xs text-[var(--anka-muted)]">{row.projects} projects</p><div className="mt-2 flex flex-wrap gap-2 text-[11px]"><span className="rounded-full bg-[var(--anka-surface-raised)] px-2 py-1 text-[var(--anka-info)]">{row.projectTasks} Project Tasks</span><span className="rounded-full bg-[var(--anka-violet-soft)] px-2 py-1 text-[var(--anka-violet)]">{row.engagementWorkItems} Engagement Work Items</span></div></div>)}
      </div>
    </section>
  )
}

function PortfolioTable({ rows, navigate }) {
  return (
    <section className="mt-6 overflow-hidden workspace-card">
      <div className="flex items-center justify-between border-b border-[var(--anka-line)] px-4 py-3"><h2 className="text-sm font-semibold">Projects</h2><span className="text-xs text-[var(--anka-muted)]">{rows.length} shown</span></div>
      {!rows.length ? <p className="p-10 text-center text-sm text-[var(--anka-muted)]">No projects match these filters.</p> : <div className="overflow-x-auto"><table className="min-w-full text-left text-sm"><thead className="bg-[var(--anka-surface)] text-[11px] uppercase tracking-wide text-[var(--anka-muted)]"><tr><th className="px-4 py-3">Project</th><th className="px-4 py-3">Status</th><th className="px-4 py-3">Owner / due</th><th className="px-4 py-3">Project Tasks</th><th className="px-4 py-3">Engagement Work Items</th><th className="px-4 py-3">Attention signals</th></tr></thead><tbody className="divide-y divide-[var(--anka-line)]">{rows.map((row) => <ProjectRow key={row.id} row={row} navigate={navigate} />)}</tbody></table></div>}
    </section>
  )
}

function ProjectRow({ row, navigate }) {
  const taskText = `${row.projectTasks.open} open · ${row.projectTasks.blocked} blocked · ${row.projectTasks.overdue} overdue`
  const itemText = `${row.engagementWorkItems.open} open · ${row.engagementWorkItems.blocked} blocked · ${row.engagementWorkItems.overdue} overdue`
  return <tr className="align-top text-[var(--anka-ink)]"><td className="px-4 py-4"><div className="font-medium text-[var(--anka-ink)]">{row.name}</div><div className="mt-1 text-xs text-[var(--anka-muted)]">{row.ownerKind === 'internal' ? 'Internal Work' : `Client Work${row.clientName ? ` · ${row.clientName}` : ''}`}{row.brandName ? ` · ${row.brandName}` : ''}</div><button type="button" onClick={() => navigate(`/sphere/workspace/projects/${row.id}`)} className="mt-2 text-xs font-medium text-[var(--anka-violet)] hover:text-[var(--anka-ink)]">Open project workspace →</button></td><td className="px-4 py-4"><span className="rounded-full border border-[var(--anka-line)] px-2 py-1 text-xs">{label(row.status)}</span><div className="mt-2 text-xs text-[var(--anka-muted)]">{label(row.health)}</div></td><td className="px-4 py-4"><div>{row.owner.name}</div><div className="mt-1 text-xs text-[var(--anka-muted)]">{row.dueDate || 'No due date'}</div></td><td className="px-4 py-4 text-xs">{taskText}</td><td className="px-4 py-4 text-xs"><div>{itemText}</div>{row.engagementWorkItems.automationFlags > 0 && <div className="mt-1 text-[var(--anka-warning)]">{row.engagementWorkItems.automationFlags} automation flags</div>}</td><td className="max-w-xs px-4 py-4 text-xs">{row.attentionSignals.length ? <ul className="space-y-1 text-[var(--anka-warning)]">{row.attentionSignals.map((signal) => <li key={signal}>• {signal}</li>)}</ul> : <span className="text-[var(--anka-muted)]">None</span>}</td></tr>
}
