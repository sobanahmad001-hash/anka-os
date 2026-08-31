import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'

import { externalEvents } from '../data/externalEventsRepository.js'
import { workItems } from '../data/workItemsRepository.js'
import { EVENT_CATEGORIES, EVENT_CONTENT_TYPES, EVENT_LINK_STATUSES, calendarMonth, displayWorkItem, dueLabel } from '../data/externalEvents.js'
import { contentCalendarPath, workshopSessionPath } from '../data/contentDesignEventLinking.js'

const INPUT = 'w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm text-white outline-none focus:border-violet-500'
const BUTTON = 'rounded-xl bg-violet-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-violet-500 disabled:cursor-not-allowed disabled:opacity-50'
const EMPTY_EVENT = { eventName: '', eventCategory: 'conference', venue: '', location: '', startDate: '', endDate: '', sourceUrl: '' }
const EMPTY_LINK = { contentType: 'blog', leadTimeDays: 14, status: 'planned', linkedWorkItemId: '', createWorkItem: false, engagementId: '', workItemTitle: '' }

function labelize(value) {
  return String(value || '').replaceAll('_', ' ').replace(/\b\w/g, letter => letter.toUpperCase())
}

function Panel({ title, description, children }) {
  return <section className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5"><h2 className="text-base font-semibold text-white">{title}</h2>{description && <p className="mt-1 text-sm text-slate-500">{description}</p>}<div className="mt-4">{children}</div></section>
}

