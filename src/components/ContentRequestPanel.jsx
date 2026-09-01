import { useCallback, useEffect, useState } from 'react'

import {
  CONTENT_REQUEST_FORMATS,
  CONTENT_REQUEST_OUTPUT_PATHS,
  mediaStatusTone,
  newContentRequest,
  requestAssets,
  serializeContentRequest,
} from '../data/contentRequests.js'
import { contentRequests } from '../data/contentRequestsRepository.js'
import ContentRequestReviewPanels from './ContentRequestReviewPanels.jsx'

const INPUT = 'w-full rounded-xl border border-slate-700 bg-slate-950 px-3.5 py-2.5 text-sm text-white outline-none focus:border-amber-500 focus:ring-2 focus:ring-amber-500/20'
const BUTTON = 'rounded-xl border border-slate-700 px-4 py-2 text-sm font-semibold text-slate-200 transition hover:border-amber-500 hover:text-white disabled:cursor-not-allowed disabled:opacity-50'
const PRIMARY = 'rounded-xl bg-amber-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-amber-500 disabled:cursor-not-allowed disabled:opacity-50'
const TONES = {
  amber: 'bg-amber-950 text-amber-300',
  blue: 'bg-blue-950 text-blue-300',
  emerald: 'bg-emerald-950 text-emerald-300',
  red: 'bg-red-950 text-red-300',
}

