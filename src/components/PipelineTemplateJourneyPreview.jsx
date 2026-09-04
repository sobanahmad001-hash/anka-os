const labelize = value => String(value || '').replaceAll('_', ' ').replace(/\b\w/g, letter => letter.toUpperCase())

export default function PipelineTemplateJourneyPreview({ preview, loading, error, onPreview }) {
  if (loading) return <div className="rounded-xl border border-violet-500/20 bg-violet-500/5 p-4 text-sm text-violet-200">Planning the current journey…</div>
  if (error) return <div className="rounded-xl border border-red-500/25 bg-red-500/5 p-4 text-sm text-red-200">{error}</div>
  if (!preview) {
    return <button type="button" onClick={onPreview} className="w-full rounded-xl border border-violet-400/40 px-4 py-3 text-sm font-semibold text-violet-200">Preview template journey</button>
  }

  const stages = preview.stages || []
  const prerequisites = preview.prerequisites || []
  const dependencies = preview.dependencies || []
  return (
    <section className="rounded-2xl border border-violet-500/25 bg-violet-500/[0.06] p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold">Current-rule journey preview</p>
          <p className="mt-1 text-xs text-slate-400">Read-only. Creation rechecks this plan before writing anything.</p>
        </div>
        <button type="button" onClick={onPreview} className="rounded-lg border border-white/10 px-3 py-2 text-xs font-semibold">Refresh preview</button>
      </div>
      {preview.is_historical_version && <p className="mt-3 rounded-lg bg-amber-500/10 px-3 py-2 text-xs text-amber-200">Historical preset: its service selection is unchanged, while this preview uses current canonical rules.</p>}
      {preview.has_rule_drift && <p className="mt-2 rounded-lg bg-amber-500/10 px-3 py-2 text-xs text-amber-200">Canonical rules have changed since this version was published.</p>}
      {preview.was_customized && <p className="mt-2 text-xs text-violet-200">Customized before creation: {(preview.customization_provenance || []).map(change => `${labelize(change.action)} ${change.service_id}`).join(' · ')}</p>}
      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        {[
          ['Services', (preview.services || []).length],
          ['Stages', stages.length],
          ['Dependencies', dependencies.length],
        ].map(([label, value]) => <div key={label} className="rounded-xl bg-black/15 p-3"><p className="text-lg font-semibold">{value}</p><p className="text-[10px] uppercase tracking-wide text-slate-500">{label}</p></div>)}
      </div>
      <div className="mt-4 space-y-2">
        {stages.map((stage, index) => <div key={stage.id} className="rounded-lg border border-white/[0.07] bg-black/15 px-3 py-2"><p className="text-sm font-medium">{index + 1}. {stage.name}</p><p className="text-xs text-slate-500">{labelize(stage.stage_kind)} · {labelize(stage.status)}</p></div>)}
      </div>
      {prerequisites.length > 0 && <div className="mt-4"><p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Prerequisites</p>{prerequisites.map(item => <p key={`${item.service_id}:${item.prerequisite_key}`} className="mt-2 text-xs text-slate-300">{labelize(item.prerequisite_key)} — {labelize(item.satisfaction_method)}</p>)}</div>}
    </section>
  )
}