export default function ExternalEvents() {
  const [brands, setBrands] = useState([])
  const [brandId, setBrandId] = useState('')
  const [events, setEvents] = useState([])
  const [eventId, setEventId] = useState('')
  const [links, setLinks] = useState([])
  const [due, setDue] = useState([])
  const [engagements, setEngagements] = useState([])
  const [availableWorkItems, setAvailableWorkItems] = useState([])
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7))
  const [eventDraft, setEventDraft] = useState(EMPTY_EVENT)
  const [linkDraft, setLinkDraft] = useState(EMPTY_LINK)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

  useEffect(() => {
    externalEvents.listBrands().then(rows => {
      setBrands(rows || [])
      setBrandId(rows?.[0]?.id || '')
    }).catch(loadError => setError(loadError.message))
  }, [])

  async function loadBrand(nextBrandId, preferredEventId = '') {
    if (!nextBrandId) return
    const [eventRows, dueRows, engagementRows, workItemRows] = await Promise.all([
      externalEvents.list(nextBrandId), externalEvents.listDue(nextBrandId),
      externalEvents.listEngagements(nextBrandId), externalEvents.listWorkItems(nextBrandId),
    ])
    setEvents(eventRows || []); setDue(dueRows || []); setEngagements(engagementRows || []); setAvailableWorkItems(workItemRows || [])
    setEventId(preferredEventId || eventRows?.[0]?.id || '')
  }

  useEffect(() => {
    loadBrand(brandId).catch(loadError => setError(loadError.message))
  }, [brandId])

  useEffect(() => {
    if (!eventId) { setLinks([]); return }
    externalEvents.listLinks(eventId).then(setLinks).catch(loadError => setError(loadError.message))
  }, [eventId])

  const selectedEvent = events.find(item => item.id === eventId)
  const monthEvents = useMemo(() => calendarMonth(events, month), [events, month])

  async function createEvent(event) {
    event.preventDefault(); setBusy(true); setError(''); setMessage('')
    try {
      const saved = await externalEvents.saveEvent({ ...eventDraft, brandId })
      setEventDraft(EMPTY_EVENT); await loadBrand(brandId, saved.id); setMessage('Event added to the shared Sphere calendar.')
    } catch (saveError) { setError(saveError.message) } finally { setBusy(false) }
  }

  async function createLink(event) {
    event.preventDefault(); setBusy(true); setError(''); setMessage('')
    try {
      let linkedWorkItemId = linkDraft.linkedWorkItemId || null
      if (linkDraft.createWorkItem) {
        if (!linkDraft.engagementId || !linkDraft.workItemTitle.trim()) throw new Error('Engagement and work item title are required')
        const item = await workItems.save({
          engagementId: linkDraft.engagementId, title: linkDraft.workItemTitle,
          description: `Created from the ${selectedEvent.event_name} external event plan.`,
          workItemType: 'task', priority: 'medium', status: 'not_started', departmentId: null,
          startDate: null, dueDate: selectedEvent.start_date, position: 0,
        })
        linkedWorkItemId = item.id
      }
      await externalEvents.saveLink({ ...linkDraft, eventId, linkedWorkItemId })
      setLinkDraft(EMPTY_LINK)
      const [nextLinks] = await Promise.all([externalEvents.listLinks(eventId), loadBrand(brandId, eventId)])
      setLinks(nextLinks || []); setMessage('Content plan linked to this event.')
    } catch (saveError) { setError(saveError.message) } finally { setBusy(false) }
  }

  async function updateLinkStatus(link, status) {
    setBusy(true); setError(''); setMessage('')
    try {
      await externalEvents.saveLink({
        linkId: link.id, contentType: link.content_type, leadTimeDays: link.lead_time_days,
        linkedWorkItemId: link.linked_work_item_id, status,
      })
      setLinks(await externalEvents.listLinks(eventId) || [])
      setDue(await externalEvents.listDue(brandId) || [])
      setMessage('Content plan status updated.')
    } catch (saveError) { setError(saveError.message) } finally { setBusy(false) }
  }

  return <div className="h-full overflow-y-auto bg-slate-950 text-white">
    <header className="border-b border-slate-800 px-6 py-5"><div className="mx-auto flex max-w-7xl flex-wrap items-end justify-between gap-4"><div><p className="text-xs font-semibold uppercase tracking-[0.16em] text-violet-400">Shared planning</p><h1 className="mt-1 text-2xl font-semibold">Sphere Events</h1><p className="mt-2 text-sm text-slate-400">Plan timely Content, Marketing, and Design work around real-world moments.</p></div><label className="min-w-64 text-xs font-semibold uppercase tracking-wide text-slate-400">Brand<select className={`${INPUT} mt-2 normal-case`} value={brandId} onChange={event => setBrandId(event.target.value)}>{brands.map(brand => <option key={brand.id} value={brand.id}>{brand.name}</option>)}</select></label></div></header>
    <main className="mx-auto max-w-7xl space-y-5 p-6">
      {error && <div className="rounded-xl border border-red-900 bg-red-950/50 px-4 py-3 text-sm text-red-300">{error}</div>}
      {message && <div className="rounded-xl border border-emerald-900 bg-emerald-950/50 px-4 py-3 text-sm text-emerald-300">{message}</div>}
      <div className="grid gap-5 xl:grid-cols-[1.45fr_1fr]">
        <Panel title="Brand event calendar" description="Choose a month, then open an event to coordinate every content type together.">
          <input type="month" className={`${INPUT} mb-4 max-w-48`} value={month} onChange={event => setMonth(event.target.value)} />
          <div className="grid gap-3 md:grid-cols-2">{monthEvents.map(item => <button key={item.id} onClick={() => setEventId(item.id)} className={`rounded-xl border p-4 text-left ${item.id === eventId ? 'border-violet-500 bg-violet-950/30' : 'border-slate-800 bg-slate-950/50 hover:border-slate-600'}`}><div className="flex justify-between gap-3"><p className="font-medium">{item.event_name}</p><span className="text-xs text-violet-300">{labelize(item.event_category)}</span></div><p className="mt-2 text-xs text-slate-500">{item.start_date}{item.end_date ? ` – ${item.end_date}` : ''}{item.location ? ` · ${item.location}` : ''}</p></button>)}{!monthEvents.length && <p className="text-sm text-slate-500">No events in this month.</p>}</div>
        </Panel>
        <Panel title="Due now" description="Planned or in-progress items whose lead-time date has arrived."><div className="space-y-2">{due.map(item => <button key={item.id} onClick={() => setEventId(item.external_event_id)} className="w-full rounded-xl border border-amber-900/50 bg-amber-950/20 p-3 text-left"><div className="flex justify-between gap-3"><p className="text-sm font-medium">{item.event_name} · {labelize(item.content_type)}</p><span className="text-xs text-amber-300">{dueLabel(item.due_date)}</span></div><p className="mt-1 text-xs text-slate-500">Event {item.event_start_date} · {labelize(item.status)}</p></button>)}{!due.length && <p className="text-sm text-slate-500">Nothing has reached its lead-time date.</p>}</div></Panel>
      </div>

      <div className="grid gap-5 xl:grid-cols-[1fr_1.45fr]">
        <Panel title="Add external event" description="Events belong to the selected brand."><form className="grid gap-3" onSubmit={createEvent}><input className={INPUT} placeholder="Event name" maxLength={200} required value={eventDraft.eventName} onChange={e => setEventDraft({ ...eventDraft, eventName: e.target.value })}/><select className={INPUT} value={eventDraft.eventCategory} onChange={e => setEventDraft({ ...eventDraft, eventCategory: e.target.value })}>{EVENT_CATEGORIES.map(value => <option key={value} value={value}>{labelize(value)}</option>)}</select><div className="grid grid-cols-2 gap-3"><input type="date" className={INPUT} required value={eventDraft.startDate} onChange={e => setEventDraft({ ...eventDraft, startDate: e.target.value })}/><input type="date" className={INPUT} min={eventDraft.startDate} value={eventDraft.endDate} onChange={e => setEventDraft({ ...eventDraft, endDate: e.target.value })}/></div><input className={INPUT} placeholder="Venue (optional)" value={eventDraft.venue} onChange={e => setEventDraft({ ...eventDraft, venue: e.target.value })}/><input className={INPUT} placeholder="Location (optional)" value={eventDraft.location} onChange={e => setEventDraft({ ...eventDraft, location: e.target.value })}/><input type="url" className={INPUT} placeholder="Source URL (optional)" value={eventDraft.sourceUrl} onChange={e => setEventDraft({ ...eventDraft, sourceUrl: e.target.value })}/><button className={BUTTON} disabled={busy || !brandId}>Add event</button></form></Panel>

        <Panel title={selectedEvent?.event_name || 'Event content plan'} description={selectedEvent ? `${selectedEvent.start_date} · ${labelize(selectedEvent.event_category)}` : 'Select an event to plan content.'}>
          {selectedEvent && <><div className="grid gap-2 md:grid-cols-2">{links.map(link => <EventContentLinkCard key={link.id} link={link} brandId={brandId} busy={busy} onStatus={updateLinkStatus} />)}{!links.length && <p className="text-sm text-slate-500">No content linked yet. Multiple items of the same type are supported.</p>}</div>
          <form className="mt-5 grid gap-3 border-t border-slate-800 pt-5" onSubmit={createLink}><div className="grid gap-3 md:grid-cols-3"><select className={INPUT} value={linkDraft.contentType} onChange={e => setLinkDraft({ ...linkDraft, contentType: e.target.value })}>{EVENT_CONTENT_TYPES.map(value => <option key={value} value={value}>{labelize(value)}</option>)}</select><input type="number" min="0" className={INPUT} value={linkDraft.leadTimeDays} onChange={e => setLinkDraft({ ...linkDraft, leadTimeDays: Number(e.target.value) })}/><select className={INPUT} value={linkDraft.status} onChange={e => setLinkDraft({ ...linkDraft, status: e.target.value })}>{EVENT_LINK_STATUSES.map(value => <option key={value} value={value}>{labelize(value)}</option>)}</select></div><select className={INPUT} disabled={linkDraft.createWorkItem} value={linkDraft.linkedWorkItemId} onChange={e => setLinkDraft({ ...linkDraft, linkedWorkItemId: e.target.value })}><option value="">No existing work item</option>{availableWorkItems.map(item => <option key={item.id} value={item.id}>{item.title}</option>)}</select><label className="flex items-center gap-2 text-sm text-slate-300"><input type="checkbox" checked={linkDraft.createWorkItem} onChange={e => setLinkDraft({ ...linkDraft, createWorkItem: e.target.checked, linkedWorkItemId: '' })}/>Create a new work item first</label>{linkDraft.createWorkItem && <div className="grid gap-3 md:grid-cols-2"><select className={INPUT} required value={linkDraft.engagementId} onChange={e => setLinkDraft({ ...linkDraft, engagementId: e.target.value })}><option value="">Select engagement</option>{engagements.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select><input className={INPUT} required placeholder="Work item title" value={linkDraft.workItemTitle} onChange={e => setLinkDraft({ ...linkDraft, workItemTitle: e.target.value })}/></div>}<button className={BUTTON} disabled={busy}>Add content plan</button></form></>}
        </Panel>
      </div>
    </main>
  </div>
}

