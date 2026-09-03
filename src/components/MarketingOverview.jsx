import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'

import { buildMarketingOverview, filterMarketingOverview, marketingOverviewCounts } from '../data/marketingOverview.js'
import { loadMarketingOverviewWork } from '../data/marketingOverviewRepository.js'
import { loadMarketingConnectionReadiness } from '../data/marketingConnectionReadinessRepository.js'

const INPUT = 'rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm text-white outline-none focus:border-emerald-500'
const BUTTON = 'rounded-xl border border-slate-700 px-4 py-2 text-sm font-semibold text-slate-200 hover:border-emerald-500 hover:text-white disabled:opacity-50'
const FACETS = Object.freeze([['due_work', 'Due work'], ['blockers', 'Blockers'], ['awaiting_review', 'Awaiting review'], ['available_sources', 'Available sources']])
const label = value => String(value || '').replaceAll('_', ' ').replace(/\b\w/g, letter => letter.toUpperCase())
const dueLabel = value => value ? new Date(`${value}T00:00:00Z`).toLocaleDateString() : 'No due date'

export default function MarketingOverview({ organizationId, scopeRevision, signal, onAccessError, engagement, onOpenBrief, onOpenPrivate, onOpenConnections, onRefresh }) {
  const [work, setWork] = useState(null)
  const [readiness, setReadiness] = useState([])
  const [sourceError, setSourceError] = useState('')
  const [loading, setLoading] = useState(true)
  const [refreshKey, setRefreshKey] = useState(0)
  const [filters, setFilters] = useState({ facet: 'due_work', owner: '', status: '', dueWindow: '' })
  const generation = useRef(0)

  useEffect(() => {
    const current = ++generation.current
    setLoading(true); setSourceError('')
    loadMarketingOverviewWork({ organizationId, engagement, signal }).then(result => {
      if (current === generation.current && !signal?.aborted) setWork(result)
    }).catch(error => {
      if (current !== generation.current || signal?.aborted || error?.name === 'AbortError') return
      onAccessError(error, { membershipMismatch: error?.membershipMismatch === true })
    }).finally(() => {
      if (current === generation.current && !signal?.aborted) setLoading(false)
    })
    loadMarketingConnectionReadiness({ organizationId, brand: { id: engagement.brand_id, name: engagement.brands?.name || 'Brand', organization_id: engagement.organization_id }, signal }).then(rows => {
      if (current === generation.current && !signal?.aborted) setReadiness(rows)
    }).catch(error => {
      if (current !== generation.current || signal?.aborted || error?.name === 'AbortError') return
      setReadiness([]); setSourceError(error.message)
      onAccessError(error, { membershipMismatch: error?.membershipMismatch === true })
    })
    return () => { generation.current += 1 }
  }, [engagement, onAccessError, organizationId, refreshKey, scopeRevision, signal])

  const overview = useMemo(() => work ? buildMarketingOverview({ organizationId, engagement, ...work, readiness }) : { records: [], owners: [], statuses: [] }, [engagement, organizationId, readiness, work])
  const counts = useMemo(() => marketingOverviewCounts(overview.records, filters), [filters, overview.records])
  const rows = useMemo(() => filterMarketingOverview(overview.records, filters), [filters, overview.records])
  const refresh = () => { setRefreshKey(value => value + 1); onRefresh?.() }
  const sectionFailures = work?.sectionErrors ? Object.values(work.sectionErrors).filter(Boolean) : []

  if (loading && !work) return <OverviewSkeleton />
  return <section className="space-y-6">
    <div className="flex flex-wrap items-start justify-between gap-4 rounded-2xl border border-emerald-900/50 bg-emerald-950/20 p-5">
      <div><p className="text-xs font-semibold uppercase tracking-[0.14em] text-emerald-300">Engagement overview</p><h2 className="mt-1 text-xl font-semibold">{engagement.name}</h2><p className="mt-2 text-sm text-slate-400">Current authorized Marketing work only. Counts and rows always use the same filters.</p><p className="mt-1 text-xs text-slate-500">Dates use your browser display timezone; stored due dates remain unchanged.</p></div>
      <div className="flex flex-wrap gap-2"><button type="button" className={BUTTON} onClick={onOpenBrief}>New marketing brief</button><button type="button" className={BUTTON} onClick={onOpenConnections}>View connection issues</button><button type="button" disabled={loading} className={BUTTON} onClick={refresh}>{loading ? 'Refreshing…' : 'Refresh'}</button></div>
    </div>
    {(sourceError || sectionFailures.length > 0) && <div role="status" className="rounded-xl border border-amber-800 bg-amber-950/30 px-4 py-3 text-sm text-amber-200">Some Overview sources are unavailable. Healthy work remains visible. {sourceError || sectionFailures.join(' ')}</div>}
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{FACETS.map(([id, title]) => <button type="button" key={id} onClick={() => setFilters(current => ({ ...current, facet: id }))} className={`rounded-2xl border p-4 text-left ${filters.facet === id ? 'border-emerald-500 bg-emerald-950/25' : 'border-slate-800 bg-slate-900/70'}`}><p className="text-xs uppercase tracking-[0.12em] text-slate-500">{title}</p><p className="mt-2 text-3xl font-semibold text-white">{counts[id]}</p></button>)}</div>
    <div className="grid gap-3 rounded-2xl border border-slate-800 bg-slate-900/70 p-4 md:grid-cols-4">
      <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">Owner<select className={`${INPUT} mt-2 w-full normal-case`} value={filters.owner} onChange={event => setFilters({ ...filters, owner: event.target.value })}><option value="">All authorized owners</option><option value="__unassigned__">Unassigned</option>{overview.owners.map(owner => <option key={owner.id} value={owner.id}>{owner.label}</option>)}</select></label>
      <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">Status<select className={`${INPUT} mt-2 w-full normal-case`} value={filters.status} onChange={event => setFilters({ ...filters, status: event.target.value })}><option value="">All statuses</option>{overview.statuses.map(status => <option key={status} value={status}>{label(status)}</option>)}</select></label>
      <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">Due window<select className={`${INPUT} mt-2 w-full normal-case`} value={filters.dueWindow} onChange={event => setFilters({ ...filters, dueWindow: event.target.value })}><option value="">Any due date</option><option value="overdue">Overdue</option><option value="7_days">Next 7 days</option><option value="30_days">Next 30 days</option><option value="no_due">No due date</option></select></label>
      <div className="flex items-end"><button type="button" className={`${BUTTON} w-full`} onClick={() => setFilters({ facet: 'due_work', owner: '', status: '', dueWindow: '' })}>Reset filters</button></div>
    </div>
    <div className="space-y-3">{rows.map(item => <OverviewRow key={item.id} item={item} onOpenConnections={onOpenConnections} />)}{!rows.length && <EmptyOverview facet={filters.facet} onOpenBrief={onOpenBrief} onOpenPrivate={onOpenPrivate} />}</div>
  </section>
}

