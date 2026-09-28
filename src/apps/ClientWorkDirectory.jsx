import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useOrganization } from '../context/OrganizationContext.jsx'
import { clientWorkDirectory } from '../data/clientWorkDirectory'

const INPUT = 'rounded-xl border border-[var(--anka-line)] bg-[var(--anka-surface-raised)] px-3 py-2.5 text-sm text-[var(--anka-ink)] focus:border-[var(--anka-focus)] focus:ring-2 focus:ring-[var(--anka-focus)]'
const label = (value) => value ? value.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase()) : 'Unknown'
const date = (value) => value ? new Date(value.slice(0, 10) + 'T00:00:00Z').toLocaleDateString() : 'No date'

export default function ClientWorkDirectory() {
  const { activeOrganizationId, selectionRequired, loading: organizationLoading, scopeRevision, requestSignal, handleOrganizationAccessError } = useOrganization()
  const currentScope = useRef(null)
  currentScope.current = { organizationId: activeOrganizationId, revision: scopeRevision }
  const generation = useRef(0)
  const [directory, setDirectory] = useState(null)
  const [loading, setLoading] = useState(true)
  const [failure, setFailure] = useState(null)
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState('all')
  const [workType, setWorkType] = useState('all')

  const load = useCallback(async () => {
    if (organizationLoading || selectionRequired || !activeOrganizationId || requestSignal?.aborted) return
    const requestedScope = { organizationId: activeOrganizationId, revision: scopeRevision, signal: requestSignal }
    const requestGeneration = ++generation.current
    const isCurrent = () => requestGeneration === generation.current && !requestedScope.signal?.aborted
      && requestedScope.organizationId === currentScope.current.organizationId
      && requestedScope.revision === currentScope.current.revision
    setLoading(true)
    setFailure(null)
    try {
      const result = await clientWorkDirectory.get(activeOrganizationId, { signal: requestSignal })
      if (isCurrent()) setDirectory(result)
    } catch (cause) {
      if (isCurrent() && cause.name !== 'AbortError' && cause.cause?.name !== 'AbortError') {
        handleOrganizationAccessError(cause, { membershipMismatch: cause.membershipMismatch })
        setFailure({
          kind: cause.membershipMismatch || cause.status === 409 ? 'stale' : [401, 403].includes(cause.status) ? 'denied' : 'error',
          message: cause.message || 'Unable to load Client Work.',
        })
      }
    } finally {
      if (isCurrent()) setLoading(false)
    }
  }, [activeOrganizationId, handleOrganizationAccessError, organizationLoading, requestSignal, scopeRevision, selectionRequired])

  useEffect(() => {
    setDirectory(null)
    setFailure(null)
    setLoading(true)
    setQuery('')
    setStatus('all')
    setWorkType('all')
    load()
    return () => { generation.current += 1 }
  }, [load])

  const statuses = useMemo(() => [...new Set((directory?.clients || []).map((row) => row.status).filter(Boolean))].sort(), [directory])
  const filteredClients = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase()
    return (directory?.clients || []).filter((client) => {
      const searchable = [client.name, client.company, client.industry, client.owner.name, ...client.brands.map((brand) => brand.name), ...client.projects.map((project) => project.name)].filter(Boolean).join(' ').toLocaleLowerCase()
      return (!needle || searchable.includes(needle))
        && (status === 'all' || client.status === status)
        && (workType === 'all' || client.projects.some((project) => project.engagement_type === workType))
    })
  }, [directory, query, status, workType])

  if (organizationLoading) return <DirectoryState title="Resolving organization" note="Client Work will load after the active organization is confirmed." />
  if (selectionRequired || !activeOrganizationId) return <DirectoryState title="Choose an organization" note="Client Work never chooses or switches an organization from a link." />
  if (loading && !directory) return <DirectoryState title="Loading Client Work" note="Loading authorized clients, brands, and projects for the active organization." />
  if (!directory) return <FailureState failure={failure} retry={load} />

  const { summary } = directory
  return <main className="workspace-page"><div className="workspace-container">
    <DirectoryNavigation current="client" />
    <header className="mt-6 flex flex-wrap items-start justify-between gap-5"><div><p className="workspace-eyebrow">Workspace directory</p><h1 className="workspace-title">Client Work</h1><p className="workspace-description">Clients are canonical company records. Brands and engagement context appear only when their existing relationships are valid.</p></div><button type="button" onClick={load} disabled={loading} className="workspace-button focus-visible:ring-2 focus-visible:ring-[var(--anka-focus)] disabled:opacity-50">{loading ? 'Refreshing...' : 'Refresh'}</button></header>
    {failure && <InlineFailure failure={failure} />}
    <section aria-label="Client Work summary" className="mt-7 grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><Metric title="Clients" value={summary.clients} /><Metric title="Active projects" value={summary.activeProjects} /><Metric title="Project Tasks" value={summary.openProjectTasks} /><Metric title="Engagement Work Items" value={summary.openEngagementWorkItems} /></section>
    <p className="mt-3 text-xs leading-5 text-[var(--anka-muted)]">Counts cover all authorized, non-archived Client Work in the active organization. Open work excludes completed or cancelled records. Project dates are stored due dates; overdue is evaluated against today.</p>
    <section aria-label="Filter Client Work" className="mt-6 grid gap-3 workspace-card p-4 md:grid-cols-[minmax(0,1fr)_220px_220px]"><label className="text-xs font-semibold text-[var(--anka-muted)]">Search clients, brands, projects, or owners<input className={INPUT + ' mt-2 w-full'} value={query} onChange={(event) => setQuery(event.target.value)} type="search" placeholder="Search Client Work" /></label><Filter label="Client status" value={status} onChange={setStatus} options={statuses} /><Filter label="Project type" value={workType} onChange={setWorkType} options={['project', 'retainer']} /></section>
    <p className="mt-4 text-sm text-[var(--anka-muted)]" aria-live="polite">Showing {filteredClients.length} of {directory.clients.length} clients.</p>
    <section aria-label="Client Work results" className="mt-4 grid gap-5 xl:grid-cols-2">{filteredClients.map((client) => <ClientCard key={client.id} client={client} />)}</section>
    {!directory.clients.length && <Empty title="No Client Work yet" note="No authorized canonical clients exist in the active organization." />}
    {directory.clients.length > 0 && !filteredClients.length && <Empty title="No matching Client Work" note="Clear or change the local filters. The underlying authorized directory was not changed." />}
  </div></main>
}

