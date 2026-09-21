import { useEffect, useMemo, useRef, useState } from 'react'
import { buildContentUpdatePreview, SEO_RESEARCH_TYPES, shouldApplySeoResearchResponse, sourceAvailabilitySummary, validateSeoResearchInput } from '../data/marketingSeoResearch.js'

const INPUT = 'w-full rounded-xl border border-slate-700 bg-slate-950 px-3.5 py-2.5 text-sm text-white outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20'
const BUTTON = 'rounded-xl border border-slate-700 px-4 py-2 text-sm font-semibold text-slate-200 transition hover:border-emerald-500 hover:text-white disabled:cursor-not-allowed disabled:opacity-50'
const PRIMARY = 'rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50'

function Field({ label, hint, children }) {
  return <label className="text-xs font-semibold uppercase tracking-[0.1em] text-slate-400">{label}{children}{hint && <span className="mt-1 block normal-case font-normal tracking-normal text-slate-500">{hint}</span>}</label>
}

export default function MarketingSeoResearch({ organizationId, scopeRevision, signal, engagement, repository, act, onAccessError }) {
  const [form, setForm] = useState({ research_type: '', target_url: '', market: '', seed_keywords: '', content_strategy_version_id: '' })
  const [availability, setAvailability] = useState({ technicalSeoPages: 0, trackedKeywords: 0, contentStrategies: [], activeContentService: false, contentServices: [], contentWorkstreams: [] })
  const [preview, setPreview] = useState(null)
  const [requestPreview, setRequestPreview] = useState(null)
  const [savedVersion, setSavedVersion] = useState(null)
  const [confirmedRequest, setConfirmedRequest] = useState(null)
  const [requestUncertain, setRequestUncertain] = useState(false)
  const [receivingServiceId, setReceivingServiceId] = useState('')
  const [receivingWorkstreamId, setReceivingWorkstreamId] = useState('')
  const [title, setTitle] = useState('SEO research')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const generation = useRef(0)
  const saveKey = useRef(crypto.randomUUID())
  const contentRequestKey = useRef(crypto.randomUUID())
  const scope = useRef({ organizationId, brandId: engagement.brand_id, engagementId: engagement.id, revision: scopeRevision })
  scope.current = { organizationId, brandId: engagement.brand_id, engagementId: engagement.id, revision: scopeRevision }
  const sources = useMemo(() => sourceAvailabilitySummary(availability), [availability])

  useEffect(() => {
    const request = { ...scope.current, signal }
    const currentGeneration = ++generation.current
    setPreview(null); setRequestPreview(null); setSavedVersion(null); setConfirmedRequest(null); setRequestUncertain(false); setReceivingServiceId(''); setReceivingWorkstreamId(''); contentRequestKey.current = crypto.randomUUID(); setError(''); setMessage('')
    repository.loadAvailability(engagement.brand_id, engagement.id, engagement.project_id).then(result => {
      if (shouldApplySeoResearchResponse(request, scope.current, currentGeneration, generation.current)) setAvailability(result)
    }).catch(reason => {
      if (shouldApplySeoResearchResponse(request, scope.current, currentGeneration, generation.current)) {
        onAccessError(reason, { membershipMismatch: reason?.membershipMismatch === true }); setError(reason.message)
      }
    })
    return () => { generation.current += 1 }
  }, [engagement.brand_id, engagement.id, engagement.project_id, onAccessError, organizationId, repository, scopeRevision, signal])

  function change(field, value) {
    if (requestUncertain) { setError('Refresh exact Content request status before changing research.'); return }
    generation.current += 1
    setForm(current => ({ ...current, [field]: value }))
    setPreview(null); setRequestPreview(null); setSavedVersion(null); setConfirmedRequest(null); setRequestUncertain(false); setMessage(''); setBusy(false); saveKey.current = crypto.randomUUID()
  }

  async function run(event) {
    event.preventDefault();
    if (requestUncertain) { setError('Refresh exact Content request status before rerunning research.'); return }
    setBusy(true); setError(''); setMessage(''); setRequestPreview(null)
    const currentGeneration = ++generation.current
    const request = { ...scope.current, signal }
    try {
      const input = validateSeoResearchInput(form)
      const result = await repository.preview({ engagement_id: engagement.id, research: input })
      if (!shouldApplySeoResearchResponse(request, scope.current, currentGeneration, generation.current)) return
      setPreview(result); setSavedVersion(null); setConfirmedRequest(null); setRequestUncertain(false); contentRequestKey.current = crypto.randomUUID()
      setTitle(`${input.research_type === 'page' ? 'Page' : 'Domain'} SEO research · ${new URL(input.target_url).hostname}`)
      saveKey.current = crypto.randomUUID()
    } catch (reason) {
      if (shouldApplySeoResearchResponse(request, scope.current, currentGeneration, generation.current)) {
        onAccessError(reason, { membershipMismatch: reason?.membershipMismatch === true }); setError(reason.message)
      }
    } finally { if (shouldApplySeoResearchResponse(request, scope.current, currentGeneration, generation.current)) setBusy(false) }
  }

  async function save() {
    if (!preview) return
    const result = await act(() => repository.save({
      engagement_id: engagement.id, artifact_id: null, expected_latest_version_id: null,
      title, research: preview, change_summary: 'Saved from the verified source-only SEO Research preview.',
      idempotency_key: saveKey.current,
    }), 'SEO research saved as an immutable unapproved version.')
    if (result) {
      if (savedVersion?.id !== result.id) { setConfirmedRequest(null); contentRequestKey.current = crypto.randomUUID() }
      setSavedVersion(result.id && result.content_checksum ? result : null)
      setMessage(result.replayed ? 'The original saved version was returned; no duplicate was created.' : 'SEO research saved as an immutable unapproved version.')
    }
  }

  function changeRequest(field, value) {
    if (requestUncertain || confirmedRequest) return
    contentRequestKey.current = crypto.randomUUID()
    setRequestPreview(current => ({ ...current, [field]: value }))
  }

  async function confirmRequest() {
    if (!savedVersion?.id || !savedVersion.content_checksum || !requestPreview || !engagement.project_id
      || !receivingServiceId || !receivingWorkstreamId || confirmedRequest || requestPreview.description.length > 7800) return
    const requestId = contentRequestKey.current
    setBusy(true); setError(''); setMessage('')
    const result = await act(() => repository.confirmContentRequest({
      projectId: engagement.project_id, engagementId: engagement.id, requestId,
      researchVersionId: savedVersion.id, researchChecksum: savedVersion.content_checksum,
      receivingServiceId, receivingWorkstreamId, title: requestPreview.title,
      requestedOutput: requestPreview.description,
    }), 'Content request submitted through the canonical project handoff.')
    if (result) { setConfirmedRequest(result); setRequestUncertain(false); setMessage(`Exact Content request ${result.request_id} confirmed.`) }
    else { setRequestUncertain(true); setError('Confirmation result is uncertain. Refresh exact request status or retry with the same request ID and unchanged inputs.') }
    setBusy(false)
  }

  async function refreshRequestStatus() {
    setBusy(true); setError('')
    try {
      const record = await repository.getConfirmedContentRequest(contentRequestKey.current)
      if (record) {
        const exact = record.organization_id === organizationId && record.project_id === engagement.project_id && record.engagement_id === engagement.id
          && record.research_version_id === savedVersion?.id && record.research_checksum === savedVersion?.content_checksum
          && record.receiving_service_id === receivingServiceId && record.receiving_workstream_id === receivingWorkstreamId
          && record.title === requestPreview?.title?.trim() && record.requested_output === requestPreview?.description?.trim()
        if (!exact) throw new Error('Request ID exists with different inputs; exact confirmation cannot be assumed')
        setConfirmedRequest({ request_id: record.request_id, research_version_id: record.research_version_id }); setRequestUncertain(false); setMessage('The exact Content request is confirmed in the project record.')
      }
      else { setRequestUncertain(false); setMessage('No confirmed request exists for this ID. You may retry or edit the draft.') }
    } catch (reason) { onAccessError(reason, { membershipMismatch: reason?.membershipMismatch === true }); setError(reason.message) }
    finally { setBusy(false) }
  }
  function prepareRequest() {
    try { setRequestPreview(buildContentUpdatePreview(preview)); setError('') } catch (reason) { setError(reason.message) }
  }

  return <div className="space-y-6">
    <section className="rounded-2xl border border-slate-800 bg-slate-900/70 p-6">
      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-emerald-400">Source-only research</p>
      <h2 className="mt-1 text-xl font-semibold">SEO Research</h2>
      <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-400">Build a reproducible preview from already stored technical SEO and Search Console rank evidence. This screen never fetches an arbitrary URL, edits a website, activates a provider, or invents missing metrics.</p>
      <div className="mt-5 grid gap-3 md:grid-cols-3">{sources.map(source => <div key={source.key} className={`rounded-xl border p-4 ${source.available ? 'border-emerald-900/60 bg-emerald-950/20' : 'border-amber-900/60 bg-amber-950/20'}`}><p className="text-sm font-semibold text-white">{source.label}</p><p className="mt-1 text-xs text-slate-400">{source.available ? source.detail : `Unavailable · ${source.detail}`}</p></div>)}</div>
    </section>

    {(error || message) && <div role="status" className={`rounded-xl border px-4 py-3 text-sm ${error ? 'border-red-900/60 bg-red-950/40 text-red-300' : 'border-emerald-900/60 bg-emerald-950/40 text-emerald-300'}`}>{error || message}</div>}

    <form onSubmit={run} className="rounded-2xl border border-slate-800 bg-slate-900/70 p-6">
      <div className="grid gap-4 md:grid-cols-2">
        <Field label="Research type"><select required className={`${INPUT} mt-2 normal-case tracking-normal`} value={form.research_type} onChange={event => change('research_type', event.target.value)}><option value="">Choose type</option>{SEO_RESEARCH_TYPES.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}</select></Field>
        <Field label="Market"><input required maxLength="240" className={`${INPUT} mt-2 normal-case tracking-normal`} value={form.market} onInput={event => change('market', event.target.value)} placeholder="Enter the actual research market" /></Field>
        <div className="md:col-span-2"><Field label="Target domain or page URL" hint="Validated again on the server. No remote fetch is performed."><input required type="url" maxLength="2048" className={`${INPUT} mt-2 normal-case tracking-normal`} value={form.target_url} onInput={event => change('target_url', event.target.value)} placeholder="https://example.com/page" /></Field></div>
        <Field label="Language"><span className={`${INPUT} mt-2 block normal-case font-normal tracking-normal text-slate-500`}>Unavailable in current stored sources</span></Field>
        <Field label="Device"><span className={`${INPUT} mt-2 block normal-case font-normal tracking-normal text-slate-500`}>Unavailable in current stored sources</span></Field>
        <div className="md:col-span-2"><Field label="Seed keywords" hint="Optional · one per line"><textarea maxLength="10000" className={`${INPUT} mt-2 min-h-24 normal-case tracking-normal`} value={form.seed_keywords} onInput={event => change('seed_keywords', event.target.value)} /></Field></div>
        <div className="md:col-span-2"><Field label="Canonical Content strategy version"><select className={`${INPUT} mt-2 normal-case tracking-normal`} value={form.content_strategy_version_id} onChange={event => change('content_strategy_version_id', event.target.value)}><option value="">No strategy version selected</option>{availability.contentStrategies.map(item => <option key={item.id} value={item.id}>{item.title} · version {item.versionNumber}</option>)}</select></Field></div>
      </div>
      <div className="mt-6 flex justify-end border-t border-slate-800 pt-5"><button disabled={busy} className={PRIMARY}>{busy ? 'Building preview…' : 'Run research'}</button></div>
    </form>

    {preview && <><section className="rounded-2xl border border-slate-800 bg-slate-900/70 p-6">
      <div className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-xs font-semibold uppercase tracking-[0.14em] text-sky-400">Preview only</p><h3 className="mt-1 text-xl font-semibold">Evidence-backed findings</h3></div><p className="text-xs text-slate-500">Captured {new Date(preview.captured_at).toLocaleString()}</p></div>
      <div className="mt-5 grid gap-5 lg:grid-cols-2"><FindingColumn title="Source facts" empty="No matching stored facts were found. Missing data is not shown as zero." items={preview.source_facts} fact /><FindingColumn title="Marketing interpretation" empty="No interpretation is available without matching source facts." items={preview.interpretations} /></div>
      {preview.limitations.length > 0 && <div className="mt-5 rounded-xl border border-slate-800 bg-slate-950/60 p-4"><p className="text-xs font-semibold uppercase text-slate-400">Limitations</p><ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-slate-400">{preview.limitations.map(item => <li key={item}>{item}</li>)}</ul></div>}
      <div className="mt-6 grid gap-3 border-t border-slate-800 pt-5 md:grid-cols-[1fr_auto_auto]"><input aria-label="Research title" maxLength="240" className={INPUT} value={title} onChange={event => setTitle(event.target.value)} /><button type="button" onClick={prepareRequest} disabled={requestUncertain || Boolean(confirmedRequest)} className={BUTTON}>Preview Request Content</button><button type="button" onClick={save} disabled={requestUncertain} className={PRIMARY}>Save research</button></div>
    </section>
    {requestPreview && <section className="rounded-2xl border border-amber-900/50 bg-amber-950/15 p-6">
      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-amber-300">Canonical N3 Content request</p>
      <h3 className="mt-1 text-xl font-semibold">Review before confirmation</h3>
      <p className="mt-2 text-xs text-slate-400">The request is internal and links to an exact saved SEO research version. It does not activate a service or alter approved Content work.</p>
      {savedVersion?.id ? <p className="mt-3 break-all text-xs text-emerald-300">Saved source version {savedVersion.id} · SHA-256 {savedVersion.content_checksum}</p> : <p className="mt-3 text-xs text-amber-200">Save this research preview before confirming a Content request.</p>}
      <div className="mt-5 grid gap-4">
        <Field label="Title"><input maxLength="240" disabled={requestUncertain || Boolean(confirmedRequest)} className={`${INPUT} mt-2 normal-case tracking-normal`} value={requestPreview.title} onChange={event => changeRequest('title', event.target.value)} /></Field>
        <Field label="Description"><textarea maxLength="7800" disabled={requestUncertain || Boolean(confirmedRequest)} className={`${INPUT} mt-2 min-h-64 normal-case tracking-normal`} value={requestPreview.description} onChange={event => changeRequest('description', event.target.value)} /></Field>
        <Field label="Receiving Content service"><select className={`${INPUT} mt-2 normal-case tracking-normal`} disabled={requestUncertain || Boolean(confirmedRequest)} value={receivingServiceId} onChange={event => { contentRequestKey.current = crypto.randomUUID(); setReceivingServiceId(event.target.value) }}><option value="">Choose active service</option>{(availability.contentServices || []).map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></Field>
        <Field label="Receiving project workstream"><select className={`${INPUT} mt-2 normal-case tracking-normal`} disabled={requestUncertain || Boolean(confirmedRequest)} value={receivingWorkstreamId} onChange={event => { contentRequestKey.current = crypto.randomUUID(); setReceivingWorkstreamId(event.target.value) }}><option value="">Choose active Content workstream</option>{(availability.contentWorkstreams || []).map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></Field>
      </div>
      {requestPreview.description.length > 7800 && <p className="mt-4 text-xs text-red-300">Edit the request description to 7,800 characters or fewer before confirmation.</p>}
      {!(availability.contentServices || []).length || !(availability.contentWorkstreams || []).length ? <p className="mt-4 text-xs text-amber-200">Confirmation needs an active Content service and Content workstream in this exact project.</p> : null}
      {requestUncertain && <p role="status" className="mt-4 text-xs text-amber-200">The request may already exist. Inputs are locked until exact status is checked; retry keeps the same request ID.</p>}
      {confirmedRequest && <p role="status" className="mt-4 text-xs text-emerald-300">Confirmed project handoff {confirmedRequest.request_id}. Content work remains under its own review and delivery gates.</p>}
      <div className="mt-5 flex flex-wrap justify-end gap-3 border-t border-amber-900/30 pt-5">
        {requestUncertain && <button type="button" disabled={busy} onClick={refreshRequestStatus} className={BUTTON}>Refresh exact request status</button>}
        <button type="button" disabled={busy || !savedVersion?.id || !engagement.project_id || !receivingServiceId || !receivingWorkstreamId || requestPreview.description.length > 7800 || Boolean(confirmedRequest)} onClick={confirmRequest} className={PRIMARY}>{busy ? 'Checking…' : 'Confirm internal Content request'}</button>
      </div>
    </section>}</>}
  </div>
}

function FindingColumn({ title, empty, items, fact = false }) {
  return <div><h4 className="text-sm font-semibold text-white">{title}</h4><div className="mt-3 space-y-3">{items.length ? items.map((item, index) => <article key={`${item.source_record_id || item.category}:${index}`} className={`rounded-xl border p-4 ${fact ? 'border-slate-800 bg-slate-950/70' : 'border-amber-900/50 bg-amber-950/20'}`}><p className={`text-xs font-semibold uppercase ${fact ? 'text-sky-300' : 'text-amber-300'}`}>{fact ? `${item.category} · ${item.source}` : `Interpretation · ${item.category}`}</p><p className="mt-2 text-sm leading-6 text-slate-300">{fact ? item.observation : item.proposed_action}</p><p className="mt-2 break-all text-xs leading-5 text-slate-500">{fact ? `${item.affected_url || 'No page URL'} · ${item.evidence_date || 'Evidence date unavailable'}` : `Limitation: ${item.limitations}`}</p></article>) : <p className="rounded-xl border border-dashed border-slate-700 p-4 text-sm text-slate-500">{empty}</p>}</div></div>
}
