import { useState } from 'react'

const INPUT = 'w-full rounded-xl border border-slate-700 bg-slate-950 px-3.5 py-2.5 text-sm text-white outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-500/20'
const PRIMARY = 'rounded-xl bg-sky-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-sky-500 disabled:cursor-not-allowed disabled:opacity-50'

export default function DepartmentChat({
  departmentId,
  departmentLabel = departmentId,
  engagement,
  artifactTypes,
  artifactDefinitions,
  artifactForType,
  stageForType,
  onPropose,
  onCreated,
}) {
  const [artifactType, setArtifactType] = useState(artifactTypes[0] || '')
  const [prompt, setPrompt] = useState('')
  const [safe, setSafe] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState(null)

  async function submit(event) {
    event.preventDefault()
    setBusy(true); setError(''); setResult(null)
    try {
      const artifact = artifactForType(artifactType)
      const proposed = await onPropose({
        engagement_id: engagement.id, artifact_id: artifact?.id || null,
        engagement_stage_instance_id: stageForType(artifactType)?.id || null,
        artifact_type: artifactType,
        title: artifact?.title || `${artifactDefinitions[artifactType].label} artifact`,
        prompt, prompt_safe_for_ai: safe,
        change_summary: 'Draft proposed via Shared Department Chat',
      })
      setResult(proposed)
      setPrompt(''); setSafe(false)
      await onCreated(proposed)
    } catch (reason) {
      setError(reason.message)
    } finally {
      setBusy(false)
    }
  }

  return <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
    <form onSubmit={submit} className="rounded-2xl border border-slate-800 bg-slate-900/70 p-6">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-sky-400">Shared Department Chat · {departmentId}</p>
        <h2 className="mt-2 text-2xl font-semibold text-white">Propose a structured artifact draft</h2>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-400">The single configured model receives this engagement and approved AI-safe context. It creates one ordinary unapproved version; it cannot approve, release, publish, call a business connector, or perform external work.</p>
      </div>
      {error && <div className="mt-5 rounded-xl border border-red-900/60 bg-red-950/40 p-3 text-sm text-red-300">{error}</div>}
      {result && <div className="mt-5 rounded-xl border border-emerald-900/60 bg-emerald-950/30 p-4 text-sm text-emerald-300">Draft version {result.version?.version_number} created. It remains unapproved and must follow the normal human review gate.</div>}
      <div className="mt-6 space-y-5">
        <label className="block text-xs font-semibold uppercase tracking-[0.12em] text-slate-400">Artifact type
          <select className={`${INPUT} mt-2 normal-case tracking-normal`} value={artifactType} onChange={event => setArtifactType(event.target.value)}>
            {artifactTypes.map(type => <option key={type} value={type}>{artifactDefinitions[type].label}</option>)}
          </select>
        </label>
        <label className="block text-xs font-semibold uppercase tracking-[0.12em] text-slate-400">Draft request
          <textarea required rows="10" className={`${INPUT} mt-2 normal-case tracking-normal`} value={prompt} onChange={event => setPrompt(event.target.value)} placeholder="Describe the draft you need, the evidence to prioritize, known constraints, tone, and gaps the team should keep visible." />
        </label>
        <label className="flex items-start gap-3 rounded-xl border border-amber-900/50 bg-amber-950/20 p-4 text-sm leading-6 text-amber-200">
          <input required type="checkbox" className="mt-1" checked={safe} onChange={event => setSafe(event.target.checked)} />
          <span>I confirm this prompt is safe to send to the engagement-mapped {departmentLabel} model. Restricted artifact versions are never included automatically.</span>
        </label>
        <button disabled={busy || !safe} className={`${PRIMARY} w-full`}>{busy ? 'Creating unapproved draft…' : 'Propose draft artifact'}</button>
      </div>
    </form>
    <aside className="space-y-4">
      <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5">
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Current context</p>
        <p className="mt-2 font-semibold text-white">{engagement.brands?.name || engagement.name}</p>
        <p className="mt-1 text-sm text-slate-400">{engagement.agency_clients?.name}</p>
      </div>
      <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5 text-sm leading-6 text-slate-400">
        <p className="font-semibold text-white">Human control remains intact</p>
        <p className="mt-2">The human user is recorded as the timeline actor. The model run is separately traceable. Approval remains available only through the normal exact-version manager action.</p>
      </div>
    </aside>
  </div>
}
