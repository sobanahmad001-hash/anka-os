import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { entriesForDay, filterMarketingCalendar, marketingMonthDays, monthInTimezone, moveMarketingMonth } from '../data/marketingCalendar.js'

const INPUT = 'w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm text-white outline-none focus:border-emerald-500'
const BUTTON = 'rounded-xl border border-slate-700 px-3 py-2 text-sm font-semibold text-slate-200 hover:border-emerald-500 hover:text-white disabled:opacity-50'
const label = value => String(value || '').replaceAll('_', ' ').replace(/\b\w/g, letter => letter.toUpperCase())

export default function MarketingCalendar({ organizationId, scopeRevision, signal, engagement, repository, onAccessError }) {
  const [snapshot, setSnapshot] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [stale, setStale] = useState(false)
  const [refreshKey, setRefreshKey] = useState(0)
  const [view, setView] = useState('month')
  const [month, setMonth] = useState('')
  const [filters, setFilters] = useState({ engagement: engagement.id, channel: '', owner: '', status: '' })
  const generation = useRef(0); const snapshotRef = useRef(snapshot); snapshotRef.current = snapshot

  useEffect(() => {
    const current = ++generation.current
    setLoading(true); setError('')
    repository.load(engagement).then(result => {
      if (current !== generation.current || signal?.aborted) return
      setSnapshot(result); setStale(false); setMonth(existing => existing || monthInTimezone(new Date(), result.timezone))
    }).catch(reason => {
      if (current !== generation.current || signal?.aborted || reason?.name === 'AbortError') return
      setError(reason.message || 'Marketing Calendar could not be loaded'); setStale(Boolean(snapshotRef.current))
      onAccessError?.(reason, { membershipMismatch: reason?.membershipMismatch === true })
    }).finally(() => { if (current === generation.current && !signal?.aborted) setLoading(false) })
    return () => { generation.current += 1 }
  }, [engagement, onAccessError, organizationId, refreshKey, repository, scopeRevision, signal])

  useEffect(() => setFilters({ engagement: engagement.id, channel: '', owner: '', status: '' }), [engagement.id])
  const dated = useMemo(() => filterMarketingCalendar(snapshot?.entries || [], filters, month), [filters, month, snapshot?.entries])
  const unscheduled = useMemo(() => (snapshot?.entries || []).filter(item => !item.plannedDate && (!filters.owner || filters.owner === '__unassigned__' ? (filters.owner !== '__unassigned__' || !item.ownerId) : item.ownerId === filters.owner) && (!filters.channel || item.channels.includes(filters.channel)) && (!filters.status || item.calendarState === filters.status)), [filters, snapshot?.entries])
  const days = useMemo(() => marketingMonthDays(month), [month])
  const firstOffset = days.length ? new Date(`${days[0]}T00:00:00Z`).getUTCDay() : 0

  if (loading && !snapshot) return <div role="status" className="rounded-2xl border border-slate-800 p-12 text-center text-sm text-slate-500">Loading Marketing Calendar…</div>
  return <section className="space-y-5">
    <header className="rounded-2xl border border-emerald-900/50 bg-emerald-950/20 p-5"><div className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-xs font-semibold uppercase tracking-[0.14em] text-emerald-300">Marketing calendar</p><h2 className="mt-1 text-xl font-semibold">Scheduled work and draft planning</h2><p className="mt-2 max-w-3xl text-sm leading-6 text-slate-400">Read-only projection of canonical Project Tasks, Engagement Work Items, and the latest unapproved campaign-plan draft. Dates use <strong className="text-slate-200">{snapshot?.timezone || 'UTC'}</strong>.</p></div><button type="button" disabled={loading} onClick={() => setRefreshKey(value => value + 1)} className={BUTTON}>{loading ? 'Refreshing…' : 'Refresh'}</button></div><div role="note" className="mt-4 rounded-xl border border-amber-800/70 bg-amber-950/30 px-4 py-3 text-sm text-amber-100"><strong>Scheduling remains in Work Management.</strong> Open the original record to change dates. A dedicated date-only command with project-owner/project-manager authority and dependency revalidation is not yet available, so this view does not mutate schedules.</div></header>
    {error && <div role="alert" className="rounded-xl border border-red-800 bg-red-950/40 px-4 py-3 text-sm text-red-200">{stale ? 'Stale snapshot — ' : ''}{error}</div>}
    <div className="grid gap-3 rounded-2xl border border-slate-800 bg-slate-900/70 p-4 sm:grid-cols-2 xl:grid-cols-4">
      <Filter title="Engagement" value={filters.engagement} onChange={engagementId => setFilters({ ...filters, engagement: engagementId })}><option value={engagement.id}>{engagement.name || 'Current engagement'}</option></Filter>
      <Filter title="Channel" value={filters.channel} onChange={channel => setFilters({ ...filters, channel })}><option value="">All channels</option>{snapshot?.channels.map(channel => <option key={channel} value={channel}>{channel}</option>)}</Filter>
      <Filter title="Owner" value={filters.owner} onChange={owner => setFilters({ ...filters, owner })}><option value="">All authorized owners</option><option value="__unassigned__">Unassigned</option>{snapshot?.owners.map(owner => <option key={owner.id} value={owner.id}>{owner.label}</option>)}</Filter>
      <Filter title="Status" value={filters.status} onChange={status => setFilters({ ...filters, status })}><option value="">All statuses</option>{snapshot?.statuses.map(status => <option key={status} value={status}>{label(status)}</option>)}</Filter>
    </div>
    <div className="flex flex-wrap items-center justify-between gap-3"><div className="flex items-center gap-2"><button type="button" aria-label="Previous month" className={BUTTON} onClick={() => setMonth(value => moveMarketingMonth(value, -1))}>←</button><input aria-label="Marketing calendar month" type="month" className={INPUT} value={month} onChange={event => setMonth(event.target.value)} /><button type="button" aria-label="Next month" className={BUTTON} onClick={() => setMonth(value => moveMarketingMonth(value, 1))}>→</button></div><div aria-label="Calendar view" className="flex rounded-xl border border-slate-800 p-1">{[['month', 'Month'], ['list', 'List']].map(([id, title]) => <button type="button" key={id} aria-pressed={view === id} onClick={() => setView(id)} className={`rounded-lg px-4 py-2 text-sm font-semibold ${view === id ? 'bg-emerald-600 text-white' : 'text-slate-400'}`}>{title}</button>)}</div></div>
    {view === 'month' ? <MonthGrid days={days} firstOffset={firstOffset} entries={dated} /> : <CalendarList entries={dated} />}
    <section className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5"><h3 className="font-semibold">Unscheduled Marketing work</h3><p className="mt-1 text-xs text-slate-500">Open the original record to schedule through its canonical Work Management workflow.</p><div className="mt-4 space-y-2">{unscheduled.map(entry => <CalendarCard key={entry.id} entry={entry} compact />)}{!unscheduled.length && <p className="rounded-xl border border-dashed border-slate-700 p-6 text-center text-sm text-slate-500">No unscheduled work matches these filters.</p>}</div></section>
  </section>
}

