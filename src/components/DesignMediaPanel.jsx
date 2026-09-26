import { useEffect, useState, useRef } from 'react'
import DesignVideoCapabilities from './DesignVideoCapabilities.jsx'

const INPUT = 'w-full rounded-xl border border-white/10 bg-slate-950/70 px-3 py-2.5 text-sm text-slate-100 outline-none focus:border-violet-500/60'
const BUTTON = 'rounded-xl bg-violet-500 px-4 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40'

export default function DesignMediaPanel({ version, models, assets, jobs, onGenerateImage, onRefreshImageJob, onRetryImageJob,
  allowVideo = true, busy, onNavigationBusyChange }) {
  const imageModels = models.filter(model => model.supported_output_types?.includes('image'))
  const versionAssets = assets.filter(asset => asset.design_direction_version_id === version.id)
  const versionJobs = (jobs || []).filter(job => job.direction_version_id === version.id)
  const activeJob = versionJobs.find(job => ['queued', 'running', 'outcome_unknown'].includes(job.status))
  const retryChildren = new Set(versionJobs.map(job => job.retry_of_job_id).filter(Boolean))
  const [prompt, setPrompt] = useState([version.content?.imagery_direction, version.content?.creative_thesis].filter(Boolean).join('\n\n'))
  const [modelId, setModelId] = useState(imageModels[0]?.id || '')
  const [pendingOperationKey, setPendingOperationKey] = useState('')
  const submissionInFlight = useRef(false)
  const exactRequest = useRef(null)
  useEffect(() => { onNavigationBusyChange?.(Boolean(pendingOperationKey || busy)) }, [pendingOperationKey, busy, onNavigationBusyChange])

  async function submitImage(request = null) {
    if (submissionInFlight.current) return
    submissionInFlight.current = true
    const requestKey = request?.operation_key || pendingOperationKey || crypto.randomUUID()
    exactRequest.current ||= { modelId: request?.model_registry_id || modelId, prompt: request?.prompt || prompt, key: requestKey }
    setPendingOperationKey(requestKey)
    try {
      const completed = await onGenerateImage(
        exactRequest.current.modelId,
        exactRequest.current.prompt,
        exactRequest.current.key,
      )
      if (completed) { setPendingOperationKey(''); exactRequest.current = null }
    } finally {
      submissionInFlight.current = false
    }
  }

  return <section className="mt-4 rounded-2xl border border-violet-400/15 bg-slate-950/50 p-3">
    <div className="flex items-center justify-between gap-3"><div><p className="text-xs font-semibold uppercase tracking-wider text-violet-300">Generated media</p><p className="mt-1 text-[11px] text-slate-500">Attached only to immutable version {version.id.slice(0, 8)}</p></div><Badge tone="violet">{versionAssets.length} outputs</Badge></div>
    <textarea aria-label="Image prompt" disabled={Boolean(pendingOperationKey)} rows="3" className={`${INPUT} mt-3`} value={prompt} onChange={event => setPrompt(event.target.value)} placeholder="Static image generation prompt" />
    {imageModels.length ? <select aria-label="Image model" disabled={Boolean(pendingOperationKey)} className={`${INPUT} mt-2`} value={modelId} onChange={event => setModelId(event.target.value)}>{imageModels.map(model => <option key={model.id} value={model.id}>{model.display_name}</option>)}</select> : <p className="mt-2 text-xs text-amber-300">No active image model is registered yet.</p>}
    <div className="mt-2 flex flex-wrap items-center gap-3">
      <button disabled={!prompt.trim() || !modelId || Boolean(activeJob) || busy === `image-${version.id}`}
        onClick={() => submitImage()} className={BUTTON}>
        {busy === `image-${version.id}` ? 'Submitting request…' : pendingOperationKey ? 'Reconcile request' : 'Generate image'}
      </button>
      {allowVideo && <span className="text-sm font-semibold text-slate-500">Video not configured</span>}
    </div>
    {allowVideo && <DesignVideoCapabilities directionVersionId={version.id} />}
    {pendingOperationKey && !activeJob && <p className="mt-2 text-xs text-amber-200">The last response was interrupted. “Reconcile request” reuses the same request identity and cannot create a second paid call.</p>}
    {!!versionJobs.length && <div className="mt-3 space-y-2">{versionJobs.map(job => {
      const retryable = job.status === 'failed' && job.failure_phase === 'provider' && !retryChildren.has(job.id)
      const tone = job.status === 'succeeded' ? 'green' : ['failed', 'outcome_unknown'].includes(job.status) ? 'red' : 'violet'
      return <article key={job.id} className="rounded-xl border border-white/10 bg-white/[0.025] p-3 text-xs">
        <div className="flex flex-wrap items-center justify-between gap-2"><p className="font-semibold">Request {job.id.slice(0, 8)}</p><Badge tone={tone}>{job.status.replaceAll('_', ' ')}</Badge></div>
        <p className="mt-1 text-slate-500">{new Date(job.created_at).toLocaleString()} · exact model {job.model_registry_id.slice(0, 8)}</p>
        {job.failure_reason && <p className="mt-2 leading-5 text-red-200">{job.failure_reason}</p>}
        {job.status === 'outcome_unknown' && <p className="mt-2 leading-5 text-amber-200">The provider outcome cannot be proven. Paid retry is blocked; reconcile externally before any new request.</p>}
        <div className="mt-2 flex flex-wrap gap-2">
          {job.status === 'queued' && <button disabled={busy === `image-${version.id}`} onClick={() => submitImage(job)} className="rounded-lg border border-violet-400/30 px-2.5 py-1.5 font-semibold text-violet-200">Resume queued request</button>}
          {['running', 'outcome_unknown'].includes(job.status) && <button disabled={busy === `image-job-${job.id}`} onClick={() => onRefreshImageJob(job.id)} className="rounded-lg border border-white/10 px-2.5 py-1.5 font-semibold">Check status</button>}
          {retryable && <button disabled={busy === `retry-image-${job.id}`} onClick={() => onRetryImageJob(job.id, crypto.randomUUID())} className="rounded-lg border border-red-400/30 px-2.5 py-1.5 font-semibold text-red-200">Retry confirmed provider failure</button>}
        </div>
      </article>
    })}</div>}
    <p className="mt-3 text-[11px] leading-5 text-slate-500">Cancellation is not supported after submission. Requests remain reopenable here, and unresolved outcomes block replacement generation.</p>
    <div className="mt-3 grid gap-3">{versionAssets.map(asset => <MediaAsset key={asset.id} asset={asset} />)}</div>
  </section>
}

