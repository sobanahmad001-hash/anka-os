import { useEffect, useMemo, useRef, useState } from 'react'
import { SEEDANCE, videoResolutionOptions } from '../data/designMediaCapabilities.js'
import { canSubmitVideo, videoQuoteDisplay } from '../data/designVideoQuoteTransport.js'
import { designWorkshop } from '../data/designWorkshopRepository.js'
import { integrations } from '../data/integrationRepository.js'
import { useOrganization } from '../context/OrganizationContext.jsx'
import DesignVideoPromotion from './DesignVideoPromotion.jsx'

const JOB_PAGE_SIZE = 50
const UNSETTLED_VIDEO_STATUSES = new Set(['queued', 'claimed', 'provider_pending', 'provider_completed', 'outcome_unknown'])

export default function DesignVideoCapabilities({ directionVersionId }) {
  const { activeOrganizationId, scopeRevision } = useOrganization()
  return <ScopedDesignVideoCapabilities
    key={`${activeOrganizationId}:${scopeRevision}:${directionVersionId}`}
    directionVersionId={directionVersionId} />
}

// eslint-disable-next-line no-unused-vars -- This config does not count JSX component references.
function ScopedDesignVideoCapabilities({ directionVersionId }) {
  const { activeOrganizationId, requestSignal, scopeRevision } = useOrganization()
  const studio = useMemo(() => activeOrganizationId ? designWorkshop.forOrganization(activeOrganizationId, { signal: requestSignal }) : null, [activeOrganizationId, requestSignal])
  const [mode, setMode] = useState('explore')
  const [resolution, setResolution] = useState('720p')
  const [duration, setDuration] = useState(5)
  const [aspectRatio, setAspectRatio] = useState('16:9')
  const [format, setFormat] = useState('mp4')
  const [audio, setAudio] = useState(false)
  const [result, setResult] = useState(null)
  const [connections, setConnections] = useState([])
  const [connectionId, setConnectionId] = useState('')
  const [connectionError, setConnectionError] = useState('')
  const [prompt, setPrompt] = useState('')
  const [spendConfirmed, setSpendConfirmed] = useState(false)
  const [submitBusy, setSubmitBusy] = useState(false)
  const [submitNotice, setSubmitNotice] = useState('')
  const [jobs, setJobs] = useState([])
  const [jobsLoaded, setJobsLoaded] = useState(false)
  const [hasOlderJobs, setHasOlderJobs] = useState(false)
  const [jobsError, setJobsError] = useState('')
  const [jobsBusy, setJobsBusy] = useState('')
  const [preview, setPreview] = useState(null)
  const [clock, setClock] = useState(Date.now())
  const sequence = useRef(0)
  const jobsSequence = useRef(0)
  const submitInFlight = useRef(false)
  const submission = useRef({ signature: '', operationKey: '' })
  useEffect(() => () => { sequence.current++ }, [])
  useEffect(() => {
    let active = true
    setConnections([]); setConnectionId(''); setConnectionError('')
    setPrompt(''); setResult(null); setSubmitNotice(''); setSubmitBusy(false)
    setSpendConfirmed(false); submission.current = { signature: '', operationKey: '' }
    if (!activeOrganizationId || requestSignal?.aborted) return
    integrations.listForOrganization(activeOrganizationId, null, { signal: requestSignal })
      .then(data => {
        if (!active || requestSignal?.aborted || data?.organization_id !== activeOrganizationId) return
        const eligible = (data.connections || []).filter(connection => connection.provider === 'higgsfield'
          && connection.status === 'verified' && connection.secret_configured === true
          && connection.organization_level === true
          && Array.isArray(connection.department_ids) && connection.department_ids.length === 0
          && /^ANKA_HIGGSFIELD_[A-Z0-9_]+$/.test(connection.secret_name || ''))
        setConnections(eligible)
        setConnectionId(current => eligible.some(connection => connection.id === current) ? current : '')
      })
      .catch(() => { if (active && !requestSignal?.aborted) setConnectionError('Video connection readiness is unavailable.') })
    return () => { active = false }
  }, [activeOrganizationId, scopeRevision, requestSignal])
  useEffect(() => {
    const attempt = ++jobsSequence.current
    let active = true
    setJobs([]); setJobsLoaded(false); setHasOlderJobs(false); setJobsError(''); setJobsBusy(''); setPreview(null)
    if (!studio || !directionVersionId || requestSignal?.aborted) return
    studio.listVideoJobs(directionVersionId).then(rows => {
      if (active && jobsSequence.current === attempt && !requestSignal?.aborted) {
        setJobs(Array.isArray(rows) ? rows.slice(0, JOB_PAGE_SIZE) : [])
        setHasOlderJobs(Array.isArray(rows) && rows.length > JOB_PAGE_SIZE)
        setJobsLoaded(true)
      }
    }).catch(() => {
      if (active && jobsSequence.current === attempt && !requestSignal?.aborted) setJobsError('Private video history is unavailable.')
    })
    return () => { active = false }
  }, [studio, directionVersionId, scopeRevision, requestSignal])
  const input = { direction_version_id: directionVersionId, duration_seconds: duration, resolution, aspect_ratio: aspectRatio, output_format: format, generate_audio: audio }
  const key = JSON.stringify([activeOrganizationId, scopeRevision, mode, input])
  const current = result?.key === key ? result : null
  const options = videoResolutionOptions(mode)
  const supported = options.some(option => option.value === resolution && option.supported)
    && Number.isInteger(duration) && duration >= 4 && duration <= (mode === 'explore' ? 5 : 30)
  const display = current?.data ? videoQuoteDisplay(current.data, input, Math.max(clock, Date.now())) : null
  const paidExecutionEnabled = current?.data?.paid_execution_enabled === true
  const selectedConnection = connections.find(connection => connection.id === connectionId)
  const hasUnsettledJob = jobs.some(job => UNSETTLED_VIDEO_STATUSES.has(job.status))
  const canSubmit = Boolean(studio && directionVersionId && jobsLoaded && !hasUnsettledJob && !submitBusy && !jobsBusy
    && !requestSignal?.aborted && canSubmitVideo({ display, connection: selectedConnection,
      prompt, supported, spendConfirmed }))
  const expires = current?.data?.quote?.valid_until
  useEffect(() => {
    const delay = Date.parse(expires) - Date.now()
    if (!Number.isFinite(delay) || delay <= 0 || delay > 86400000) return
    const timer = setTimeout(() => setClock(Date.now()), delay + 10)
    return () => clearTimeout(timer)
  }, [expires])
  function edit(setter, value) {
    sequence.current++; setResult(null); setSpendConfirmed(false)
    submission.current = { signature: '', operationKey: '' }
    setter(value)
  }
  async function checkQuote() {
    if (!studio || !directionVersionId || !supported || requestSignal?.aborted) return
    const attempt = ++sequence.current
    setResult({ key, pending: true })
    setSpendConfirmed(false)
    try {
      const data = await studio.getVideoQuote(input)
      if (sequence.current === attempt && !requestSignal?.aborted) { setClock(Date.now()); setResult({ key, data }) }
    } catch {
      if (sequence.current === attempt && !requestSignal?.aborted) setResult({ key, error: true })
    }
  }
  async function submitVideo(event) {
    event.preventDefault()
    if (!canSubmit || submitInFlight.current) return
    submitInFlight.current = true
    const exactPrompt = prompt.trim()
    const signature = JSON.stringify([activeOrganizationId, directionVersionId, mode,
      input, connectionId, display.quoteId, exactPrompt])
    const operationKey = submission.current.signature === signature
      ? submission.current.operationKey : crypto.randomUUID()
    submission.current = { signature, operationKey }
    const attempt = jobsSequence.current
    setSubmitBusy(true); setSubmitNotice('')
    try {
      const job = await studio.generateVideo({ ...input, mode, prompt: exactPrompt,
        connector_connection_id: connectionId, quote_id: display.quoteId,
        operation_key: operationKey })
      if (requestSignal?.aborted || jobsSequence.current !== attempt) return
      const rows = await studio.listVideoJobs(directionVersionId)
      if (requestSignal?.aborted || jobsSequence.current !== attempt) return
      setJobs(Array.isArray(rows) ? rows.slice(0, JOB_PAGE_SIZE) : [])
      setHasOlderJobs(Array.isArray(rows) && rows.length > JOB_PAGE_SIZE)
      setJobsLoaded(true)
      setSubmitNotice(`Original video request recorded (${job.status.replaceAll('_', ' ')}). Check its private history for updates.`)
      setPrompt(''); setSpendConfirmed(false)
      submission.current = { signature: '', operationKey: '' }
    } catch {
      if (requestSignal?.aborted || jobsSequence.current !== attempt) return
      setSpendConfirmed(false)
      setSubmitNotice('Submission outcome could not be confirmed. Check the original job in private history. New requests for this direction remain blocked while it is unresolved.')
      try {
        const rows = await studio.listVideoJobs(directionVersionId)
        if (!requestSignal?.aborted && jobsSequence.current === attempt) {
          setJobs(Array.isArray(rows) ? rows.slice(0, JOB_PAGE_SIZE) : [])
          setHasOlderJobs(Array.isArray(rows) && rows.length > JOB_PAGE_SIZE)
          setJobsLoaded(true)
        }
      } catch {
        if (!requestSignal?.aborted && jobsSequence.current === attempt) {
          setJobsLoaded(false)
          setJobsError('Private video history is unavailable. New requests are blocked until it can be checked.')
        }
      }
    } finally {
      submitInFlight.current = false
      if (!requestSignal?.aborted && jobsSequence.current === attempt) setSubmitBusy(false)
    }
  }
  async function actOnJob(job, action) {
    if (!studio || jobsBusy || requestSignal?.aborted) return
    const attempt = jobsSequence.current
    const currentScope = () => jobsSequence.current === attempt && !requestSignal?.aborted
    setJobsBusy(job.id); setJobsError('')
    try {
      if (action === 'preview') {
        const signed = await studio.signVideoOutput(job.id)
        if (currentScope()) setPreview({ jobId: job.id, url: signed.signed_url, expiresAt: Date.now() + 60000 })
      } else {
        if (action === 'poll') await studio.pollVideoJob(job.id)
        else if (action === 'ingest') await studio.ingestVideoOutput(job.id)
        const rows = await studio.listVideoJobs(directionVersionId)
        if (currentScope()) {
          setJobs(Array.isArray(rows) ? rows.slice(0, JOB_PAGE_SIZE) : [])
          setHasOlderJobs(Array.isArray(rows) && rows.length > JOB_PAGE_SIZE)
        }
      }
    } catch {
      if (currentScope()) setJobsError('This video job could not be updated. Its original request remains recorded.')
    } finally { if (currentScope()) setJobsBusy('') }
  }
  async function loadOlderJobs() {
    if (!studio || jobsBusy || !hasOlderJobs || !jobs.length || requestSignal?.aborted) return
    const attempt = jobsSequence.current
    const cursor = jobs[jobs.length - 1]
    setJobsBusy('history'); setJobsError('')
    try {
      const rows = await studio.listVideoJobs(directionVersionId, cursor)
      if (jobsSequence.current !== attempt || requestSignal?.aborted) return
      const page = Array.isArray(rows) ? rows.slice(0, JOB_PAGE_SIZE) : []
      setJobs(current => [...current, ...page.filter(row => !current.some(item => item.id === row.id))])
      setHasOlderJobs(Array.isArray(rows) && rows.length > JOB_PAGE_SIZE)
    } catch {
      if (jobsSequence.current === attempt && !requestSignal?.aborted) setJobsError('Older private video history is unavailable.')
    } finally { if (jobsSequence.current === attempt && !requestSignal?.aborted) setJobsBusy('') }
  }
  useEffect(() => {
    if (!preview) return
    const timer = setTimeout(() => setPreview(current => current?.jobId === preview.jobId ? null : current),
      Math.max(0, preview.expiresAt - Date.now()))
    return () => clearTimeout(timer)
  }, [preview])
  return <details className="mt-3 rounded-xl border border-white/10 p-3 text-xs text-slate-400">
    <summary className="cursor-pointer font-semibold text-slate-200">Video capabilities · {display?.paidExecutionEnabled && !display.capMissing && selectedConnection ? 'exact quote required' : 'generation unavailable'}</summary>
    <p className="mt-2">Higgsfield Seedance 2.5 supports 480p and 720p. Google media is not configured. Maximum USD $2 per generated video; this limit does not authorize spending.</p>
    <div className="mt-3 flex flex-wrap gap-3">
      <label>Mode <select className="rounded bg-slate-900 p-2" value={mode} onChange={event => { edit(setMode, event.target.value); setResolution('') }}>
        <option value="explore">Explore</option><option value="production">Production</option>
      </select></label>
      <label>Resolution <select className="rounded bg-slate-900 p-2" value={resolution} onChange={event => edit(setResolution, event.target.value)}>
        <option value="">Choose resolution</option>{options.map(option => <option key={option.value} value={option.value} disabled={!option.supported}>{option.label}</option>)}
      </select></label>
      <label>Seconds <input className="w-20 rounded bg-slate-900 p-2" type="number" min="4" max={mode === 'explore' ? 5 : 30} step="1" value={duration} onChange={event => edit(setDuration, event.target.value === '' ? '' : Number(event.target.value))} /></label>
      <label>Aspect ratio <select className="rounded bg-slate-900 p-2" value={aspectRatio} onChange={event => edit(setAspectRatio, event.target.value)}>{SEEDANCE.aspectRatios.map(value => <option key={value}>{value}</option>)}</select></label>
      <label>Format <select className="rounded bg-slate-900 p-2" value={format} onChange={event => edit(setFormat, event.target.value)}><option>mp4</option><option>mov</option></select></label>
      <label><input type="checkbox" checked={audio} onChange={event => edit(setAudio, event.target.checked)} /> Generate audio</label>
    </div>
    <p className="mt-2">{mode === 'explore' ? 'Explore previews are limited to 4–5 seconds.' : '1080p is recommended for final output but unsupported on this model.'} No automatic downgrade or upscale.</p>
    <button type="button" className="mt-3 rounded border border-white/20 px-3 py-2 disabled:opacity-40" disabled={!studio || !directionVersionId || !supported || current?.pending} onClick={checkQuote}>Check exact quote</button>
    <div className="mt-2" role="status">
      {!supported ? <p>Choose supported settings explicitly.</p> : current?.pending ? <p>Checking quote for these exact settings…</p> : current?.error ? <p>Quote lookup failed. Check again; generation remains unavailable.</p> : display ? <>
        <p>{display.message}</p>
        {display.status === 'quoted' && <p>Quoted maximum USD ${display.maximum} · valid until {new Date(display.validUntil).toLocaleString()}</p>}
        {display.capMissing === true && <p>Organization budget is not configured.</p>}
        {display.capMissing === false && <p>Organization budget configured; this does not confirm remaining funds or reserve spending.</p>}
      </> : <p>No current quote checked for these settings.</p>}
      <p>{paidExecutionEnabled ? 'Paid execution is enabled on the server; a verified connection, budget, exact quote, and explicit confirmation are still required.' : 'Paid execution is disabled. Checking a quote makes no provider request.'}</p>
    </div>
    <form onSubmit={submitVideo} className="mt-3 space-y-3 rounded-lg border border-white/10 p-3">
      <p className="font-semibold text-slate-200">Prepare one exact video request</p>
      <label className="block">Prompt
        <textarea className="mt-1 w-full rounded bg-slate-900 p-2 text-white" rows="4" maxLength={12000}
          value={prompt} disabled={submitBusy} onChange={event => {
            setPrompt(event.target.value); setSpendConfirmed(false)
            submission.current = { signature: '', operationKey: '' }
          }} />
      </label>
      <label className="block">Verified organization video connection
        <select className="mt-1 w-full rounded bg-slate-900 p-2" value={connectionId}
          disabled={submitBusy} onChange={event => {
            setConnectionId(event.target.value); setSpendConfirmed(false)
            submission.current = { signature: '', operationKey: '' }
          }}>
          <option value="">Choose connection</option>
          {connections.map(connection => <option key={connection.id} value={connection.id}>{connection.display_name}</option>)}
        </select>
      </label>
      {connectionError && <p role="alert" className="text-amber-300">{connectionError}</p>}
      {!connections.length && !connectionError && <p>No verified organization-only Higgsfield connection is available.</p>}
      <label className="flex items-start gap-2"><input type="checkbox" checked={spendConfirmed}
        disabled={submitBusy || !display?.paidExecutionEnabled || display?.status !== 'quoted'
          || display?.capMissing !== false || !selectedConnection}
        onChange={event => setSpendConfirmed(event.target.checked)} />
        <span>I approve one request with these exact settings and a maximum charge of USD ${display?.status === 'quoted' ? display.maximum : '—'}. The organization monthly budget also applies.</span>
      </label>
      <button type="submit" className="rounded border border-violet-500 px-3 py-2 text-violet-100 disabled:cursor-not-allowed disabled:opacity-40"
        disabled={!canSubmit}>{submitBusy ? 'Recording original request…' : 'Generate one video'}</button>
      {submitNotice && <p role="status" className="text-amber-200">{submitNotice}</p>}
      {!jobsLoaded && <p className="text-amber-300">Private video history must load before a new request can be submitted.</p>}
      {hasUnsettledJob && <p className="text-amber-300">An earlier video request is unresolved. Check its original job before creating another request for this direction.</p>}
    </form>
    <p className="mt-2">Check the Asset Library and existing templates before generating. Preserve original footage for text, logo, date or caption corrections; video assembly is not available here.</p>
    <div className="mt-3 border-t border-white/10 pt-3">
      <p className="font-semibold text-slate-200">Your private video jobs</p>
      {jobsError && <p role="alert" className="mt-2 text-amber-300">{jobsError}</p>}
      {!jobs.length && !jobsError && <p className="mt-2">No video jobs recorded for this direction.</p>}
      {jobs.map(job => <div key={job.id} className="mt-2 rounded-lg border border-white/10 p-2">
        <p className="font-medium text-slate-200">{job.mode} · {job.duration_seconds}s · {job.resolution} · {job.status.replaceAll('_', ' ')}</p>
        <p className="mt-1">Started {new Date(job.created_at).toLocaleString()}</p>
        {job.status === 'outcome_unknown' && <p className="mt-1 text-amber-300">The provider outcome needs manual reconciliation. This request will not be submitted again.</p>}
        {job.status === 'provider_completed' && <p className="mt-1">The provider completed the original request. Save its checked output to private storage.</p>}
        <div className="mt-2 flex flex-wrap gap-2">
          {job.status === 'provider_pending' && <button type="button" className="rounded border border-white/20 px-2 py-1 disabled:opacity-40" disabled={Boolean(jobsBusy)} onClick={() => actOnJob(job, 'poll')}>Check original request</button>}
          {job.status === 'provider_completed' && <button type="button" className="rounded border border-white/20 px-2 py-1 disabled:opacity-40" disabled={Boolean(jobsBusy)} onClick={() => actOnJob(job, 'ingest')}>Save private output</button>}
          {job.status === 'ready' && <button type="button" className="rounded border border-white/20 px-2 py-1 disabled:opacity-40" disabled={Boolean(jobsBusy)} onClick={() => actOnJob(job, 'preview')}>Open private preview</button>}
        </div>
        {preview?.jobId === job.id && <video className="mt-2 max-h-80 w-full" controls src={preview.url} />}
        {job.status === 'ready' && <DesignVideoPromotion key={job.id} studio={studio} jobId={job.id} />}
      </div>)}
      {hasOlderJobs && <button type="button" className="mt-3 rounded border border-white/20 px-2 py-1 disabled:opacity-40"
        disabled={Boolean(jobsBusy)} onClick={loadOlderJobs}>Load older private jobs</button>}
    </div>
  </details>
}
