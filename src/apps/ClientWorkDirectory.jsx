import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useOrganization } from '../context/OrganizationContext.jsx'
import { clientWorkDirectory } from '../data/clientWorkDirectory'

const INPUT = 'rounded-xl border border-white/10 bg-black/20 px-3 py-2.5 text-sm text-white outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-400/20'
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
  return <main className="min-h-full bg-[#090c13] p-4 text-slate-100 sm:p-6 lg:p-8"><div className="mx-auto max-w-[1540px]">
    <DirectoryNavigation current="client" />
    <header className="mt-6 flex flex-wrap items-start justify-between gap-5"><div><p className="text-xs font-semibold uppercase tracking-[0.2em] text-violet-300">Workspace directory</p><h1 className="mt-2 text-3xl font-semibold tracking-tight">Client Work</h1><p className="mt-2 max-w-3xl text-sm leading-6 text-slate-400">Clients are canonical company records. Brands and engagement context appear only when their existing relationships are valid.</p></div><button type="button" onClick={load} disabled={loading} className="rounded-xl border border-white/10 px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-400 disabled:opacity-50">{loading ? 'Refreshing...' : 'Refresh'}</button></header>
    {failure && <InlineFailure failure={failure} />}
    <section aria-label="Client Work summary" className="mt-7 grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><Metric title="Clients" value={summary.clients} /><Metric title="Active projects" value={summary.activeProjects} /><Metric title="Project Tasks" value={summary.openProjectTasks} /><Metric title="Engagement Work Items" value={summary.openEngagementWorkItems} /></section>
    <p className="mt-3 text-xs leading-5 text-slate-500">Counts cover all authorized, non-archived Client Work in the active organization. Open work excludes completed or cancelled records. Project dates are stored due dates; overdue is evaluated against today.</p>
    <section aria-label="Filter Client Work" className="mt-6 grid gap-3 rounded-2xl border border-white/[0.07] bg-white/[0.025] p-4 md:grid-cols-[minmax(0,1fr)_220px_220px]"><label className="text-xs font-semibold text-slate-400">Search clients, brands, projects, or owners<input className={INPUT + ' mt-2 w-full'} value={query} onChange={(event) => setQuery(event.target.value)} type="search" placeholder="Search Client Work" /></label><Filter label="Client status" value={status} onChange={setStatus} options={statuses} /><Filter label="Project type" value={workType} onChange={setWorkType} options={['project', 'retainer']} /></section>
    <p className="mt-4 text-sm text-slate-500" aria-live="polite">Showing {filteredClients.length} of {directory.clients.length} clients.</p>
    <section aria-label="Client Work results" className="mt-4 grid gap-5 xl:grid-cols-2">{filteredClients.map((client) => <ClientCard key={client.id} client={client} />)}</section>
    {!directory.clients.length && <Empty title="No Client Work yet" note="No authorized canonical clients exist in the active organization." />}
    {directory.clients.length > 0 && !filteredClients.length && <Empty title="No matching Client Work" note="Clear or change the local filters. The underlying authorized directory was not changed." />}
  </div></main>
}

function DirectoryNavigation({ current }) {
  const links = [['company', '/sphere/portfolio', 'Company work'], ['client', '/sphere/clients', 'Client Work'], ['internal', '/sphere/internal', 'Internal Work']]
  return <nav aria-label="Work directories" className="flex flex-wrap gap-2">{links.map(([id, to, title]) => <Link key={id} to={to} aria-current={current === id ? 'page' : undefined} className={'rounded-xl border px-3 py-2 text-sm font-medium outline-none focus:ring-2 focus:ring-violet-400 ' + (current === id ? 'border-violet-400/40 bg-violet-500/15 text-violet-100' : 'border-white/10 text-slate-400 hover:text-white')}>{title}</Link>)}</nav>
}

