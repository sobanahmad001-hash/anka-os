import { useCallback, useEffect, useMemo, useState } from 'react'

import { CONTENT_REQUEST_OUTPUT_PATHS } from '../data/contentRequests.js'
import { CONTENT_QUEUE_FORMATS, groupQueueEntriesByDate, newContentQueueEntry,
  queueEntriesForMonth, serializeContentQueueEntry } from '../data/contentQueue.js'
import { contentQueue } from '../data/contentQueueRepository.js'

const INPUT = 'w-full rounded-xl border border-slate-700 bg-slate-950 px-3.5 py-2.5 text-sm text-white outline-none focus:border-amber-500 focus:ring-2 focus:ring-amber-500/20'
const BUTTON = 'rounded-xl border border-slate-700 px-3 py-2 text-xs font-semibold text-slate-200 transition hover:border-amber-500 hover:text-white disabled:cursor-not-allowed disabled:opacity-50'
const PRIMARY = 'rounded-xl bg-amber-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-amber-500 disabled:cursor-not-allowed disabled:opacity-50'

export default function ContentQueuePanel() {
  const [workspace, setWorkspace] = useState({ entries: [], brands: [], events: [] })
  const [brandId, setBrandId] = useState('')
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7))
  const [form, setForm] = useState(() => newContentQueueEntry())
  const [outputPaths, setOutputPaths] = useState({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState({ error: '', message: '' })

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const data = await contentQueue.load()
      setWorkspace(data)
      setBrandId(current => current || data.brands[0]?.id || '')
      setForm(current => ({ ...current, brand_id: current.brand_id || data.brands[0]?.id || '' }))
    } catch (error) { setNotice({ error: error.message, message: '' }) }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])

  async function run(action, message) {
    setSaving(true); setNotice({ error: '', message: '' })
    try { await action(); setNotice({ error: '', message }); await load() }
    catch (error) { setNotice({ error: error.message, message: '' }) }
    finally { setSaving(false) }
  }

  async function create(event) {
    event.preventDefault()
    await run(() => contentQueue.create(serializeContentQueueEntry(form)), 'Queue plan added. No content request has been created.')
    setForm(newContentQueueEntry(brandId))
  }

  const entries = useMemo(() => queueEntriesForMonth(workspace.entries, month, brandId), [workspace.entries, month, brandId])
  const groups = useMemo(() => [...groupQueueEntriesByDate(entries)], [entries])
  const brandEvents = workspace.events.filter(event => event.brand_id === form.brand_id)

  return <div className="grid gap-6 xl:grid-cols-[minmax(0,0.75fr)_minmax(0,1.25fr)]">
    <form onSubmit={create} className="rounded-2xl border border-slate-800 bg-slate-900/70 p-6">
      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-amber-400">Human-planned queue</p>
      <h2 className="mt-1 text-2xl font-semibold">Plan content</h2>
      <p className="mt-2 text-sm leading-6 text-slate-400">A plan stays a plan until someone explicitly actions or skips it. Dates never trigger work automatically.</p>
      {(notice.error || notice.message) && <div className={`mt-5 rounded-xl border px-4 py-3 text-sm ${notice.error ? 'border-red-900/60 text-red-300' : 'border-emerald-900/60 text-emerald-300'}`}>{notice.error || notice.message}</div>}
      <div className="mt-6 space-y-5">
        <label className="block text-xs font-semibold uppercase tracking-[0.12em] text-slate-400">Brand<select required className={`${INPUT} mt-2 normal-case tracking-normal`} value={form.brand_id} onChange={event => setForm(current => ({ ...current, brand_id: event.target.value, linked_event_id: '' }))}><option value="">Select a brand</option>{workspace.brands.map(brand => <option key={brand.id} value={brand.id}>{brand.name}</option>)}</select></label>
        <label className="block text-xs font-semibold uppercase tracking-[0.12em] text-slate-400">Planned date<input required type="date" className={`${INPUT} mt-2 normal-case tracking-normal`} value={form.planned_date} onChange={event => setForm(current => ({ ...current, planned_date: event.target.value }))} /></label>
        <label className="block text-xs font-semibold uppercase tracking-[0.12em] text-slate-400">Format<select className={`${INPUT} mt-2 normal-case tracking-normal`} value={form.format} onChange={event => setForm(current => ({ ...current, format: event.target.value }))}>{CONTENT_QUEUE_FORMATS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label className="block text-xs font-semibold uppercase tracking-[0.12em] text-slate-400">Brief template<textarea rows="7" className={`${INPUT} mt-2 normal-case tracking-normal`} value={form.brief_template} onChange={event => setForm(current => ({ ...current, brief_template: event.target.value }))} placeholder="Add enough detail to action later. Empty plans can be saved, but not actioned." /></label>
        <label className="block text-xs font-semibold uppercase tracking-[0.12em] text-slate-400">Related event <span className="font-normal normal-case tracking-normal text-slate-600">(optional)</span><select className={`${INPUT} mt-2 normal-case tracking-normal`} value={form.linked_event_id} onChange={event => setForm(current => ({ ...current, linked_event_id: event.target.value }))}><option value="">No event</option>{brandEvents.map(item => <option key={item.id} value={item.id}>{item.start_date} · {item.event_name}</option>)}</select></label>
      </div>
      <div className="mt-6 flex justify-end border-t border-slate-800 pt-5"><button disabled={saving || loading} className={PRIMARY}>{saving ? 'Saving…' : 'Add to queue'}</button></div>
    </form>
    <section>
      <div className="flex flex-wrap items-end justify-between gap-4"><div><p className="text-xs font-semibold uppercase tracking-[0.14em] text-amber-400">Calendar / list</p><h2 className="mt-1 text-2xl font-semibold">Brand content queue</h2></div><div className="flex gap-3"><select aria-label="Queue brand" className={INPUT} value={brandId} onChange={event => { setBrandId(event.target.value); setForm(current => ({ ...current, brand_id: event.target.value, linked_event_id: '' })) }}>{workspace.brands.map(brand => <option key={brand.id} value={brand.id}>{brand.name}</option>)}</select><input aria-label="Queue month" type="month" className={INPUT} value={month} onChange={event => setMonth(event.target.value)} /></div></div>
      <div className="mt-5 space-y-5">{groups.map(([date, dateEntries]) => <section key={date}><h3 className="mb-2 text-sm font-semibold text-slate-300">{new Date(`${date}T00:00:00`).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}</h3><div className="grid gap-3">{dateEntries.map(entry => <article key={entry.id} className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs font-semibold uppercase tracking-[0.12em] text-amber-400">{entry.format.replaceAll('_', ' ')}</p><p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-300">{entry.brief_template || 'Brief not added yet'}</p></div><span className="rounded-full bg-slate-950 px-2.5 py-1 text-[10px] font-semibold uppercase text-slate-300">{entry.status}</span></div>{entry.linked_event_id && <p className="mt-3 text-xs text-slate-500">Linked event: {workspace.events.find(item => item.id === entry.linked_event_id)?.event_name || 'Event'}</p>}{entry.status === 'planned' && <div className="mt-4 flex flex-wrap items-center gap-2"><select aria-label="Action output path" className={`${INPUT} max-w-56 py-2 text-xs`} value={outputPaths[entry.id] || 'internal_engine'} onChange={event => setOutputPaths(current => ({ ...current, [entry.id]: event.target.value }))}>{CONTENT_REQUEST_OUTPUT_PATHS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select><button type="button" disabled={saving || !entry.brief_template.trim()} onClick={() => run(() => contentQueue.action(entry.id, outputPaths[entry.id] || 'internal_engine'), 'Queue entry actioned as one general content request.')} className={PRIMARY}>Action</button><button type="button" disabled={saving} onClick={() => run(() => contentQueue.skip(entry.id), 'Queue entry skipped. No request was created.')} className={BUTTON}>Skip</button></div>}{entry.fulfilled_by_request_id && <p className="mt-3 text-xs text-emerald-400">Fulfilled by request {entry.fulfilled_by_request_id.slice(0, 8)}…</p>}</article>)}</div></section>)}{!loading && !groups.length && <div className="rounded-2xl border border-dashed border-slate-700 p-12 text-center text-sm text-slate-500">No queue plans for this brand and month.</div>}</div>
    </section>
  </div>
}