export function MediaAsset({ asset }) {
  if (asset.media_type === 'image' && asset.status === 'ready') return <figure className="overflow-hidden rounded-xl border border-white/10 bg-black/30">{asset.signed_url ? <img src={asset.signed_url} alt={asset.prompt} className="w-full object-cover" /> : <div className="p-4 text-xs text-amber-300">The private image link expired. Refresh the Workshop to renew it.</div>}<figcaption className="p-3 text-xs text-slate-400">{asset.prompt}</figcaption></figure>
  const failed = asset.status === 'failed'
  return <div className={`rounded-xl border p-3 text-xs ${failed ? 'border-red-500/20 bg-red-500/5 text-red-200' : asset.status === 'unavailable' ? 'border-amber-500/20 bg-amber-500/5 text-amber-200' : 'border-violet-500/20 bg-violet-500/5 text-violet-200'}`}><p className="font-semibold capitalize">{asset.media_type} · {asset.status}</p><p className="mt-1 leading-5">{asset.failure_reason || (asset.status === 'generating' ? 'Generation is in progress. Refresh to check again.' : asset.prompt)}</p>{failed && <p className="mt-1 text-slate-400">Adjust the prompt or connector, then generate a new attempt. This failed record stays in the audit trail.</p>}</div>
}


function Badge({ children, tone = 'slate' }) { const colors = { slate: 'bg-white/5 text-slate-300', green: 'bg-emerald-500/10 text-emerald-300', amber: 'bg-amber-500/10 text-amber-300', violet: 'bg-violet-500/10 text-violet-300', red: 'bg-red-500/10 text-red-300' }; return <span className={`inline-flex rounded-full px-2.5 py-1 text-[11px] font-semibold capitalize ${colors[tone]}`}>{children}</span> }