function ClientCard({ client }) {
  return <article className="rounded-2xl border border-white/[0.08] bg-white/[0.025] p-5"><div className="flex flex-wrap items-start justify-between gap-4"><div><Link to={'/sphere/clients/' + client.id} className="text-xl font-semibold text-white outline-none hover:text-violet-200 focus:ring-2 focus:ring-violet-400">{client.company || client.name}</Link><p className="mt-1 text-sm text-slate-500">{client.name}{client.industry ? ' · ' + client.industry : ''} · Owner: {client.owner.name}</p></div><Status value={client.status} /></div>
    <div className="mt-4 flex flex-wrap gap-2">{client.brands.map((brand) => <span key={brand.id} className="rounded-full border border-violet-500/20 bg-violet-500/10 px-2 py-1 text-[11px] text-violet-200">{brand.name}{brand.is_default ? ' · Default' : ''}</span>)}{!client.brands.length && <span className="text-xs text-slate-500">No valid brand extension recorded.</span>}</div>
    <dl className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-5"><Count title="Active projects" value={client.counts.activeProjects} /><Count title="One-time" value={client.counts.oneTimeProjects} /><Count title="Retainers" value={client.counts.retainers} /><Count title="Project Tasks" value={client.counts.openProjectTasks} /><Count title="Engagement Items" value={client.counts.openEngagementWorkItems} /></dl>
    <div className="mt-5 border-t border-white/[0.07] pt-4"><div className="flex items-center justify-between gap-3"><h2 className="text-sm font-semibold">Projects</h2><Link to={'/sphere/clients/' + client.id} className="text-xs font-medium text-violet-300 outline-none hover:text-violet-200 focus:ring-2 focus:ring-violet-400">Open client workspace</Link></div>{client.projects.length ? <div className="mt-3 space-y-2">{client.projects.slice(0, 4).map((project) => <Link key={project.id} to={'/sphere/workspace/projects/' + project.id} className="flex flex-col gap-2 rounded-xl border border-white/[0.07] bg-black/10 p-3 outline-none hover:border-violet-400/30 focus:ring-2 focus:ring-violet-400 sm:flex-row sm:items-center sm:justify-between"><div><p className="text-sm font-medium text-white">{project.name}</p><p className="mt-1 text-xs text-slate-500">{label(project.engagement_type)} · {project.brandName || 'No valid brand context'} · {project.owner.name} · Due {date(project.due_date)}</p></div><div className="flex items-center gap-2"><Status value={project.status} />{project.overdue && <span className="text-xs font-medium text-amber-300">Overdue</span>}</div></Link>)}</div> : <p className="mt-3 text-sm text-slate-500">No non-archived client projects.</p>}</div>
  </article>
}

function Filter({ label: title, value, onChange, options }) {
  return <label className="text-xs font-semibold text-slate-400">{title}<select className={INPUT + ' mt-2 w-full'} value={value} onChange={(event) => onChange(event.target.value)}><option value="all">All</option>{options.map((option) => <option key={option} value={option}>{label(option)}</option>)}</select></label>
}
function Metric({ title, value }) { return <div className="rounded-2xl border border-white/[0.07] bg-white/[0.025] p-4"><p className="text-xs text-slate-500">{title}</p><p className="mt-2 text-2xl font-semibold">{value}</p></div> }
function Count({ title, value }) { return <div><dt className="text-[11px] text-slate-500">{title}</dt><dd className="mt-1 text-sm font-semibold text-slate-200">{value}</dd></div> }
function Status({ value }) { return <span className="shrink-0 rounded-full border border-white/10 bg-white/[0.03] px-2 py-1 text-[11px] text-slate-300">{label(value)}</span> }
function Empty({ title, note }) { return <div className="mt-5 rounded-2xl border border-dashed border-white/10 p-10 text-center"><p className="font-medium text-slate-300">{title}</p><p className="mt-2 text-sm text-slate-500">{note}</p></div> }
function InlineFailure({ failure }) { return <div role="alert" className={'mt-5 rounded-xl border p-4 text-sm ' + (failure.kind === 'stale' ? 'border-amber-500/25 bg-amber-500/10 text-amber-200' : 'border-rose-500/25 bg-rose-500/10 text-rose-200')}>{failure.message}</div> }
function FailureState({ failure, retry }) {
  const copy = failure?.kind === 'denied' ? ['Access denied', 'You are not authorized to view Client Work in the active organization.'] : failure?.kind === 'stale' ? ['Client Work is stale', 'The response did not match the active organization. The organization was not changed.'] : ['Unable to load Client Work', failure?.message || 'An unexpected error occurred.']
  return <DirectoryState title={copy[0]} note={copy[1]}><button type="button" onClick={retry} className="mt-4 rounded-xl border border-white/10 px-4 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-violet-400">Try again</button></DirectoryState>
}
function DirectoryState({ title, note, children }) { return <main className="flex min-h-full items-center justify-center bg-[#090c13] p-6 text-center"><div><p className="font-medium text-slate-200">{title}</p><p className="mt-2 max-w-xl text-sm text-slate-500">{note}</p>{children}</div></main> }
