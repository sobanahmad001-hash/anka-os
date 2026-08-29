import { useMemo, useState } from 'react'

import {
  buildPortfolioDashboard,
  filterAndSortPortfolioRows,
  PORTFOLIO_ENGAGEMENT_STATUSES,
  PORTFOLIO_TARGET_FILTERS,
} from '../data/portfolioDashboard.js'

const INPUT = 'w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2.5 text-sm text-white outline-none focus:border-violet-500/60'
const LABEL = 'mb-1.5 block text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500'
const labelize = value => String(value || '').replaceAll('_', ' ').replace(/\b\w/g, letter => letter.toUpperCase())

export default function PortfolioDashboard({ snapshot, owners, onOpen, onRefresh, supportNote = 'Partial journeys supported.' }) {
  const [filters, setFilters] = useState({ status: '', target: '', leadOwner: '' })
  const [sort, setSort] = useState({ key: 'target_date', direction: 'asc' })
  const dashboard = useMemo(() => buildPortfolioDashboard(snapshot), [snapshot])
  const rows = useMemo(() => filterAndSortPortfolioRows(dashboard.rows, filters, sort), [dashboard.rows, filters, sort])

  function toggleSort(key) {
    setSort(current => ({ key, direction: current.key === key && current.direction === 'asc' ? 'desc' : 'asc' }))
  }

  function openWithKeyboard(event, engagementId) {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      onOpen(engagementId)
    }
  }

  return <section className="mt-6 space-y-5" aria-labelledby="portfolio-heading">
    <div className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-violet-400">Live portfolio</p><h2 id="portfolio-heading" className="mt-1 text-xl font-semibold">Engagement portfolio</h2><p className="mt-1 max-w-2xl text-sm text-slate-500">Current delivery state across every engagement visible to your organisation membership. {supportNote}</p></div><div className="flex items-center gap-2"><p className="rounded-full border border-white/[0.08] bg-white/[0.025] px-3 py-1.5 text-[11px] text-slate-500">Live read · no cached metrics</p>{onRefresh && <button type="button" onClick={onRefresh} className="rounded-xl border border-white/10 px-3 py-2 text-xs font-semibold text-slate-300 hover:border-violet-500/30 hover:text-white">Refresh</button>}</div></div>

    <div className="grid gap-3 sm:grid-cols-3">
      <Summary label="Active engagements" value={dashboard.summary.activeEngagements} />
      <Summary label="Blocked stages" value={dashboard.summary.blockedStages} warning={dashboard.summary.blockedStages > 0} />
      <Summary label="Unacknowledged automation" value={dashboard.summary.flaggedAutomationItems} warning={dashboard.summary.flaggedAutomationItems > 0} />
    </div>

    <div className="grid gap-3 rounded-2xl border border-white/[0.07] bg-[#0e111a]/80 p-4 sm:grid-cols-3">
      <Filter label="Status" value={filters.status} onChange={status => setFilters(current => ({ ...current, status }))} options={PORTFOLIO_ENGAGEMENT_STATUSES.map(value => ({ value, label: labelize(value) }))} emptyLabel="All statuses" />
      <Filter label="Target date" value={filters.target} onChange={target => setFilters(current => ({ ...current, target }))} options={PORTFOLIO_TARGET_FILTERS} emptyLabel="Any target date" />
      <Filter label="Lead owner" value={filters.leadOwner} onChange={leadOwner => setFilters(current => ({ ...current, leadOwner }))} options={owners.map(owner => ({ value: owner.id, label: owner.label }))} emptyLabel="All lead owners" />
    </div>

    <div className="overflow-x-auto rounded-2xl border border-white/[0.07] bg-[#0e111a]/80">
      <table className="w-full min-w-[1120px] text-left text-sm">
        <thead className="bg-black/20 text-[10px] uppercase tracking-[0.12em] text-slate-500"><tr>
          <SortableHeader label="Engagement" sort={sort} field="name" onSort={toggleSort} />
          <th className="px-4 py-3 font-semibold">Client</th>
          <SortableHeader label="Status" sort={sort} field="status" onSort={toggleSort} />
          <SortableHeader label="Target" sort={sort} field="target_date" onSort={toggleSort} />
          <SortableHeader label="Lead" sort={sort} field="lead_owner_id" onSort={toggleSort} />
          <th className="px-4 py-3 font-semibold">Delivery rollup</th>
          <th className="px-4 py-3 font-semibold">Attention</th>
        </tr></thead>
        <tbody>{rows.map(row => <tr key={row.id} role="button" tabIndex="0" onClick={() => onOpen(row.id)} onKeyDown={event => openWithKeyboard(event, row.id)} className={`cursor-pointer border-t border-white/[0.06] outline-none transition hover:bg-white/[0.025] focus:bg-violet-500/[0.06] ${hasRisk(row) ? 'bg-amber-500/[0.025]' : ''}`}>
          <td className="px-4 py-4"><p className="font-semibold text-white">{row.name}</p><p className="mt-1 text-xs text-slate-600">{labelize(row.engagement_type)}</p></td>
          <td className="px-4 py-4"><p className="text-slate-300">{row.agency_clients?.name || 'Client unavailable'}</p><p className="mt-1 text-xs text-slate-600">{row.brands?.name || 'Brand unavailable'}</p></td>
          <td className="px-4 py-4"><Status value={row.status} /></td>
          <td className="px-4 py-4 text-slate-300">{dateLabel(row.target_date)}</td>
          <td className="px-4 py-4 text-slate-400">{ownerLabel(owners, row.lead_owner_id)}</td>
          <td className="px-4 py-4"><div className="grid grid-cols-3 gap-2"><Rollup label="Open" value={row.openWorkItems} /><Rollup label="Blocked" value={row.blockedWorkItems} warning={row.blockedWorkItems > 0} /><Rollup label="Stages left" value={row.incompleteStages} /></div></td>
          <td className="px-4 py-4"><div className="flex max-w-[230px] flex-wrap gap-1.5">{row.risks.targetDate && <Risk label="Target within 7 days" tone="amber" />}{row.risks.automation && <Risk label={`${row.flaggedAutomationItems} automation flag${row.flaggedAutomationItems === 1 ? '' : 's'}`} tone="fuchsia" />}{row.risks.blockedStage && <Risk label={`${row.blockedStages} blocked stage${row.blockedStages === 1 ? '' : 's'}`} tone="red" />}{!hasRisk(row) && <span className="text-xs text-slate-600">No fixed risk flag</span>}</div></td>
        </tr>)}</tbody>
      </table>
      {!rows.length && <div className="py-16 text-center text-sm text-slate-500">No engagements match these portfolio filters.</div>}
    </div>
  </section>
}