function EventContentLinkCard({ link, brandId, busy, onStatus }) {
  const workshopPath = link.content_type === 'design_asset' ? workshopSessionPath(link.design_workshop_session) : null
  const contentPath = link.content_type === 'blog' ? contentCalendarPath(brandId, link.id) : null
  return <div className="rounded-xl border border-slate-800 bg-slate-950/50 p-3"><div className="flex items-center justify-between gap-2"><span className="rounded-full bg-violet-950 px-2 py-1 text-xs text-violet-300">{labelize(link.content_type)}</span><select aria-label={`Status for ${labelize(link.content_type)}`} disabled={busy} className="rounded-lg border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-slate-300" value={link.status} onChange={event => onStatus(link, event.target.value)}>{EVENT_LINK_STATUSES.map(value => <option key={value} value={value}>{labelize(value)}</option>)}</select></div><p className="mt-2 text-sm">{displayWorkItem(link)}</p><p className="mt-1 text-xs text-slate-500">Lead time {link.lead_time_days} days</p>{workshopPath && <Link className="mt-3 inline-flex text-xs font-semibold text-violet-300 hover:text-violet-200" to={workshopPath}>Open actual Workshop session →</Link>}{contentPath && <Link className="mt-3 inline-flex text-xs font-semibold text-amber-300 hover:text-amber-200" to={contentPath}>Open Content blog calendar →</Link>}</div>
}