function OverviewRow({ item, onOpenConnections }) {
  if (item.recordKind === 'source') return <article className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-800 bg-slate-900/70 p-4"><div><p className="font-semibold text-white">{item.title}</p><p className="mt-1 text-xs text-slate-500">{item.detail}</p></div><div className="flex items-center gap-3"><span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${item.available ? 'bg-emerald-950 text-emerald-300' : 'bg-amber-950 text-amber-200'}`}>{label(item.status)}</span>{!item.available && <button type="button" className={BUTTON} onClick={onOpenConnections}>View issue</button>}</div></article>
  const href = item.recordKind === 'artifact_review' ? '/sphere/marketing/studio?tab=artifacts' : '/sphere/marketing'
  return <article className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-800 bg-slate-900/70 p-4"><div><p className="font-semibold text-white">{item.title}</p><p className="mt-1 text-xs text-slate-500">{label(item.recordKind)} · {item.ownerLabel} · {dueLabel(item.dueDate)}</p></div><div className="flex items-center gap-3"><span className="rounded-full bg-slate-950 px-2.5 py-1 text-xs font-semibold text-slate-300">{label(item.status)}</span><Link className={BUTTON} to={href}>{item.recordKind === 'artifact_review' ? 'Open output' : 'Open work'}</Link></div></article>
}

function EmptyOverview({ facet, onOpenBrief, onOpenPrivate }) {
  return <div className="rounded-2xl border border-dashed border-slate-700 px-6 py-14 text-center"><p className="text-sm text-slate-400">No {label(facet).toLowerCase()} matches these filters.</p><div className="mt-4 flex justify-center gap-3"><button type="button" onClick={onOpenBrief} className={BUTTON}>Create brief</button><button type="button" onClick={onOpenPrivate} className={BUTTON}>Explore privately</button></div></div>
}

function OverviewSkeleton() {
  return <div aria-label="Loading Marketing Overview" className="space-y-5 animate-pulse"><div className="h-28 rounded-2xl bg-slate-900" /><div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{Array.from({ length: 4 }, (_, index) => <div key={index} className="h-24 rounded-2xl bg-slate-900" />)}</div><div className="h-52 rounded-2xl bg-slate-900" /></div>
}
