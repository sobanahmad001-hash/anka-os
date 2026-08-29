import { UNASSIGNED_WORK_ITEM_FILTER, WORKLOAD_OPEN_ITEM_THRESHOLD } from '../data/workItems.js'

const STATUS_SEGMENTS = Object.freeze([
  ['not_started', 'Not started', 'bg-slate-500'],
  ['in_progress', 'In progress', 'bg-blue-400'],
  ['blocked', 'Blocked', 'bg-red-400'],
  ['done', 'Done', 'bg-emerald-400'],
])

export default function WorkloadView({ rows, loading, onFilter }) {
  if (loading) return <div className="rounded-2xl border border-white/[0.07] bg-[#0e111a]/80 py-16 text-center text-sm text-slate-500">Loading workload…</div>

  const openItems = rows.reduce((total, row) => total + row.open, 0)
  const overAllocated = rows.filter(row => row.overAllocated).length

  return <section className="space-y-4" aria-labelledby="workload-heading">
    <div className="grid gap-3 sm:grid-cols-3">
      <Metric label="People with work" value={rows.filter(row => row.assigneeId !== UNASSIGNED_WORK_ITEM_FILTER).length} />
      <Metric label="Open items" value={openItems} />
      <Metric label="Over allocated" value={overAllocated} warning={overAllocated > 0} />
    </div>
    <div className="overflow-hidden rounded-2xl border border-white/[0.07] bg-[#0e111a]/80">
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-white/[0.07] px-5 py-4">
        <div><h3 id="workload-heading" className="font-semibold text-white">Engagement workload</h3><p className="mt-1 text-xs text-slate-500">Open capacity is flagged above {WORKLOAD_OPEN_ITEM_THRESHOLD} non-done items.</p></div>
        <div className="flex flex-wrap gap-3">{STATUS_SEGMENTS.map(([status, label, color]) => <span key={status} className="inline-flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500"><span className={`h-2 w-2 rounded-full ${color}`} />{label}</span>)}</div>
      </header>
      <div className="divide-y divide-white/[0.06]">
        {rows.map(row => <article key={row.assigneeId} className={`grid gap-4 px-5 py-4 transition sm:grid-cols-[minmax(180px,1fr)_minmax(280px,2fr)_auto] sm:items-center ${row.overAllocated ? 'bg-red-500/[0.04]' : ''}`}>
          <button type="button" onClick={() => onFilter(row.assigneeId, 'list')} className="min-w-0 text-left" aria-label={`Show ${row.label}'s work in List`}>
            <span className="flex items-center gap-3"><span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-bold ${row.overAllocated ? 'bg-red-500/15 text-red-300' : 'bg-violet-500/15 text-violet-300'}`}>{initials(row.label)}</span><span className="min-w-0"><span className="block truncate text-sm font-semibold text-white hover:text-violet-300">{row.label}</span><span className={`mt-0.5 block text-xs ${row.overAllocated ? 'text-red-300' : 'text-slate-500'}`}>{row.open} open · {row.total} total{row.overAllocated ? ' · Over allocated' : ''}</span></span></span>
          </button>
          <div>
            <div className="flex h-2.5 overflow-hidden rounded-full bg-white/[0.05]" aria-label={`${row.label} status breakdown`}>{STATUS_SEGMENTS.map(([status, , color]) => row[status] > 0 && <span key={status} title={`${status.replaceAll('_', ' ')}: ${row[status]}`} className={color} style={{ width: `${row[status] / row.total * 100}%` }} />)}</div>
            <div className="mt-2 grid grid-cols-4 gap-2 text-center">{STATUS_SEGMENTS.map(([status, label]) => <div key={status}><p className="text-sm font-semibold text-slate-200">{row[status]}</p><p className="text-[9px] uppercase tracking-wide text-slate-600">{label}</p></div>)}</div>
          </div>
          <div className="flex gap-2 sm:justify-end"><button type="button" onClick={() => onFilter(row.assigneeId, 'list')} className="rounded-lg border border-white/10 px-3 py-2 text-[11px] font-semibold text-slate-300 hover:border-violet-500/30 hover:text-white">List</button><button type="button" onClick={() => onFilter(row.assigneeId, 'board')} className="rounded-lg border border-white/10 px-3 py-2 text-[11px] font-semibold text-slate-300 hover:border-violet-500/30 hover:text-white">Board</button></div>
        </article>)}
        {!rows.length && <div className="py-16 text-center text-sm text-slate-500">No work items match the current filters.</div>}
      </div>
    </div>
  </section>
}

function initials(label) {
  if (label === 'Unassigned') return '—'
  return label.split(/\s+/).slice(0, 2).map(part => part[0]).join('').toUpperCase()
}

function Metric({ label, value, warning = false }) {
  return <div className={`rounded-xl border px-4 py-3 ${warning ? 'border-red-500/25 bg-red-500/[0.06]' : 'border-white/[0.07] bg-[#0e111a]/80'}`}><p className={`text-xl font-semibold ${warning ? 'text-red-300' : 'text-white'}`}>{value}</p><p className="mt-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">{label}</p></div>
}