export default function ContentRequestPanel({ engagement }) {
  const engagementId = engagement?.id || ''
  const brandId = engagement?.brand_id || ''
  const [form, setForm] = useState(() => newContentRequest(engagement))
  const [workspace, setWorkspace] = useState({ requests: [], assets: [], handoffs: [], events: [], models: [] })
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

  const load = useCallback(async () => {
    if (!engagementId) return
    setLoading(true); setError('')
    try {
      const next = await contentRequests.loadProject({ id: engagementId, brand_id: brandId })
      setWorkspace(next)
      setForm(current => ({
        ...current,
        engagement_id: engagementId,
        brand_id: brandId,
        model_registry_id: current.model_registry_id || next.models[0]?.id || '',
      }))
    } catch (reason) { setError(reason.message) }
    finally { setLoading(false) }
  }, [brandId, engagementId])

  useEffect(() => {
    setForm(newContentRequest({ id: engagementId, brand_id: brandId }))
    load()
  }, [brandId, engagementId, load])

  async function submit(event) {
    event.preventDefault()
    setSaving(true); setError(''); setMessage('')
    let createdRequest = null
    try {
      if (form.output_path === 'internal_engine' && form.media_type === 'image' && !form.model_registry_id) {
        throw new Error('Select an active image model before generating media')
      }
      const result = await contentRequests.create(serializeContentRequest(form))
      createdRequest = result?.request
      if (!createdRequest?.id) throw new Error('The content request was not returned after creation')
      if (form.output_path === 'internal_engine') {
        if (form.media_type === 'video') {
          await contentRequests.createVideoPlaceholder(createdRequest.id, form.brief)
        } else {
          await contentRequests.generateImage(createdRequest.id, form.model_registry_id, form.brief)
        }
      } else await contentRequests.ensureFigmaHandoff(createdRequest.id)
      setMessage(form.output_path === 'internal_engine'
        ? 'Content request created and sent through the existing Design Media pipeline.'
        : 'Content request created and its authenticated Figma reference page is ready.')
      setForm({ ...newContentRequest(engagement), model_registry_id: workspace.models[0]?.id || '' })
    } catch (reason) {
      setError(createdRequest
        ? `The request was saved, but its first media output could not finish: ${reason.message}`
        : reason.message)
    } finally {
      await load()
      setSaving(false)
    }
  }

  const linkedEvent = workspace.events.find(item => item.id === form.linked_event_id)

  return <div className="grid gap-6 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
    <form onSubmit={submit} className="rounded-2xl border border-slate-800 bg-slate-900/70 p-6">
      <div><p className="text-xs font-semibold uppercase tracking-[0.14em] text-amber-400">Project-mode request</p><h2 className="mt-1 text-2xl font-semibold">Create production content</h2><p className="mt-2 text-sm leading-6 text-slate-400">Create one reel, post, story set, or design element. Event context is always optional; routine content follows the same path.</p></div>
      {(error || message) && <div className={`mt-5 rounded-xl border px-4 py-3 text-sm ${error ? 'border-red-900/60 bg-red-950/40 text-red-300' : 'border-emerald-900/60 bg-emerald-950/30 text-emerald-300'}`}>{error || message}</div>}
      <div className="mt-6 space-y-5">
        <label className="block text-xs font-semibold uppercase tracking-[0.12em] text-slate-400">Format<select className={`${INPUT} mt-2 normal-case tracking-normal`} value={form.format} onChange={event => setForm(current => ({ ...current, format: event.target.value }))}>{CONTENT_REQUEST_FORMATS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label className="block text-xs font-semibold uppercase tracking-[0.12em] text-slate-400">Production brief<textarea required rows="8" className={`${INPUT} mt-2 normal-case tracking-normal`} value={form.brief} onChange={event => setForm(current => ({ ...current, brief: event.target.value }))} placeholder="Describe the message, audience, hook, required copy, visual direction, and channel constraints." /></label>
        <label className="block text-xs font-semibold uppercase tracking-[0.12em] text-slate-400">Optional event<select className={`${INPUT} mt-2 normal-case tracking-normal`} value={form.linked_event_id} onChange={event => setForm(current => ({ ...current, linked_event_id: event.target.value, create_event_link: event.target.value ? current.create_event_link : false }))}><option value="">No event — routine or recurring content</option>{workspace.events.map(item => <option key={item.id} value={item.id}>{item.event_name} · {item.start_date}</option>)}</select></label>
        {linkedEvent && <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-4"><p className="text-sm font-semibold text-white">{linkedEvent.event_name}</p><p className="mt-1 text-xs text-slate-500">{linkedEvent.event_category} · {linkedEvent.start_date}{linkedEvent.location ? ` · ${linkedEvent.location}` : ''}</p><label className="mt-4 flex items-start gap-3 text-sm text-slate-300"><input type="checkbox" className="mt-1" checked={form.create_event_link} onChange={event => setForm(current => ({ ...current, create_event_link: event.target.checked }))} /><span>Add this request to MK1’s lead-time plan. The event remains optional even when this is off.</span></label>{form.create_event_link && <div className="mt-4 grid gap-3 sm:grid-cols-2"><label className="text-xs font-semibold uppercase tracking-[0.1em] text-slate-500">Plan type<select className={`${INPUT} mt-2 normal-case tracking-normal`} value={form.event_content_type} onChange={event => setForm(current => ({ ...current, event_content_type: event.target.value }))}><option value="social">Social</option><option value="blog">Blog</option></select></label><label className="text-xs font-semibold uppercase tracking-[0.1em] text-slate-500">Lead time (days)<input type="number" min="0" step="1" className={`${INPUT} mt-2 normal-case tracking-normal`} value={form.lead_time_days} onChange={event => setForm(current => ({ ...current, lead_time_days: event.target.value }))} /></label></div>}</div>}
        <label className="block text-xs font-semibold uppercase tracking-[0.12em] text-slate-400">Output path<select className={`${INPUT} mt-2 normal-case tracking-normal`} value={form.output_path} onChange={event => setForm(current => ({ ...current, output_path: event.target.value }))}>{CONTENT_REQUEST_OUTPUT_PATHS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        {form.output_path === 'internal_engine' ? <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-4"><p className="text-xs font-semibold uppercase tracking-[0.12em] text-amber-400">Existing Design Media pipeline</p><div className="mt-4 grid gap-4 sm:grid-cols-2"><label className="text-xs font-semibold uppercase tracking-[0.1em] text-slate-500">First output<select className={`${INPUT} mt-2 normal-case tracking-normal`} value={form.media_type} onChange={event => setForm(current => ({ ...current, media_type: event.target.value }))}><option value="image">Image</option><option value="video">Video request</option></select></label>{form.media_type === 'image' && <label className="text-xs font-semibold uppercase tracking-[0.1em] text-slate-500">Registered model<select required className={`${INPUT} mt-2 normal-case tracking-normal`} value={form.model_registry_id} onChange={event => setForm(current => ({ ...current, model_registry_id: event.target.value }))}><option value="">Select model</option>{workspace.models.map(model => <option key={model.id} value={model.id}>{model.display_name}</option>)}</select></label>}</div>{form.media_type === 'video' && <p className="mt-3 text-xs text-amber-300">The existing pipeline records an honest unavailable placeholder until a video provider is configured.</p>}</div> : <p className="rounded-xl border border-slate-800 bg-slate-950/60 p-4 text-xs leading-5 text-slate-400">This creates the request now. CP3 will generate and attach the designer reference-page URL; no Figma file is created automatically.</p>}
      </div>
      <div className="mt-6 flex justify-end border-t border-slate-800 pt-5"><button disabled={saving || loading} className={PRIMARY}>{saving ? 'Creating…' : 'Create content request'}</button></div>
    </form>
    <section className="space-y-4">
      <div className="flex items-end justify-between gap-4"><div><p className="text-xs font-semibold uppercase tracking-[0.14em] text-amber-400">Current engagement</p><h2 className="mt-1 text-2xl font-semibold">Production requests</h2></div><button type="button" onClick={load} disabled={loading} className={BUTTON}>{loading ? 'Loading…' : 'Refresh'}</button></div>
      {loading ? <div className="rounded-2xl border border-slate-800 p-12 text-center text-sm text-slate-500">Loading content requests…</div> : workspace.requests.length ? workspace.requests.map(request => <RequestCard key={request.id} request={request} assets={requestAssets(request, workspace.assets)} handoff={workspace.handoffs.find(item => item.content_request_id === request.id)} event={workspace.events.find(item => item.id === request.linked_event_id)} onRepair={async () => { setSaving(true); setError(''); try { await contentRequests.ensureFigmaHandoff(request.id); setMessage('Authenticated Figma reference page is ready.'); await load() } catch (reason) { setError(reason.message) } finally { setSaving(false) } }} />) : <div className="rounded-2xl border border-dashed border-slate-700 p-12 text-center text-sm text-slate-500">No content requests yet for this engagement.</div>}
    </section>
  </div>
}

function RequestCard({ request, assets, handoff, event, onRepair }) {
  return <article className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs font-semibold uppercase tracking-[0.12em] text-amber-400">{request.format.replaceAll('_', ' ')}</p><p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-300">{request.brief}</p></div><span className="rounded-full bg-slate-950 px-2.5 py-1 text-[10px] font-semibold uppercase text-slate-300">{request.status.replaceAll('_', ' ')}</span></div>
    <div className="mt-4 flex flex-wrap gap-2 text-[11px] text-slate-500"><span>{request.output_path === 'internal_engine' ? 'Anka OS media' : 'Figma handoff'}</span><span>·</span><span>{event ? `Event: ${event.event_name}` : 'No event linked'}</span><span>·</span><span>{new Date(request.created_at).toLocaleString()}</span></div>
    {request.output_path === 'figma_handoff' && (handoff ? <div className="mt-4 flex flex-wrap items-center gap-3 rounded-xl border border-amber-900/50 bg-amber-950/20 p-3"><a href={handoff.figma_handoff_url} className="text-sm font-semibold text-amber-300 hover:text-amber-200">Open authenticated Figma reference →</a><span className="text-xs text-slate-500">No Figma API or file creation</span></div> : <button type="button" onClick={onRepair} className={`${BUTTON} mt-4`}>Create missing handoff page</button>)}
    {assets.length > 0 && <div className="mt-4 grid gap-3 sm:grid-cols-2">{assets.map(asset => <div key={asset.id} className="overflow-hidden rounded-xl border border-slate-800 bg-slate-950/60">{asset.signed_url && <img src={asset.signed_url} alt="Generated content request output" className="aspect-video w-full object-cover" />}<div className="p-3"><div className="flex items-center justify-between gap-2"><p className="text-xs font-semibold capitalize text-white">{asset.media_type}</p><span className={`rounded-full px-2 py-1 text-[10px] font-semibold uppercase ${TONES[mediaStatusTone(asset.status)]}`}>{asset.status}</span></div>{asset.failure_reason && <p className="mt-2 text-xs leading-5 text-red-300">{asset.failure_reason}</p>}</div></div>)}</div>}
    <ContentRequestReviewPanels request={request} />
  </article>
}
