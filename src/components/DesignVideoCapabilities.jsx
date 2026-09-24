import { useEffect, useMemo, useRef, useState } from 'react'
import { SEEDANCE, videoResolutionOptions } from '../data/designMediaCapabilities.js'
import { videoQuoteDisplay } from '../data/designVideoQuoteTransport.js'
import { designWorkshop } from '../data/designWorkshopRepository.js'
import { useOrganization } from '../context/OrganizationContext.jsx'

export default function DesignVideoCapabilities({ directionVersionId }) {
  const { activeOrganizationId, requestSignal, scopeRevision } = useOrganization()
  const studio = useMemo(() => activeOrganizationId ? designWorkshop.forOrganization(activeOrganizationId, { signal: requestSignal }) : null, [activeOrganizationId, requestSignal])
  const [mode, setMode] = useState('explore')
  const [resolution, setResolution] = useState('720p')
  const [duration, setDuration] = useState(5)
  const [aspectRatio, setAspectRatio] = useState('16:9')
  const [format, setFormat] = useState('mp4')
  const [audio, setAudio] = useState(false)
  const [result, setResult] = useState(null)
  const [clock, setClock] = useState(Date.now())
  const sequence = useRef(0)
  useEffect(() => () => { sequence.current++ }, [])
  const input = { direction_version_id: directionVersionId, duration_seconds: duration, resolution, aspect_ratio: aspectRatio, output_format: format, generate_audio: audio }
  const key = JSON.stringify([activeOrganizationId, scopeRevision, mode, input])
  const current = result?.key === key ? result : null
  const options = videoResolutionOptions(mode)
  const supported = options.some(option => option.value === resolution && option.supported)
    && Number.isInteger(duration) && duration >= 4 && duration <= (mode === 'explore' ? 5 : 30)
  const display = current?.data ? videoQuoteDisplay(current.data, input, Math.max(clock, Date.now())) : null
  const expires = current?.data?.quote?.valid_until
  useEffect(() => {
    const delay = Date.parse(expires) - Date.now()
    if (!Number.isFinite(delay) || delay <= 0 || delay > 86400000) return
    const timer = setTimeout(() => setClock(Date.now()), delay + 10)
    return () => clearTimeout(timer)
  }, [expires])
  function edit(setter, value) { sequence.current++; setResult(null); setter(value) }
  async function checkQuote() {
    if (!studio || !directionVersionId || !supported || requestSignal?.aborted) return
    const attempt = ++sequence.current
    setResult({ key, pending: true })
    try {
      const data = await studio.getVideoQuote(input)
      if (sequence.current === attempt && !requestSignal?.aborted) { setClock(Date.now()); setResult({ key, data }) }
    } catch {
      if (sequence.current === attempt && !requestSignal?.aborted) setResult({ key, error: true })
    }
  }
  return <details className="mt-3 rounded-xl border border-white/10 p-3 text-xs text-slate-400">
    <summary className="cursor-pointer font-semibold text-slate-200">Video capabilities · generation unavailable</summary>
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
      <p>Paid execution is disabled. Checking a quote makes no provider request.</p>
    </div>
    <p className="mt-2">Check the Asset Library and existing templates before generating. Preserve original footage for text, logo, date or caption corrections; video assembly is not available here.</p>
  </details>
}
