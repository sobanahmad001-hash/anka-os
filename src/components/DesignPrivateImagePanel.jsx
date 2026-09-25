import { useEffect, useRef, useState } from 'react'

const INPUT = 'w-full rounded-xl border border-white/10 bg-slate-950/70 px-3 py-2.5 text-sm text-slate-100 outline-none focus:border-violet-500/60'
const BUTTON = 'rounded-xl bg-violet-500 px-4 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40'
const SIZES = [['1024x1024', 'Square · 1024×1024'], ['1024x1536', 'Portrait · 1024×1536'], ['1536x1024', 'Landscape · 1536×1024']]

export default function DesignPrivateImagePanel(props) {
  const brief = props.brief
  return <ScopedDesignPrivateImagePanel key={`${brief?.organization_id || ''}:${brief?.id || ''}:${brief?.frozen_version_id || ''}`} {...props} />
}

function ScopedDesignPrivateImagePanel({ brief, records, engagements, studio, canGenerate, onReload }) {
  const [prompt, setPrompt] = useState('')
  const [modelId, setModelId] = useState('')
  const [connectionId, setConnectionId] = useState('')
  const [providerSize, setProviderSize] = useState('')
  const [preview, setPreview] = useState(null)
  const [pending, setPending] = useState(null)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [signedUrls, setSignedUrls] = useState({})
  const [promotionJobId, setPromotionJobId] = useState('')
  const [targetEngagementId, setTargetEngagementId] = useState('')
  const [targetServiceId, setTargetServiceId] = useState('')
  const [promotionPreview, setPromotionPreview] = useState(null)
  const [promotionKey, setPromotionKey] = useState('')
  const promotionSequence = useRef(0)
  const promotionInFlight = useRef(false)
  const promotionIdentity = useRef('')
  useEffect(() => () => { promotionSequence.current++ }, [])
  const versionId = brief?.frozen_version_id || ''
  const version = (records.versions || []).find(item => item.id === versionId)
  const models = (records.models || []).filter(item => item.provider === 'openai' && item.supported_output_types?.includes('image'))
  const connections = records.connections || []
  const jobs = (records.jobs || []).filter(item => item.creative_brief_version_id === versionId)
  const unresolved = jobs.some(item => ['queued', 'running', 'outcome_unknown'].includes(item.status))
  const readyJobs = jobs.filter(item => item.status === 'succeeded')
  const targetEngagement = engagements.find(item => item.id === targetEngagementId)
  const targetServices = (targetEngagement?.engagement_services || []).filter(item => item.status === 'active'
    && (Array.isArray(item.service_catalog) ? item.service_catalog[0] : item.service_catalog)?.department_id === 'design')
  const ready = Boolean(canGenerate && version && prompt.trim() && modelId && connectionId && providerSize && !unresolved)
  function edit(setter, value) { setter(value); setPreview(null); setError('') }
  function previewRequest() {
    if (!ready || pending) return
    setPreview({ creative_brief_version_id: versionId, prompt: prompt.trim(),
      model_registry_id: modelId, connection_id: connectionId, provider_size: providerSize })
  }
  async function generate() {
    if ((!preview && !pending) || busy || unresolved) return
    const request = pending || { ...preview, operation_key: crypto.randomUUID() }
    setPending(request); setBusy('generate'); setError('')
    try {
      const job = await studio.generatePrivateImage(request)
      await onReload()
      if (job?.status === 'outcome_unknown') setError('The provider outcome is unknown. Check the same request; do not start another paid run.')
      setPending(null); setPreview(null)
    } catch (reason) { setError(reason.message || 'Request interrupted. Reconcile its identity before another attempt.') }
    finally { setBusy('') }
  }
  async function reconcile() {
    if (!pending || busy) return
    setBusy('reconcile'); setError('')
    try {
      const job = await studio.reconcilePrivateImageRequest(pending.operation_key)
      await onReload()
      if (job.status === 'not_submitted' || ['succeeded', 'failed', 'outcome_unknown'].includes(job.status)) {
        setPending(null); setPreview(null)
      }
      if (job.status === 'outcome_unknown') setError('The provider outcome is unknown. No new paid request is available.')
      else if (job.status === 'queued' || job.status === 'running') setError('The original request is still active. Check it again later.')
    } catch (reason) { setError(reason.message || 'Request status is unavailable; do not start another paid run.') }
    finally { setBusy('') }
  }
  async function checkJob(id) {
    setBusy(id); setError('')
    try { await studio.getPrivateImageJob(id); await onReload() }
    catch (reason) { setError(reason.message || 'Job status is unavailable') }
    finally { setBusy('') }
  }
  async function openImage(id) {
    setBusy(id); setError('')
    try { const result = await studio.signPrivateImageJob(id); setSignedUrls(current => ({ ...current, [id]: result.signed_url })) }
    catch (reason) { setError(reason.message || 'Private image is unavailable') }
    finally { setBusy('') }
  }
  function invalidatePromotion() {
    if (promotionInFlight.current || promotionIdentity.current) return false
    promotionSequence.current++; setPromotionPreview(null); setPromotionKey(''); setError('')
    if (busy === 'preview-promotion') setBusy('')
    return true
  }
  function choosePromotionJob(id) { if (invalidatePromotion()) setPromotionJobId(id) }
  function chooseTarget(id) { if (invalidatePromotion()) { setTargetEngagementId(id); setTargetServiceId('') } }
  function chooseService(id) { if (invalidatePromotion()) setTargetServiceId(id) }
  async function previewPromotion() {
    if (!promotionJobId || !targetEngagementId || !targetServiceId || busy || promotionKey) return
    const attempt = ++promotionSequence.current
    setBusy('preview-promotion'); setError('')
    try {
      const preview = await studio.previewPrivatePromotion({ job_id: promotionJobId,
        target_engagement_id: targetEngagementId, target_service_id: targetServiceId })
      if (promotionSequence.current === attempt) setPromotionPreview(preview)
    }
    catch (reason) { if (promotionSequence.current === attempt) setError(reason.message || 'Promotion preview failed') }
    finally { if (promotionSequence.current === attempt) setBusy('') }
  }
  async function confirmPromotion() {
    if (!promotionPreview || busy || promotionInFlight.current) return
    promotionInFlight.current = true
    const attempt = promotionSequence.current
    const key = promotionIdentity.current || crypto.randomUUID()
    promotionIdentity.current = key
    setPromotionKey(key); setBusy('promote'); setError('')
    try {
      await studio.promotePrivateImage({ job_id: promotionJobId,
        target_engagement_id: targetEngagementId, target_service_id: targetServiceId,
        expected_preview_checksum: promotionPreview.checksum, operation_key: key })
      await onReload()
      if (promotionSequence.current === attempt) {
        promotionIdentity.current = ''; setPromotionKey(''); setPromotionPreview(null)
      }
    } catch (reason) { if (promotionSequence.current === attempt) setError(reason.message || 'Promotion status is uncertain. Retry the same exact confirmation.') }
    finally { promotionInFlight.current = false; if (promotionSequence.current === attempt) setBusy('') }
  }
  return <section className="mt-5 rounded-2xl border border-amber-400/20 bg-slate-900/70 p-5" aria-label="Private image generation">
    <h2 className="text-xl font-semibold">Private image exploration</h2>
    <p className="mt-2 text-sm text-slate-400">One image per explicit request. Outputs stay owner-private; generation does not create official work or approval.</p>
    {!version ? <p className="mt-4 text-sm text-amber-300">Save and freeze a complete private brief version before generating.</p> : <>
      <p className="mt-4 text-xs text-slate-500">Frozen brief v{version.version_number} · {version.id.slice(0, 8)}</p>
      <label className="mt-4 block text-xs font-semibold uppercase text-slate-400">Image prompt<textarea rows="4" className={`${INPUT} mt-2`} value={prompt} disabled={Boolean(pending)} onChange={event => edit(setPrompt, event.target.value)} /></label>
      <div className="mt-3 grid gap-3 sm:grid-cols-3"><label className="text-xs font-semibold uppercase text-slate-400">Image model<select className={`${INPUT} mt-2`} value={modelId} disabled={Boolean(pending)} onChange={event => edit(setModelId, event.target.value)}><option value="">Choose model</option>{models.map(item => <option key={item.id} value={item.id}>{item.display_name}</option>)}</select></label><label className="text-xs font-semibold uppercase text-slate-400">Verified Design connection<select className={`${INPUT} mt-2`} value={connectionId} disabled={Boolean(pending)} onChange={event => edit(setConnectionId, event.target.value)}><option value="">Choose connection</option>{connections.map(item => <option key={item.id} value={item.id}>{item.display_name}</option>)}</select></label><label className="text-xs font-semibold uppercase text-slate-400">Image size<select className={`${INPUT} mt-2`} value={providerSize} disabled={Boolean(pending)} onChange={event => edit(setProviderSize, event.target.value)}><option value="">Choose size</option>{SIZES.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label></div>
      {(!models.length || !connections.length) && <p className="mt-3 text-xs text-amber-300">Generation requires an enabled image model and a verified organization-level OpenAI connection assigned to Design.</p>}
      <button type="button" className={`${BUTTON} mt-4`} disabled={!ready || Boolean(pending) || Boolean(busy)} onClick={previewRequest}>Preview private request</button>
      {preview && !pending && <div className="mt-4 rounded-xl border border-violet-400/20 p-3 text-sm"><p className="font-semibold">Confirm one private image request</p><p className="mt-2 text-xs text-slate-400">Brief {version.id.slice(0, 8)} · {models.find(item => item.id === preview.model_registry_id)?.display_name} · {connections.find(item => item.id === preview.connection_id)?.display_name} · {preview.provider_size} · 1 output · private storage. Usage and cost estimate unavailable.</p><p className="mt-2 whitespace-pre-wrap text-xs text-slate-300">{preview.prompt}</p><button type="button" className={`${BUTTON} mt-3`} disabled={Boolean(busy)} onClick={generate}>Generate one private image</button></div>}
      {pending && <div className="mt-4 rounded-xl border border-amber-400/20 p-3 text-sm"><p>Request response interrupted. The exact prompt, model, connection, and size are held under request {pending.operation_key.slice(0, 8)}.</p><button type="button" className={`${BUTTON} mt-3`} disabled={Boolean(busy)} onClick={reconcile}>Check original request</button></div>}
    </>}
    {error && <p role="alert" className="mt-4 text-sm text-red-300">{error}</p>}
    <div className="mt-5 space-y-3">{jobs.map(job => <article key={job.id} className="rounded-xl border border-white/10 p-3 text-xs"><p className="font-semibold">Request {job.id.slice(0, 8)} · {job.status.replaceAll('_', ' ')}</p><p className="mt-1 text-slate-500">{new Date(job.created_at).toLocaleString()} · {job.provider_size}</p>{job.failure_reason && <p className="mt-2 text-red-300">{job.failure_reason}</p>}<div className="mt-2 flex gap-2"><button type="button" disabled={Boolean(busy)} onClick={() => checkJob(job.id)} className="underline">Check status</button>{job.status === 'succeeded' && <button type="button" disabled={Boolean(busy)} onClick={() => openImage(job.id)} className="underline">Open private image</button>}</div>{signedUrls[job.id] && <img className="mt-3 max-h-72 rounded-lg" src={signedUrls[job.id]} alt="Owner-private generated output" />}</article>)}</div>
    {!!readyJobs.length && <div className="mt-6 rounded-xl border border-violet-400/20 p-4"><h3 className="font-semibold">Promote one private image</h3><p className="mt-2 text-xs text-slate-400">Choose an existing authorized Design engagement and active service. Preview names the exact source and destination. Confirmation creates one unapproved draft asset; the private original remains unchanged.</p><div className="mt-3 grid gap-3 sm:grid-cols-3"><label className="text-xs font-semibold uppercase text-slate-400">Private output<select className={`${INPUT} mt-2`} value={promotionJobId} disabled={Boolean(promotionKey)} onChange={event => choosePromotionJob(event.target.value)}><option value="">Choose output</option>{readyJobs.map(item => <option key={item.id} value={item.id}>Request {item.id.slice(0, 8)}</option>)}</select></label><label className="text-xs font-semibold uppercase text-slate-400">Authorized engagement<select className={`${INPUT} mt-2`} value={targetEngagementId} disabled={Boolean(promotionKey)} onChange={event => chooseTarget(event.target.value)}><option value="">Choose engagement</option>{engagements.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label className="text-xs font-semibold uppercase text-slate-400">Active Design service<select className={`${INPUT} mt-2`} value={targetServiceId} disabled={Boolean(promotionKey)} onChange={event => chooseService(event.target.value)}><option value="">Choose service</option>{targetServices.map(item => <option key={item.id} value={item.id}>{(Array.isArray(item.service_catalog) ? item.service_catalog[0] : item.service_catalog)?.name || item.id}</option>)}</select></label></div><button type="button" className={`${BUTTON} mt-3`} disabled={!promotionJobId || !targetEngagementId || !targetServiceId || Boolean(busy) || Boolean(promotionKey)} onClick={previewPromotion}>Preview exact promotion</button>{promotionPreview && <div className="mt-3 rounded-lg bg-slate-950/60 p-3 text-xs"><p>Private request {promotionPreview.job.id.slice(0, 8)} → {promotionPreview.engagement.name} · draft asset “{promotionPreview.name}”. No task completion, approval, release, or publication.</p><button type="button" className={`${BUTTON} mt-3`} disabled={Boolean(busy)} onClick={confirmPromotion}>{promotionKey ? 'Retry exact confirmation' : 'Confirm unapproved draft asset'}</button></div>}{(records.promotions || []).filter(item => item.source_job_id === promotionJobId).map(item => <p key={item.id} className="mt-3 text-xs text-emerald-300">Promoted to draft asset version {item.asset_version_id.slice(0, 8)} · {new Date(item.created_at).toLocaleString()}</p>)}</div>}
    <p className="mt-4 text-xs text-slate-500">Provider cancellation is unavailable after submission. Unknown outcomes block another paid request until reconciled.</p>
  </section>
}