function DirectoryNavigation({ current }) {
  const links = [['company', '/sphere/portfolio', 'Company work'], ['client', '/sphere/clients', 'Client Work'], ['internal', '/sphere/internal', 'Internal Work']]
  return <nav aria-label="Work directories" className="flex flex-wrap gap-2">{links.map(([id, to, title]) => <Link key={id} to={to} aria-current={current === id ? 'page' : undefined} className={'rounded-xl border px-3 py-2 text-sm font-medium focus:ring-2 focus:ring-[var(--anka-focus)] ' + (current === id ? 'border-[var(--anka-violet)] bg-[var(--anka-violet-soft)] text-[var(--anka-violet)]' : 'border-[var(--anka-line)] text-[var(--anka-muted)] hover:text-[var(--anka-ink)]')}>{title}</Link>)}</nav>
}

function ClientCard({ client }) {
  return <article className="workspace-card p-5"><div className="flex flex-wrap items-start justify-between gap-4"><div><Link to={'/sphere/clients/' + client.id} className="text-xl font-semibold text-[var(--anka-ink)] hover:text-[var(--anka-violet)] focus:ring-2 focus:ring-[var(--anka-focus)]">{client.company || client.name}</Link><p className="mt-1 text-sm text-[var(--anka-muted)]">{client.name}{client.industry ? ' · ' + client.industry : ''} · Owner: {client.owner.name}</p></div><Status value={client.status} /></div>
    <div className="mt-4 flex flex-wrap gap-2">{client.brands.map((brand) => <span key={brand.id} className="rounded-full border border-[var(--anka-violet)] bg-[var(--anka-violet-soft)] px-2 py-1 text-[11px] text-[var(--anka-violet)]">{brand.name}{brand.is_default ? ' · Default' : ''}</span>)}{!client.brands.length && <span className="text-xs text-[var(--anka-muted)]">No valid brand extension recorded.</span>}</div>
    <dl className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-5"><Count title="Active projects" value={client.counts.activeProjects} /><Count title="One-time" value={client.counts.oneTimeProjects} /><Count title="Retainers" value={client.counts.retainers} /><Count title="Project Tasks" value={client.counts.openProjectTasks} /><Count title="Engagement Items" value={client.counts.openEngagementWorkItems} /></dl>
    <div className="mt-5 border-t border-[var(--anka-line)] pt-4"><div className="flex items-center justify-between gap-3"><h2 className="text-sm font-semibold">Projects</h2><Link to={'/sphere/clients/' + client.id} className="text-xs font-medium text-[var(--anka-violet)] hover:text-[var(--anka-ink)] focus:ring-2 focus:ring-[var(--anka-focus)]">Open client workspace</Link></div>{client.projects.length ? <div className="mt-3 space-y-2">{client.projects.slice(0, 4).map((project) => <Link key={project.id} to={'/sphere/workspace/projects/' + project.id} className="flex flex-col gap-2 rounded-xl border border-[var(--anka-line)] bg-[var(--anka-surface-raised)] p-3 hover:border-[var(--anka-violet)] focus:ring-2 focus:ring-[var(--anka-focus)] sm:flex-row sm:items-center sm:justify-between"><div><p className="text-sm font-medium text-[var(--anka-ink)]">{project.name}</p><p className="mt-1 text-xs text-[var(--anka-muted)]">{label(project.engagement_type)} · {project.brandName || 'No valid brand context'} · {project.owner.name} · Due {date(project.due_date)}</p></div><div className="flex items-center gap-2"><Status value={project.status} />{project.overdue && <span className="text-xs font-medium text-[var(--anka-warning)]">Overdue</span>}</div></Link>)}</div> : <p className="mt-3 text-sm text-[var(--anka-muted)]">No non-archived client projects.</p>}</div>
  </article>
}