function Filter({ title, value, onChange, children }) { return <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">{title}<select aria-label={`Calendar ${title.toLowerCase()} filter`} className={`${INPUT} mt-2 normal-case`} value={value} onChange={event => onChange(event.target.value)}>{children}</select></label> }

function MonthGrid({ days, firstOffset, entries }) {
  return <div className="overflow-x-auto rounded-2xl border border-slate-800 bg-slate-900/70"><div className="min-w-[980px]"><div className="grid grid-cols-7 border-b border-slate-800">{['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(day => <div key={day} className="px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500">{day}</div>)}</div><div className="grid grid-cols-7">{Array.from({ length: firstOffset }, (_, index) => <div key={`blank-${index}`} className="min-h-36 border-b border-r border-slate-800/70 bg-slate-950/30" />)}{days.map(day => <div key={day} className="min-h-36 border-b border-r border-slate-800/70 p-2"><time dateTime={day} className="text-xs font-semibold text-slate-500">{Number(day.slice(-2))}</time><div className="mt-2 space-y-2">{entriesForDay(entries, day).map(entry => <CalendarCard key={entry.id} entry={entry} compact />)}</div></div>)}</div></div></div>
}

function CalendarList({ entries }) { return <div className="space-y-3">{entries.map(entry => <CalendarCard key={entry.id} entry={entry} />)}{!entries.length && <p className="rounded-2xl border border-dashed border-slate-700 p-12 text-center text-sm text-slate-500">No scheduled work matches this month and filters.</p>}</div> }

function CalendarCard({ entry, compact = false }) {
  const tone = entry.calendarState === 'draft' ? 'bg-amber-950 text-amber-200' : entry.calendarState === 'completed' ? 'bg-blue-950 text-blue-200' : entry.calendarState === 'cancelled' ? 'bg-slate-800 text-slate-300' : 'bg-emerald-950 text-emerald-200'
  const kind = entry.recordKind === 'project_task' ? 'Project Task' : entry.recordKind === 'engagement_work_item' ? 'Engagement Work Item' : 'Draft planning entry'
  return <article className={`rounded-xl border border-slate-700/70 bg-slate-950/70 ${compact ? 'p-2' : 'p-4'}`}><div className="flex flex-wrap items-start justify-between gap-2"><div className="min-w-0"><p className={`${compact ? 'text-xs' : 'text-sm'} font-semibold text-white`}>{entry.title}</p><p className="mt-1 text-[10px] uppercase tracking-wide text-slate-500">{kind}</p></div><span className={`rounded-full px-2 py-1 text-[10px] font-semibold uppercase ${tone}`}>{label(entry.calendarState)}</span></div>{!compact && <><p className="mt-3 text-xs text-slate-400">{entry.plannedDate || 'Unscheduled'}{entry.endDate && entry.endDate !== entry.plannedDate ? ` → ${entry.endDate}` : ''} · {entry.ownerLabel}</p><p className="mt-1 text-xs text-slate-500">{entry.channels.length ? entry.channels.join(' · ') : 'Channel unspecified'}{entry.campaignLabel ? ` · ${entry.campaignLabel}` : ''}</p>{entry.unresolvedDependencies > 0 && <p className="mt-2 text-xs font-semibold text-amber-300">{entry.unresolvedDependencies} unresolved prerequisite{entry.unresolvedDependencies === 1 ? '' : 's'}</p>}{entry.unknownDependencies > 0 && <p className="mt-2 text-xs font-semibold text-slate-400">{entry.unknownDependencies} prerequisite status{entry.unknownDependencies === 1 ? '' : 'es'} unknown</p>}{entry.calendarState === 'completed' && !entry.externallyPublished && <p className="mt-2 text-xs text-slate-500">Completed work; no external publication evidence is linked.</p>}</>}<div className={`${compact ? 'mt-2' : 'mt-4'} flex flex-wrap gap-2`}><Link className="text-xs font-semibold text-emerald-300 hover:text-emerald-200" to={entry.href}>{entry.recordKind === 'campaign_plan_draft' ? 'Open campaign' : entry.plannedDate ? 'Open original' : 'Open to schedule'} →</Link>{entry.plannerHref && <Link className="text-xs font-semibold text-violet-300 hover:text-violet-200" to={entry.plannerHref}>Recurring planner →</Link>}</div></article>
}
