import { useMemo, useState } from 'react'

import { buildWorkItemCalendar, buildWorkItemTimeline } from '../data/workItems.js'

const DAY_MS = 24 * 60 * 60 * 1000
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

function dateAtUtc(value) {
  return new Date(`${value}T00:00:00Z`)
}

function todayIso() {
  return new Date().toISOString().slice(0, 10)
}

function monthLabel(value) {
  return new Intl.DateTimeFormat('en', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(dateAtUtc(value))
}

function shortDate(value) {
  return new Intl.DateTimeFormat('en', { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(dateAtUtc(value))
}

function moveDate(value, amount, mode) {
  const date = dateAtUtc(value)
  if (mode === 'week') date.setUTCDate(date.getUTCDate() + (amount * 7))
  else date.setUTCMonth(date.getUTCMonth() + amount, 1)
  return date.toISOString().slice(0, 10)
}

export function WorkCalendarView({ items, loading, onOpen }) {
  const [mode, setMode] = useState('month')
  const [anchorDate, setAnchorDate] = useState(todayIso)
  const [selectedDay, setSelectedDay] = useState(todayIso)
  const calendar = useMemo(() => buildWorkItemCalendar(items, dateAtUtc(anchorDate), mode), [items, anchorDate, mode])
  const selected = calendar.days.find(day => day.date === selectedDay)
  const dueOnSelectedDay = (selected?.items || []).filter(entry => entry.isDue)

  if (loading) return <Loading />
  return <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_260px]">
    <section className="min-w-0 overflow-hidden rounded-2xl border border-white/[0.07] bg-[#0e111a]/80">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-white/[0.07] px-4 py-3">
        <div><p className="text-sm font-semibold text-white">{monthLabel(anchorDate)}</p><p className="mt-0.5 text-xs text-slate-600">Full date ranges are shown across each applicable day.</p></div>
        <div className="flex items-center gap-2"><div aria-label="Calendar scale" className="flex rounded-lg border border-white/10 bg-black/20 p-1"><CalendarMode active={mode === 'month'} onClick={() => setMode('month')}>Month</CalendarMode><CalendarMode active={mode === 'week'} onClick={() => setMode('week')}>Week</CalendarMode></div><button type="button" onClick={() => setAnchorDate(moveDate(anchorDate, -1, mode))} aria-label={`Previous ${mode}`} className="rounded-lg border border-white/10 px-3 py-2 text-sm text-slate-400 hover:text-white">←</button><button type="button" onClick={() => { const today = todayIso(); setAnchorDate(today); setSelectedDay(today) }} className="rounded-lg border border-white/10 px-3 py-2 text-xs font-semibold text-slate-300 hover:text-white">Today</button><button type="button" onClick={() => setAnchorDate(moveDate(anchorDate, 1, mode))} aria-label={`Next ${mode}`} className="rounded-lg border border-white/10 px-3 py-2 text-sm text-slate-400 hover:text-white">→</button></div>
      </header>
      <div className="overflow-x-auto"><div className="min-w-[760px]"><div className="grid grid-cols-7 border-b border-white/[0.07] bg-black/10">{WEEKDAYS.map(day => <div key={day} className="px-3 py-2 text-center text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-600">{day}</div>)}</div>
        <div className="grid grid-cols-7">{calendar.days.map(day => <div key={day.date} className={`min-h-32 border-b border-r border-white/[0.06] p-2 ${day.inMonth || mode === 'week' ? '' : 'bg-black/15'}`}>
          <button type="button" onClick={() => setSelectedDay(day.date)} aria-pressed={selectedDay === day.date} className={`flex h-7 w-7 items-center justify-center rounded-full text-xs ${selectedDay === day.date ? 'bg-violet-500 font-semibold text-white' : day.date === todayIso() ? 'border border-violet-500/50 text-violet-300' : day.inMonth || mode === 'week' ? 'text-slate-300' : 'text-slate-700'}`}>{dateAtUtc(day.date).getUTCDate()}</button>
          <div className="mt-2 space-y-1">{day.items.slice(0, 4).map(({ item, isStart, isDue }) => <button type="button" key={`${day.date}-${item.id}`} onClick={() => onOpen(item)} title={`${item.title}${isDue ? ' · due' : ''}`} className={`block w-full truncate px-2 py-1 text-left text-[10px] font-medium ${isStart ? 'rounded-l-md' : ''} ${isDue ? 'rounded-r-md' : ''} ${item.status === 'done' ? 'bg-emerald-500/10 text-emerald-300' : 'bg-violet-500/12 text-violet-200'} hover:bg-violet-500/25`}>{isStart ? item.title : <span aria-label={item.title}>↔</span>}{isDue && <span className="ml-1 text-violet-400">•</span>}</button>)}{day.items.length > 4 && <button type="button" onClick={() => setSelectedDay(day.date)} className="px-2 text-[10px] text-slate-500">+{day.items.length - 4} more</button>}</div>
        </div>)}</div>
      </div></div>
      <div className="border-t border-white/[0.07] p-4"><p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">Due {selectedDay ? shortDate(selectedDay) : 'on selected day'}</p><div className="mt-3 flex flex-wrap gap-2">{dueOnSelectedDay.map(entry => <ItemPill key={entry.item.id} item={entry.item} onOpen={onOpen} />)}{!dueOnSelectedDay.length && <p className="text-xs text-slate-600">No work items are due on this day.</p>}</div></div>
    </section>
    <AsideList title="No due date" description="Still visible, but not placed on the calendar." entries={calendar.noDueDate.map(item => ({ item, depth: item.parent_work_item_id ? 1 : 0 }))} onOpen={onOpen} />
  </div>
}

export function WorkTimelineView({ items, dependencies, loading, onOpen }) {
  const timeline = useMemo(() => buildWorkItemTimeline(items, dependencies), [items, dependencies])
  if (loading) return <Loading />
  return <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_260px]">
    <section className="min-w-0 overflow-hidden rounded-2xl border border-white/[0.07] bg-[#0e111a]/80">
      <header className="border-b border-white/[0.07] px-4 py-3"><p className="text-sm font-semibold text-white">Timeline</p><p className="mt-0.5 text-xs text-slate-600">{shortDate(timeline.rangeStart)} – {shortDate(timeline.rangeEnd)} · inspect only; edit dates in work-item detail.</p></header>
      <div className="overflow-x-auto"><div className="relative min-w-[980px]">
        <div className="grid h-11 grid-cols-[260px_minmax(700px,1fr)] border-b border-white/[0.06]"><div className="px-4 py-3 text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-600">Work item</div><div className="relative">{axisTicks(timeline.rangeStart, timeline.totalDays).map(tick => <span key={tick.label} className="absolute top-3 -translate-x-1/2 text-[10px] text-slate-600" style={{ left: `${tick.left}%` }}>{tick.label}</span>)}</div></div>
        <div className="relative">
          <svg aria-label="Read-only dependency connectors" className="pointer-events-none absolute bottom-0 left-[260px] top-0 z-10 h-full overflow-visible" style={{ width: 'calc(100% - 260px)' }} viewBox={`0 0 1000 ${Math.max(1, timeline.rows.length * 56)}`} preserveAspectRatio="none"><defs><marker id="dependency-arrow" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto"><path d="M0,0 L7,3.5 L0,7 Z" fill="#f59e0b" /></marker></defs>{timeline.links.map(link => <path key={`${link.workItemId}-${link.dependsOnWorkItemId}`} d={dependencyPath(link)} fill="none" stroke="#f59e0b" strokeOpacity="0.55" strokeWidth="2" strokeDasharray="5 4" markerEnd="url(#dependency-arrow)" vectorEffect="non-scaling-stroke" />)}</svg>
          {timeline.rows.map(row => <div key={row.item.id} className="grid h-14 grid-cols-[260px_minmax(700px,1fr)] border-b border-white/[0.05]"><button type="button" onClick={() => onOpen(row.item)} className="flex min-w-0 items-center gap-2 px-4 text-left hover:bg-white/[0.025]" style={{ paddingLeft: `${16 + (row.depth * 20)}px` }}>{row.depth > 0 && <span className="text-slate-700">↳</span>}<span className="min-w-0 flex-1 truncate text-xs font-medium text-slate-300">{row.item.title}</span><span className="text-[9px] uppercase tracking-wide text-slate-600">{row.item.status.replaceAll('_', ' ')}</span></button><div className="relative bg-[linear-gradient(to_right,rgba(255,255,255,0.035)_1px,transparent_1px)] bg-[length:10%_100%]">
            {row.point ? <button type="button" onClick={() => onOpen(row.item)} aria-label={`Open ${row.item.title}, scheduled ${row.item.start_date || row.item.due_date}`} className="absolute top-1/2 z-20 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rotate-45 rounded-sm border border-violet-300 bg-violet-500 shadow-lg shadow-violet-950" style={{ left: `${row.left}%` }} /> : <button type="button" onClick={() => onOpen(row.item)} aria-label={`Open ${row.item.title}, ${row.item.start_date} to ${row.item.due_date}`} className="absolute top-1/2 z-20 h-5 -translate-y-1/2 rounded-full border border-violet-300/40 bg-violet-500/80 shadow-lg shadow-violet-950/60 hover:bg-violet-400" style={{ left: `${row.left}%`, width: `${row.width}%` }}><span className="sr-only">{row.item.title}</span></button>}
          </div></div>)}
          {!timeline.rows.length && <div className="py-16 text-center text-sm text-slate-600">No dated work items match this view.</div>}
        </div>
      </div></div>
      {!!timeline.links.length && <div className="border-t border-white/[0.06] px-4 py-3 text-[10px] text-amber-300/70">Dashed arrows point from blocked work toward the work item it depends on. They are view-only.</div>}
    </section>
    <AsideList title="Unscheduled" description="No start or due date. Open detail to schedule." entries={timeline.unscheduled} onOpen={onOpen} />
  </div>
}

function axisTicks(rangeStart, totalDays) {
  return Array.from({ length: 6 }, (_, index) => {
    const offset = Math.round((Math.max(1, totalDays - 1) * index) / 5)
    return { left: index * 20, label: shortDate(new Date(dateAtUtc(rangeStart).getTime() + (offset * DAY_MS)).toISOString().slice(0, 10)) }
  })
}

function dependencyPath(link) {
  const fromX = Math.max(0, Math.min(1000, link.fromX * 10))
  const toX = Math.max(0, Math.min(1000, link.toX * 10))
  const fromY = (link.fromRow * 56) + 28
  const toY = (link.toRow * 56) + 28
  const bendX = Math.max(12, Math.min(fromX, toX) - 18)
  return `M ${fromX} ${fromY} H ${bendX} V ${toY} H ${toX}`
}

function CalendarMode({ active, onClick, children }) { return <button type="button" aria-pressed={active} onClick={onClick} className={`rounded-md px-2.5 py-1.5 text-[10px] font-semibold ${active ? 'bg-white/10 text-white' : 'text-slate-500 hover:text-white'}`}>{children}</button> }
function ItemPill({ item, onOpen }) { return <button type="button" onClick={() => onOpen(item)} className="rounded-full border border-white/[0.08] bg-white/[0.035] px-3 py-1.5 text-xs text-slate-300 hover:border-violet-500/30 hover:text-white">{item.title}</button> }
function AsideList({ title, description, entries, onOpen }) { return <aside className="rounded-2xl border border-white/[0.07] bg-[#0e111a]/80 p-4"><h3 className="text-sm font-semibold text-white">{title}</h3><p className="mt-1 text-xs leading-5 text-slate-600">{description}</p><div className="mt-4 space-y-2">{entries.map(({ item, depth = 0 }) => <button type="button" key={item.id} onClick={() => onOpen(item)} className="flex w-full items-center gap-2 rounded-xl border border-white/[0.06] bg-white/[0.025] px-3 py-2.5 text-left text-xs text-slate-300 hover:border-violet-500/25" style={{ paddingLeft: `${12 + (depth * 16)}px` }}>{depth > 0 && <span className="text-slate-700">↳</span>}<span className="truncate">{item.title}</span></button>)}{!entries.length && <p className="py-4 text-xs text-slate-600">Nothing here.</p>}</div></aside> }
function Loading() { return <div className="rounded-2xl border border-white/[0.07] bg-[#0e111a]/80 py-16 text-center text-sm text-slate-500">Loading work items…</div> }
