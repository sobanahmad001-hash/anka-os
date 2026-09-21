import { useCallback, useEffect, useRef, useState } from 'react'
import { projectPipelineConfigurations } from '../data/projectPipelineConfigurations.js'
import { normalizeSelectedSteps, parseMicrousd } from '../data/projectPipelineConfigurationsRepository.js'

const INPUT = 'w-full rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm text-white outline-none focus:border-violet-500/60'
const money = micro => micro == null ? 'none' : '$' + (Number(micro) / 1000000).toFixed(2)
const summary = steps => steps?.length ? steps.map(step => step.key + ' ×' + step.quantity).join(', ') : 'none'

export default function ProjectPipelineConfigurationPanel({ organizationId, engagement, services, membership, signal }) {
  const [records, setRecords] = useState({ available: [], configurations: [], activations: [] })
  const [publicationId, setPublicationId] = useState('')
  const [quantities, setQuantities] = useState({})
  const [cost, setCost] = useState('0')
  const [preview, setPreview] = useState(null)
  const [acknowledged, setAcknowledged] = useState(false)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const createRequest = useRef('')
  const activationRequest = useRef('')
  // Exact project-manager bindings are checked by the RPC, not inferred from an organization role.
  const canManage = Boolean(membership)
  const publication = records.available.find(row => row.id === publicationId)
  const definitionSteps = publication?.definition.steps || []
  const active = records.activations[0]
  const activeConfig = records.configurations.find(row => row.id === active?.configuration_id)
  const serviceIds = new Set(services.filter(row => ['planned', 'active'].includes(row.status)).map(row => row.service_id))
  const eligibleSteps = definitionSteps.filter(step => serviceIds.has(step.service_id))
  const aiSelected = eligibleSteps.some(step => quantities[step.key] && ['ai_assisted', 'automatic'].includes(step.kind))

  const refresh = useCallback(async () => {
    setPreview(null); setAcknowledged(false); activationRequest.current = ''
    setLoading(true)
    try {
      const next = await projectPipelineConfigurations.list(organizationId, engagement.id, { signal })
      if (!signal?.aborted) setRecords(next)
    } catch (failure) {
      if (!signal?.aborted) setError(failure.message)
    } finally {
      if (!signal?.aborted) setLoading(false)
    }
  }, [organizationId, engagement.id, signal])
  useEffect(() => { refresh() }, [refresh])

  function changeSelection(key, raw) {
    createRequest.current = ''
    setQuantities(current => {
      const next = { ...current, [key]: raw }
      if (!definitionSteps.some(step => next[step.key] && ['ai_assisted', 'automatic'].includes(step.kind))) setCost('0')
      return next
    })
  }
  function changePublication(id) {
    createRequest.current = ''
    setPublicationId(id)
    setQuantities({})
    setCost('0')
  }
  async function save(event) {
    event.preventDefault()
    setBusy(true); setError(''); setNotice('')
    try {
      const selectedSteps = normalizeSelectedSteps(definitionSteps, quantities)
      if (selectedSteps.some(selected => !serviceIds.has(definitionSteps.find(step => step.key === selected.key)?.service_id)))
        throw new TypeError('A selected service is not active in this project')
      const micro = parseMicrousd(cost)
      if ((aiSelected && micro === 0) || (!aiSelected && micro !== 0))
        throw new TypeError('AI-capable steps need a positive local limit; human-only plans use zero')
      createRequest.current ||= crypto.randomUUID()
      const saved = await projectPipelineConfigurations.create({
        organizationId, engagementId: engagement.id, definitionPublicationId: publicationId,
        requestId: createRequest.current, selectedSteps, maxAiCostMicrousd: micro,
      }, { signal })
      if (signal?.aborted) return
      createRequest.current = ''
      setNotice('Configuration revision ' + saved.revision + ' saved as a draft. Review impact before activation.')
      await refresh()
    } catch (failure) {
      if (!signal?.aborted) setError(failure.message)
    } finally {
      if (!signal?.aborted) setBusy(false)
    }
  }
  async function review(configurationId) {
    setBusy(true); setError(''); setNotice('')
    setPreview(null); setAcknowledged(false); activationRequest.current = ''
    try {
      const impact = await projectPipelineConfigurations.preview(organizationId, configurationId, { signal })
      if (!signal?.aborted) setPreview(impact)
    } catch (failure) {
      if (!signal?.aborted) setError(failure.message)
    } finally {
      if (!signal?.aborted) setBusy(false)
    }
  }
  async function activate() {
    setBusy(true); setError(''); setNotice('')
    try {
      activationRequest.current ||= crypto.randomUUID()
      const result = await projectPipelineConfigurations.activate({
        organizationId, configurationId: preview.configuration_id, requestId: activationRequest.current,
        impactToken: preview.impact_token_sha256, acknowledged,
      }, { signal })
      if (signal?.aborted) return
      activationRequest.current = ''
      setPreview(null); setAcknowledged(false)
      setNotice('Project configuration activated as version ' + result.activation_number + '. Existing work and jobs remain intact.')
      await refresh()
    } catch (failure) {
      if (!signal?.aborted) setError(failure.message)
    } finally {
      if (!signal?.aborted) setBusy(false)
    }
  }
  return <section className="rounded-2xl border border-white/[0.07] bg-[#0e111a]/80 p-5" aria-labelledby="project-config-heading">
    <div className="flex items-start justify-between gap-3"><div>
      <h2 id="project-config-heading" className="font-semibold">Project pipeline configuration</h2>
      <p className="mt-1 text-xs text-slate-500">Exact project managers and owner/admin may choose steps, review impact, and activate a draft. This does not start AI work.</p>
    </div><button type="button" onClick={refresh} disabled={busy} className="text-xs text-violet-300 disabled:opacity-40">Refresh</button></div>
    {error && <p role="alert" className="mt-3 text-sm text-red-300">{error}</p>}
    {notice && <p role="status" className="mt-3 text-sm text-emerald-300">{notice}</p>}
    {loading ? <p className="mt-4 text-sm text-slate-500">Loading project configurations…</p> : <>
      <p className="mt-4 text-xs text-slate-400">{activeConfig ? 'Active revision ' + activeConfig.revision + ' · ' + summary(activeConfig.selected_steps) + ' · local AI limit ' + money(activeConfig.max_ai_cost_microusd) : 'No project configuration is active.'}</p>
      {records.configurations.length > 0 && <div className="mt-4 space-y-2">{records.configurations.map(row => {
        const activated = records.activations.some(item => item.configuration_id === row.id)
        return <div key={row.id} className="rounded-lg border border-white/[0.07] p-3 text-xs text-slate-300">
          <p>Revision {row.revision} · {activated ? 'activated' : 'draft'} · {summary(row.selected_steps)}</p>
          <p className="mt-1 text-slate-500">Local AI limit {money(row.max_ai_cost_microusd)}</p>
          {canManage && !activated && <button type="button" disabled={busy} onClick={() => review(row.id)} className="mt-2 text-violet-300 disabled:opacity-40">Review activation impact</button>}
        </div>
      })}</div>}
      {preview && <div className="mt-4 rounded-lg border border-amber-500/30 bg-amber-500/[0.05] p-3 text-xs text-slate-300">
        <h3 className="font-semibold text-amber-200">Activation impact review</h3>
        <p className="mt-2">Current: {summary(preview.previous_selected_steps)} · {money(preview.previous_max_ai_cost_microusd)}</p>
        <p className="mt-1">New: {summary(preview.new_selected_steps)} · {money(preview.new_max_ai_cost_microusd)}</p>
        <p className="mt-1">Added: {preview.added_step_keys?.join(', ') || 'none'} · Removed: {preview.removed_step_keys?.join(', ') || 'none'}</p>
        <p className="mt-1">Existing jobs preserved: {preview.existing_jobs_preserved}. Existing work remains intact.</p>
        <label className="mt-3 flex items-start gap-2"><input type="checkbox" checked={acknowledged} onChange={event => setAcknowledged(event.target.checked)} />I reviewed this exact impact and approve activation.</label>
        <button type="button" disabled={busy || !acknowledged} onClick={activate} className="mt-3 rounded-lg bg-violet-500 px-3 py-2 font-semibold text-white disabled:opacity-40">Activate reviewed configuration</button>
      </div>}
      {canManage && <form onSubmit={save} className="mt-5 space-y-3 border-t border-white/[0.07] pt-4">
        <h3 className="text-sm font-semibold">Draft a new revision</h3>
        <label className="block text-xs text-slate-400">Published execution definition
          <select required className={INPUT} value={publicationId} onChange={event => changePublication(event.target.value)}>
            <option value="">Choose a definition</option>
            {records.available.map(row => <option key={row.id} value={row.id}>{row.definition.name} · v{row.definition.version_number}</option>)}
          </select>
        </label>
        {publication && <div className="space-y-2">{definitionSteps.map(step => <label key={step.key} className="flex items-center justify-between gap-3 rounded-lg border border-white/[0.06] p-2 text-xs text-slate-300">
          <span>{step.label} · {step.kind.replaceAll('_', ' ')}{step.depends_on?.length ? ' · after ' + step.depends_on.join(', ') : ''}{!serviceIds.has(step.service_id) ? ' · service unavailable' : ''}</span>
          <input aria-label={step.label + ' quantity'} type="number" min="1" max="50" placeholder="Off" disabled={!serviceIds.has(step.service_id)} className="w-16 rounded border border-white/10 bg-black/20 p-1 text-white" value={quantities[step.key] ?? ''} onChange={event => changeSelection(step.key, event.target.value)} />
        </label>)}</div>}
        <label className="block text-xs text-slate-400">Local AI cost limit (USD)
          <input required inputMode="decimal" className={INPUT} value={cost} onChange={event => { createRequest.current = ''; setCost(event.target.value) }} disabled={!aiSelected} />
          <span className="mt-1 block text-slate-500">{aiSelected ? 'A positive limit is required for AI-capable steps; this does not authorize provider use.' : 'Human-only plans use zero.'}</span>
        </label>
        <button type="submit" disabled={busy || !publication} className="rounded-lg bg-violet-500 px-3 py-2 text-xs font-semibold text-white disabled:opacity-40">Save draft revision</button>
      </form>}
      {!records.available.length && <p className="mt-4 text-xs text-slate-500">This project has no matching published execution definition yet.</p>}
    </>}
  </section>
}