function hasRisk(row) {
  return row.risks.targetDate || row.risks.automation || row.risks.blockedStage
}

function ownerLabel(owners, id) {
  return owners.find(owner => owner.id === id)?.label || (id ? 'Unknown member' : 'Unassigned')
}

function dateLabel(value) {
  return value ? new Intl.DateTimeFormat('en', { dateStyle: 'medium' }).format(new Date(`${value}T00:00:00`)) : 'Not set'
}

function Summary({ label, value, warning = false }) { return <div className={`rounded-2xl border p-4 ${warning ? 'border-amber-500/25 bg-amber-500/[0.05]' : 'border-white/[0.07] bg-[#0e111a]/80'}`}><p className={`text-2xl font-semibold ${warning ? 'text-amber-300' : 'text-white'}`}>{value}</p><p className="mt-1 text-[10px] font-semibold uppercase tracking-[0.13em] text-slate-500">{label}</p></div> }
function Rollup({ label, value, warning = false }) { return <div className="rounded-lg bg-black/20 px-2 py-2 text-center"><p className={`font-semibold ${warning ? 'text-red-300' : 'text-slate-200'}`}>{value}</p><p className="mt-0.5 text-[9px] uppercase tracking-wide text-slate-600">{label}</p></div> }
function Risk({ label, tone }) { const palette = tone === 'red' ? 'bg-red-500/10 text-red-300' : tone === 'fuchsia' ? 'bg-fuchsia-500/10 text-fuchsia-300' : 'bg-amber-500/10 text-amber-300'; return <span className={`rounded-full px-2.5 py-1 text-[10px] font-semibold ${palette}`}>{label}</span> }
function Status({ value }) { const palette = value === 'active' ? 'bg-emerald-500/10 text-emerald-300' : value === 'on_hold' ? 'bg-amber-500/10 text-amber-300' : value === 'completed' ? 'bg-blue-500/10 text-blue-300' : value === 'cancelled' ? 'bg-red-500/10 text-red-300' : 'bg-slate-500/10 text-slate-300'; return <span className={`inline-flex rounded-full px-2.5 py-1 text-[11px] font-semibold ${palette}`}>{labelize(value)}</span> }
function Filter({ label, value, onChange, options, emptyLabel }) { return <label><span className={LABEL}>{label}</span><select className={INPUT} value={value} onChange={event => onChange(event.target.value)}><option value="">{emptyLabel}</option>{options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label> }
function SortableHeader({ label, sort, field, onSort }) { const indicator = sort.key === field ? (sort.direction === 'asc' ? ' ↑' : ' ↓') : ''; return <th className="px-4 py-3"><button type="button" onClick={() => onSort(field)} className="font-semibold hover:text-white">{label}{indicator}</button></th> }