function Filter({ label: title, value, onChange, options }) {
  return <label className="text-xs font-semibold text-[var(--anka-muted)]">{title}<select className={INPUT + ' mt-2 w-full'} value={value} onChange={(event) => onChange(event.target.value)}><option value="all">All</option>{options.map((option) => <option key={option} value={option}>{label(option)}</option>)}</select></label>
}
function Metric({ title, value }) { return <div className="workspace-card p-4"><p className="text-xs text-[var(--anka-muted)]">{title}</p><p className="mt-2 text-2xl font-semibold">{value}</p></div> }
function Count({ title, value }) { return <div><dt className="text-[11px] text-[var(--anka-muted)]">{title}</dt><dd className="mt-1 text-sm font-semibold text-[var(--anka-ink)]">{value}</dd></div> }
function Status({ value }) { return <span className="shrink-0 rounded-full border border-[var(--anka-line)] bg-[var(--anka-surface)] px-2 py-1 text-[11px] text-[var(--anka-ink)]">{label(value)}</span> }
function Empty({ title, note }) { return <div className="mt-5 rounded-2xl border border-dashed border-[var(--anka-line)] p-10 text-center"><p className="font-medium text-[var(--anka-ink)]">{title}</p><p className="mt-2 text-sm text-[var(--anka-muted)]">{note}</p></div> }
function InlineFailure({ failure }) { return <div role="alert" className={'mt-5 rounded-xl border p-4 text-sm ' + (failure.kind === 'stale' ? 'border-[var(--anka-warning)] bg-[var(--anka-warning-soft)] text-[var(--anka-warning)]' : 'border-[var(--anka-danger)] bg-[var(--anka-danger-soft)] text-[var(--anka-danger)]')}>{failure.message}</div> }
function FailureState({ failure, retry }) {
  const copy = failure?.kind === 'denied' ? ['Access denied', 'You are not authorized to view Client Work in the active organization.'] : failure?.kind === 'stale' ? ['Client Work is stale', 'The response did not match the active organization. The organization was not changed.'] : ['Unable to load Client Work', failure?.message || 'An unexpected error occurred.']
  return <DirectoryState title={copy[0]} note={copy[1]}><button type="button" onClick={retry} className="mt-4 workspace-button text-[var(--anka-ink)] focus-visible:ring-2 focus-visible:ring-[var(--anka-focus)]">Try again</button></DirectoryState>
}
function DirectoryState({ title, note, children }) { return <main className="flex min-h-full items-center justify-center bg-[var(--anka-canvas)] p-6 text-center"><div><p className="font-medium text-[var(--anka-ink)]">{title}</p><p className="mt-2 max-w-xl text-sm text-[var(--anka-muted)]">{note}</p>{children}</div></main> }
