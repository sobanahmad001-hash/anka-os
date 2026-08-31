import { useCallback, useEffect, useMemo, useState } from 'react'

import {
  CONTENT_REQUEST_FORMATS,
  CONTENT_REQUEST_OUTPUT_PATHS,
  newGeneralContentRequest,
  serializeGeneralContentRequest,
} from '../data/contentRequests.js'
import { contentRequests } from '../data/contentRequestsRepository.js'

const INPUT = 'w-full rounded-xl border border-slate-700 bg-slate-950 px-3.5 py-2.5 text-sm text-white outline-none focus:border-amber-500 focus:ring-2 focus:ring-amber-500/20'
const BUTTON = 'rounded-xl border border-slate-700 px-4 py-2 text-sm font-semibold text-slate-200 transition hover:border-amber-500 hover:text-white disabled:cursor-not-allowed disabled:opacity-50'
const PRIMARY = 'rounded-xl bg-amber-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-amber-500 disabled:cursor-not-allowed disabled:opacity-50'

export default function GeneralContentRequestsPanel() {
  const [form, setForm] = useState(() => newGeneralContentRequest())
  const [workspace, setWorkspace] = useState({ requests: [], brands: [], handoffs: [] })
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try { setWorkspace(await contentRequests.loadGeneral()) }
    catch (reason) { setError(reason.message) }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])

  async function submit(event) {
    event.preventDefault()
    setSaving(true); setError(''); setMessage('')
    try {
      const result = await contentRequests.create(serializeGeneralContentRequest(form))
      if (form.output_path === 'figma_handoff') {
        if (!result?.request?.id) throw new Error('The content request was not returned after creation')
        await contentRequests.ensureFigmaHandoff(result.request.id)
      }
      setMessage(form.output_path === 'internal_engine'
        ? 'General request saved. Automatic media generation remains project-only for now.'
        : 'General request saved and its authenticated Figma reference page is ready.')
      setForm(newGeneralContentRequest())
      await load()
    } catch (reason) { setError(reason.message) }
    finally { setSaving(false) }
  }

  const brandNames = useMemo(() => new Map(workspace.brands.map(brand => [brand.id, brand.name])), [workspace.brands])

  return <div className="grid gap-6 xl:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)]">
    <form onSubmit={submit} className="rounded-2xl border border-slate-800 bg-slate-900/70 p-6">
      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-amber-400">Quick content entry</p>
      <h2 className="mt-1 text-2xl font-semibold">Make a post or reel</h2>
      <p className="mt-2 text-sm leading-6 text-slate-400">Capture production work without choosing a client or engagement first. Add a brand only when it is already known.</p>
      {(error || message) && <div className={`mt-5 rounded-xl border px-4 py-3 text-sm ${error ? 'border-red-900/60 bg-red-950/40 text-red-300' : 'border-emerald-900/60 bg-emerald-950/30 text-emerald-300'}`}>{error || message}</div>}
      <div className="mt-6 space-y-5">
        <label className="block text-xs font-semibold uppercase tracking-[0.12em] text-slate-400">What do you need?<textarea required rows="8" className={`${INPUT} mt-2 normal-case tracking-normal`} value={form.brief} onChange={event => setForm(current => ({ ...current, brief: event.target.value }))} placeholder="Example: A short reel announcing the September offer, with a direct hook and clear call to action." /></label>
        <label className="block text-xs font-semibold uppercase tracking-[0.12em] text-slate-400">Format<select className={`${INPUT} mt-2 normal-case tracking-normal`} value={form.format} onChange={event => setForm(current => ({ ...current, format: event.target.value }))}>{CONTENT_REQUEST_FORMATS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label className="block text-xs font-semibold uppercase tracking-[0.12em] text-slate-400">Output path<select className={`${INPUT} mt-2 normal-case tracking-normal`} value={form.output_path} onChange={event => setForm(current => ({ ...current, output_path: event.target.value }))}>{CONTENT_REQUEST_OUTPUT_PATHS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <p className="rounded-xl border border-slate-800 bg-slate-950/60 p-3 text-xs leading-5 text-slate-400">Internal generation remains project-only. CP3 owns Figma reference-page generation and stores the authenticated page URL on the request.</p>
        <label className="block text-xs font-semibold uppercase tracking-[0.12em] text-slate-400">Brand <span className="normal-case font-normal tracking-normal text-slate-600">(optional)</span><select className={`${INPUT} mt-2 normal-case tracking-normal`} value={form.brand_id} onChange={event => setForm(current => ({ ...current, brand_id: event.target.value }))}><option value="">No brand selected</option>{workspace.brands.map(brand => <option key={brand.id} value={brand.id}>{brand.name}</option>)}</select></label>
      </div>
      <div className="mt-6 flex justify-end border-t border-slate-800 pt-5"><button disabled={saving || loading} className={PRIMARY}>{saving ? 'Saving…' : 'Create general request'}</button></div>
    </form>

    <section className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-4"><div><p className="text-xs font-semibold uppercase tracking-[0.14em] text-amber-400">Organisation-wide</p><h2 className="mt-1 text-2xl font-semibold">General requests</h2><p className="mt-2 text-sm text-slate-500">A flat list, newest first. Access remains controlled by CP1 organisation RLS.</p></div><button type="button" onClick={load} disabled={loading} className={BUTTON}>{loading ? 'Loading…' : 'Refresh'}</button></div>
      {loading ? <div className="rounded-2xl border border-slate-800 p-12 text-center text-sm text-slate-500">Loading general requests…</div> : workspace.requests.length ? workspace.requests.map(request => { const handoff = workspace.handoffs.find(item => item.content_request_id === request.id); return <article key={request.id} className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5"><div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0"><p className="text-xs font-semibold uppercase tracking-[0.12em] text-amber-400">{request.format.replaceAll('_', ' ')}</p><p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-300">{request.brief}</p></div><span className="rounded-full bg-slate-950 px-2.5 py-1 text-[10px] font-semibold uppercase text-slate-300">{request.status.replaceAll('_', ' ')}</span></div><div className="mt-4 flex flex-wrap gap-2 text-[11px] text-slate-500"><span>{brandNames.get(request.brand_id) || 'No brand'}</span><span>·</span><span>{request.output_path === 'internal_engine' ? 'Anka OS request' : 'Figma handoff'}</span><span>·</span><span>{new Date(request.created_at).toLocaleString()}</span></div>{handoff && <a href={handoff.figma_handoff_url} className="mt-4 inline-block text-sm font-semibold text-amber-300 hover:text-amber-200">Open authenticated Figma reference →</a>}</article> }) : <div className="rounded-2xl border border-dashed border-slate-700 p-12 text-center text-sm text-slate-500">No general content requests yet.</div>}
    </section>
  </div>
}
