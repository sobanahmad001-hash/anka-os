import { useCallback, useEffect, useRef, useState } from 'react'

import { pipelineExecutionDefinitions } from '../data/pipelineExecutionDefinitions.js'

const INPUT = 'w-full rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm text-white outline-none focus:border-violet-500/60'
const EMPTY_STEP = () => ({ key: '', label: '', kind: 'human', service_id: '', department_id: '', depends_on: [] })
const KINDS = [
  ['human', 'Human'], ['ai_assisted', 'AI-assisted'],
  ['automatic', 'Automatic'], ['approval_gate', 'Approval gate'],
]

export default function PipelineExecutionDefinitionPanel({ organizationId, catalog, services, membership, signal }) {
  const [records, setRecords] = useState({ definitions: [], approvals: [], publications: [] })
  const [presetId, setPresetId] = useState('')
  const [name, setName] = useState('')
  const [steps, setSteps] = useState([EMPTY_STEP()])
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const requestId = useRef('')
  const role = membership?.role
  const canDraft = ['system_owner', 'operations_admin', 'department_manager'].includes(role)
  const canPublish = ['system_owner', 'operations_admin'].includes(role)
  const publishedPreset = (catalog.publications || []).find(row => row.id === presetId)
  const eligibleServices = (catalog.selections || [])
    .filter(row => row.pipeline_template_version_id === publishedPreset?.pipeline_template_version_id)
    .map(row => services.find(service => service.id === row.service_id))
    .filter(service => service?.is_active)
  const serviceById = new Map(eligibleServices.map(service => [service.id, service]))

  const refresh = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const next = await pipelineExecutionDefinitions.list(organizationId, { signal })
      if (!signal?.aborted) setRecords(next)
    } catch (failure) {
      if (!signal?.aborted) setError(failure.message)
    } finally {
      if (!signal?.aborted) setLoading(false)
    }
  }, [organizationId, signal])

  useEffect(() => { refresh() }, [refresh])

  function changePreset(value) {
    requestId.current = ''
    setPresetId(value)
    setSteps([EMPTY_STEP()])
  }

  function changeStep(index, field, value) {
    requestId.current = ''
    setSteps(current => {
      const priorKey = current[index].key
      return current.map((step, position) => {
        if (position !== index) {
          return field === 'key' && position > index
            ? { ...step, depends_on: step.depends_on.map(key => key === priorKey ? value : key) }
            : step
        }
        if (field === 'service_id') return {
          ...step, service_id: value, department_id: serviceById.get(value)?.department_id || '',
        }
        return { ...step, [field]: value }
      })
    })
  }

  function removeStep(index) {
    requestId.current = ''
    setSteps(current => current.filter((_, position) => position !== index)
      .map(step => ({ ...step, depends_on: step.depends_on.filter(key => key !== current[index].key) })))
  }

  async function create(event) {
    event.preventDefault()
    requestId.current ||= crypto.randomUUID()
    setBusy(true); setError(''); setNotice('')
    try {
      const result = await pipelineExecutionDefinitions.create({
        organizationId, presetPublicationId: presetId, requestId: requestId.current, name, steps,
      }, { signal })
      if (signal?.aborted) return
      setNotice(`Execution definition v${result.version_number} saved. Department approval and publication are separate.`)
      requestId.current = ''
      setName('')
      setSteps([EMPTY_STEP()])
      await refresh()
    } catch (failure) {
      if (!signal?.aborted) setError(failure.message)
    } finally {
      if (!signal?.aborted) setBusy(false)
    }
  }

  async function act(action, definitionId) {
    setBusy(true); setError(''); setNotice('')
    try {
      if (action === 'approve') {
        await pipelineExecutionDefinitions.approve({
          definitionId, departmentId: membership.departmentId,
        }, { signal })
        setNotice('Exact execution definition approval recorded.')
      } else {
        await pipelineExecutionDefinitions.publish(definitionId, { signal })
        setNotice('Exact execution definition published. Project activation remains separate.')
      }
      if (!signal?.aborted) await refresh()
    } catch (failure) {
      if (!signal?.aborted) setError(failure.message)
    } finally {
      if (!signal?.aborted) setBusy(false)
    }
  }

  return <section className="mt-7 rounded-2xl border border-white/[0.07] bg-[#0e111a]/80 p-5" aria-labelledby="execution-definitions-heading">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><h2 id="execution-definitions-heading" className="font-semibold">Pipeline execution steps</h2>
        <p className="mt-1 text-xs text-slate-500">Define ordered work separately from service presets. Saving or publishing never starts a run.</p></div>
      <button type="button" onClick={refresh} disabled={busy} className="rounded-lg border border-white/10 px-3 py-2 text-xs font-semibold disabled:opacity-40">Refresh</button>
    </div>
    {error && <p role="alert" className="mt-3 text-sm text-red-300">{error}</p>}
    {notice && <p role="status" className="mt-3 text-sm text-emerald-300">{notice}</p>}
    {loading ? <p className="mt-4 text-sm text-slate-500">Loading execution definitions…</p>
      : <div className="mt-4 space-y-2">
        {records.definitions.length === 0 && <p className="text-sm text-slate-500">No execution definitions yet. Existing presets remain service selections only.</p>}
        {records.definitions.map(definition => {
          const published = records.publications.some(row => row.definition_id === definition.id)
          const departments = [...new Set(definition.steps.map(step => step.department_id))]
          const signed = new Set(records.approvals.filter(row => row.definition_id === definition.id).map(row => row.department_id))
          const preset = catalog.publications?.find(row => row.id === definition.preset_publication_id)
          const presetName = catalog.versions?.find(row => row.id === preset?.pipeline_template_version_id)?.name || 'Published preset'
          return <article key={definition.id} className="rounded-xl border border-white/[0.06] bg-white/[0.025] p-3 text-sm">
            <p className="font-medium">{definition.name} · v{definition.version_number} <span className="text-xs text-slate-500">{published ? 'Published' : 'Draft'}</span></p>
            <p className="mt-1 text-xs text-slate-500">{presetName} · {definition.steps.length} ordered steps · {definition.steps_sha256.slice(0, 12)}</p>
            <ol className="mt-2 list-decimal space-y-1 pl-5 text-xs text-slate-300">{definition.steps.map(step =>
              <li key={step.key}>{step.label} · {step.kind.replaceAll('_', ' ')} · {step.department_id}{step.depends_on.length ? ` · after ${step.depends_on.join(', ')}` : ''}</li>)}</ol>
            <p className="mt-2 text-xs text-slate-500">Head signoffs: {departments.map(department => `${department} ${signed.has(department) ? 'recorded' : 'pending'}`).join(' · ')}. Current roles are rechecked at publication.</p>
            {!published && <div className="mt-3 flex gap-2">
              {role === 'department_manager' && departments.includes(membership.departmentId) && <button type="button" disabled={busy} onClick={() => act('approve', definition.id)} className="rounded-lg border border-violet-500/40 px-3 py-1.5 text-xs text-violet-200 disabled:opacity-40">Approve for {membership.departmentId}</button>}
              {canPublish && <button type="button" disabled={busy} onClick={() => act('publish', definition.id)} className="rounded-lg bg-violet-500 px-3 py-1.5 text-xs text-white disabled:opacity-40">Publish exact version</button>}
            </div>}
          </article>
        })}
      </div>}
    {canDraft && <form onSubmit={create} className="mt-6 space-y-4 border-t border-white/[0.07] pt-5">
      <h3 className="text-sm font-semibold">Draft an immutable execution version</h3>
      <label className="block text-xs text-slate-400">Published service preset
        <select required className={INPUT} value={presetId} onChange={event => changePreset(event.target.value)}>
          <option value="">Choose a published preset</option>
          {(catalog.publications || []).map(preset => {
            const version = catalog.versions?.find(row => row.id === preset.pipeline_template_version_id)
            return <option key={preset.id} value={preset.id}>{version?.name || 'Preset'} · v{version?.version_number || '?'}</option>
          })}
        </select>
      </label>
      <label className="block text-xs text-slate-400">Execution version name
        <input required maxLength={160} className={INPUT} value={name} onChange={event => { requestId.current = ''; setName(event.target.value) }} />
      </label>
      <div className="space-y-3">{steps.map((step, index) => <fieldset key={index} className="rounded-xl border border-white/[0.07] p-3">
        <legend className="px-1 text-xs font-semibold text-violet-200">Step {index + 1}</legend>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-xs text-slate-400">Key<input required pattern="[a-z][a-z0-9_]*" maxLength={64} className={INPUT} value={step.key} onChange={event => changeStep(index, 'key', event.target.value)} placeholder="draft_copy" /></label>
          <label className="text-xs text-slate-400">Label<input required maxLength={160} className={INPUT} value={step.label} onChange={event => changeStep(index, 'label', event.target.value)} placeholder="Draft copy" /></label>
          <label className="text-xs text-slate-400">Kind<select className={INPUT} value={step.kind} onChange={event => changeStep(index, 'kind', event.target.value)}>{KINDS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          <label className="text-xs text-slate-400">Service<select required className={INPUT} value={step.service_id} onChange={event => changeStep(index, 'service_id', event.target.value)}><option value="">Choose a selected service</option>{eligibleServices.map(service => <option key={service.id} value={service.id}>{service.name} · {service.department_id}</option>)}</select></label>
        </div>
        {index > 0 && <div className="mt-3 text-xs text-slate-400">Depends on earlier steps<div className="mt-1 flex flex-wrap gap-3">{steps.slice(0, index).filter(prior => prior.key).map(prior => <label key={prior.key} className="flex items-center gap-1"><input type="checkbox" checked={step.depends_on.includes(prior.key)} onChange={event => changeStep(index, 'depends_on', event.target.checked ? [...step.depends_on, prior.key] : step.depends_on.filter(key => key !== prior.key))} />{prior.label || prior.key}</label>)}</div></div>}
        {steps.length > 1 && <button type="button" onClick={() => removeStep(index)} className="mt-3 text-xs text-rose-300">Remove step</button>}
      </fieldset>)}</div>
      <div className="flex gap-2"><button type="button" disabled={steps.length >= 50} onClick={() => { requestId.current = ''; setSteps(current => [...current, EMPTY_STEP()]) }} className="rounded-lg border border-white/10 px-3 py-2 text-xs disabled:opacity-40">Add step</button>
        <button type="submit" disabled={busy || !presetId || !eligibleServices.length} className="rounded-lg bg-violet-500 px-4 py-2 text-xs font-semibold disabled:opacity-40">{busy ? 'Saving…' : 'Save draft version'}</button></div>
    </form>}
  </section>
}