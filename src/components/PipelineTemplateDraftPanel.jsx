import { useState } from 'react'

import { canDraftPipelineTemplate, seedPipelineDraft } from '../data/pipelineTemplateDrafts.js'

const INPUT = 'w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm text-white outline-none focus:border-violet-500/60'


export default function PipelineTemplateDraftPanel({ catalog, services, membership, onCreate, onRefresh, busy, loadError }) {
  const [templateId, setTemplateId] = useState('')
  const [form, setForm] = useState(() => seedPipelineDraft({}, ''))
  const canDraft = canDraftPipelineTemplate(membership)
  const published = new Set((catalog.publications || []).map(row => row.pipeline_template_version_id))
  const templateById = new Map((catalog.templates || []).map(row => [row.id, row]))
  const unavailable = form.serviceIds.filter(id => !services.some(service => service.id === id))

  function selectTemplate(id) {
    setTemplateId(id)
    setForm(seedPipelineDraft(catalog, id))
  }

  function toggleService(id) {
    setForm(current => ({
      ...current,
      serviceIds: current.serviceIds.includes(id)
        ? current.serviceIds.filter(value => value !== id)
        : [...current.serviceIds, id],
    }))
  }

  async function submit(event) {
    event.preventDefault()
    const saved = await onCreate({ ...form, pipelineTemplateId: templateId || null })
    if (saved) selectTemplate('')
  }

  return <section className="mt-7 rounded-2xl border border-white/[0.07] bg-[#0e111a]/80 p-5" aria-labelledby="pipeline-drafts-heading">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><h2 id="pipeline-drafts-heading" className="font-semibold">Pipeline presets</h2><p className="mt-1 text-xs text-slate-500">Immutable versions select services. Current delivery rules still determine the journey.</p></div>
      <button type="button" onClick={onRefresh} className="rounded-lg border border-white/10 px-3 py-2 text-xs font-semibold">Refresh</button>
    </div>
    {loadError && <p role="alert" className="mt-3 text-sm text-red-300">Presets could not be loaded: {loadError}</p>}
    {!loadError && <div className="mt-4 space-y-2">
      {(catalog.versions || []).length === 0 && <p className="text-sm text-slate-500">No visible preset versions yet.</p>}
      {(catalog.versions || []).map(version => <div key={version.id} className="rounded-xl border border-white/[0.06] bg-white/[0.025] px-3 py-2 text-sm">
        <span className="font-medium">{templateById.get(version.pipeline_template_id)?.slug || 'Pipeline'} · v{version.version_number} · {version.name}</span>
        <span className="ml-2 text-xs text-slate-500">{published.has(version.id) ? 'Published' : 'Draft'}</span>
      </div>)}
    </div>}
    {canDraft && !loadError && <form onSubmit={submit} className="mt-6 space-y-4 border-t border-white/[0.07] pt-5">
      <div><h3 className="text-sm font-semibold">Create an immutable draft version</h3><p className="mt-1 text-xs text-slate-500">Choose a new preset or copy the latest visible version. Publishing is a separate governed step.</p></div>
      <label className="block text-xs text-slate-400">Preset
        <select className={INPUT} value={templateId} onChange={event => selectTemplate(event.target.value)}>
          <option value="">New preset</option>
          {(catalog.templates || []).map(template => <option key={template.id} value={template.id}>{template.slug}</option>)}
        </select>
      </label>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-xs text-slate-400">Slug<input required readOnly={Boolean(templateId)} className={INPUT} value={form.slug} onChange={event => setForm(current => ({ ...current, slug: event.target.value }))} placeholder="website_delivery" /></label>
        <label className="text-xs text-slate-400">Version name<input required maxLength={160} className={INPUT} value={form.name} onChange={event => setForm(current => ({ ...current, name: event.target.value }))} /></label>
      </div>
      <label className="block text-xs text-slate-400">Description<textarea maxLength={4000} className={INPUT} value={form.description} onChange={event => setForm(current => ({ ...current, description: event.target.value }))} /></label>
      <label className="block text-xs text-slate-400">Change summary<textarea maxLength={1000} className={INPUT} value={form.changeSummary} onChange={event => setForm(current => ({ ...current, changeSummary: event.target.value }))} /></label>
      <fieldset><legend className="text-xs text-slate-400">Ordered services</legend><p className="mt-1 text-xs text-slate-500">Select services in the order they should appear in this preset.</p>
        <div className="mt-2 grid gap-2 sm:grid-cols-2">{services.map(service => <label key={service.id} className="flex items-start gap-2 rounded-lg border border-white/[0.06] p-2 text-xs text-slate-300"><input type="checkbox" checked={form.serviceIds.includes(service.id)} onChange={() => toggleService(service.id)} /><span>{service.name} · {service.department_id}</span></label>)}</div>
        {unavailable.length > 0 && <div role="alert" className="mt-2 text-xs text-amber-300">Unavailable inherited services must be removed before saving: {unavailable.map(id => <button key={id} type="button" onClick={() => toggleService(id)} className="ml-2 underline">Remove {id}</button>)}</div>}
        {form.serviceIds.length > 0 && <p className="mt-2 text-xs text-slate-500">Order: {form.serviceIds.map(id => services.find(service => service.id === id)?.name || id).join(' → ')}</p>}
      </fieldset>
      <button type="submit" disabled={busy || !form.slug || !form.name || !form.serviceIds.length || unavailable.length > 0} className="rounded-xl bg-violet-500 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-40">{busy ? 'Saving draft…' : 'Save draft version'}</button>
    </form>}
  </section>
}
