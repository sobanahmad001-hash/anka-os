import { useEffect, useMemo, useState } from 'react'
import { CREATIVE_BRIEF_OUTPUTS, creativeBriefForContext, emptyCreativeBrief, latestBriefVersion, nextOperationKey, validateCreativeBrief } from '../data/designCreativeBriefs.js'
import { approvedDesignSystemReferences } from '../data/designIdentityReferences.js'

const INPUT = 'w-full rounded-xl border border-white/10 bg-slate-950/70 px-3 py-2.5 text-sm text-slate-100 outline-none focus:border-violet-500/60'
const BUTTON = 'rounded-xl bg-violet-500 px-4 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40'

export default function DesignCreativeBriefWorkspace({ workspace, activeServiceId, workRecord, busy, canSave, onSave, onFreeze }) {
  const brief = creativeBriefForContext(
    workspace.creativeBriefs || [], workspace.engagement.organization_id,
    workspace.engagement.id, activeServiceId, workRecord,
  )
  const latest = latestBriefVersion(brief, workspace.creativeBriefVersions || [])
  const [content, setContent] = useState(() => latest?.content || emptyCreativeBrief())
  const [sourceIds, setSourceIds] = useState([])
  const validation = useMemo(() => validateCreativeBrief(content), [content])
  const identityOptions = useMemo(() => approvedDesignSystemReferences(workspace), [workspace])
  const identityVersionIds = useMemo(() => new Set((workspace.identitySystemVersions || []).map(item => item.id)), [workspace.identitySystemVersions])
  const otherSourceVersions = useMemo(() => (workspace.versions || []).filter(version => !identityVersionIds.has(version.id)), [identityVersionIds, workspace.versions])
  useEffect(() => {
    setContent(latest?.content || emptyCreativeBrief())
    setSourceIds((workspace.creativeBriefSources || [])
      .filter(source => source.creative_brief_version_id === latest?.id).map(source => source.artifact_version_id))
  }, [latest?.id, latest?.content, workspace.creativeBriefSources])
  function set(field, value) { setContent(current => ({ ...current, [field]: value })) }
  function toggleSource(id) { setSourceIds(current => current.includes(id) ? current.filter(item => item !== id) : [...current, id]) }
  function save(event) {
    event.preventDefault()
    onSave({
      creative_brief_id: brief?.id || null, visibility: 'official',
      engagement_id: workspace.engagement.id, brand_id: workspace.engagement.brand_id,
      engagement_service_id: activeServiceId,
      project_task_id: workRecord?.kind === 'project_task' ? workRecord.id : null,
      engagement_work_item_id: workRecord?.kind === 'engagement_work_item' ? workRecord.id : null,
      expected_revision: brief?.revision || 0, operation_key: nextOperationKey(),
      content, source_version_ids: sourceIds,
    })
  }
  return <section aria-labelledby="creative-brief-title" className="rounded-2xl border border-violet-500/20 bg-slate-900/70 p-5">
    <div className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-xs font-semibold uppercase tracking-wider text-violet-300">B02 · Creative brief</p><h2 id="creative-brief-title" className="mt-2 text-xl font-semibold">Draft before generation</h2><p className="mt-2 max-w-3xl text-sm leading-6 text-slate-400">Save title-only or incomplete work as an immutable version. Validation is guidance, not approval, and no provider runs here.</p></div><span className={`rounded-full px-3 py-1 text-xs font-semibold ${validation.valid ? 'bg-emerald-500/15 text-emerald-300' : 'bg-amber-500/15 text-amber-300'}`}>{validation.valid ? 'Ready to freeze' : `${validation.missing.length} validation item(s)`}</span></div>
    <form onSubmit={save} className="mt-5 grid gap-4 lg:grid-cols-2">
      <Field label="Title"><input required maxLength="200" className={INPUT} value={content.title} onChange={event => set('title', event.target.value)} /></Field>
      <Field label="Output type"><select className={INPUT} value={content.output_type} onChange={event => set('output_type', event.target.value)}>{CREATIVE_BRIEF_OUTPUTS.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></Field>
      <Field label="Purpose"><textarea rows="3" className={INPUT} value={content.purpose} onChange={event => set('purpose', event.target.value)} /></Field>
      <Field label="Audience"><textarea rows="3" className={INPUT} value={content.audience} onChange={event => set('audience', event.target.value)} /></Field>
      <Field label="Objective"><textarea rows="3" className={INPUT} value={content.objective} onChange={event => set('objective', event.target.value)} /></Field>
      <Field label="Placement or destination"><textarea rows="3" className={INPUT} value={content.placement_destination} onChange={event => set('placement_destination', event.target.value)} /></Field>
      <Field label="Requested outputs (comma separated)"><input className={INPUT} value={(content.requested_outputs || []).join(', ')} onChange={event => set('requested_outputs', event.target.value.split(',').map(value => value.trim()).filter(Boolean))} /></Field>
      <Field label="Rights notes"><textarea rows="3" className={INPUT} value={content.rights_notes} onChange={event => set('rights_notes', event.target.value)} /></Field>
      <Field label="Instructions"><textarea rows="4" className={INPUT} value={content.instructions} onChange={event => set('instructions', event.target.value)} /></Field>
      <Field label="Exclusions and constraints"><textarea rows="4" className={INPUT} value={content.exclusions_constraints} onChange={event => set('exclusions_constraints', event.target.value)} /></Field>
      <fieldset className="lg:col-span-2"><legend className="text-xs font-semibold uppercase tracking-wider text-violet-300">Approved identity system references</legend><p className="mt-2 text-sm leading-6 text-slate-400">Choose an exact released DS5 version. A newer release is never adopted automatically; changing this selection and saving creates a new immutable brief version.</p><div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">{identityOptions.map(({ artifact, version }) => <label key={version.id} className="flex gap-3 rounded-xl border border-violet-500/20 bg-violet-500/5 p-3 text-sm"><input type="checkbox" checked={sourceIds.includes(version.id)} onChange={() => toggleSource(version.id)} /><span><span className="block font-semibold">{artifact.title} · v{version.version_number}</span><span className="mt-1 block text-xs text-slate-500">Exact version {version.id.slice(0, 8)}</span></span></label>)}{!identityOptions.length && <p className="text-sm text-amber-300">No approved Design System version is visible for this brand.</p>}</div></fieldset>
      <fieldset className="lg:col-span-2"><legend className="text-xs font-semibold uppercase tracking-wider text-slate-400">Other pinned exact source versions</legend><div className="mt-2 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">{otherSourceVersions.map(version => <label key={version.id} className="flex gap-3 rounded-xl border border-white/10 p-3 text-sm"><input type="checkbox" checked={sourceIds.includes(version.id)} onChange={() => toggleSource(version.id)} /><span>Version {version.version_number} · {version.id.slice(0, 8)}</span></label>)}</div></fieldset>
      {!validation.valid && <p role="status" className="lg:col-span-2 text-sm text-amber-300">Still needed for {content.output_type.replaceAll('_', ' ')}: {validation.missing.join(', ')}.</p>}
      <div className="flex flex-wrap gap-2 lg:col-span-2"><button disabled={!canSave || busy === 'save-brief' || !content.title.trim()} className={BUTTON}>{busy === 'save-brief' ? 'Saving…' : 'Save immutable draft version'}</button><button type="button" disabled={!canSave || !brief || !latest || !latest.validation_snapshot?.valid || busy === 'freeze-brief'} onClick={() => onFreeze({ creative_brief_id: brief.id, creative_brief_version_id: latest.id, expected_revision: brief.revision, operation_key: nextOperationKey() })} className="rounded-xl border border-white/10 px-4 py-2.5 text-sm font-semibold disabled:opacity-40">{busy === 'freeze-brief' ? 'Freezing…' : 'Use exact saved version for generation later'}</button></div>
    </form>
    {latest && <p className="mt-4 text-xs text-slate-500">Server-saved v{latest.version_number} · {new Date(latest.created_at).toLocaleString()} · {latest.id.slice(0, 8)}{brief.frozen_version_id === latest.id ? ' · frozen input' : ''}</p>}
  </section>
}

function Field({ label, children }) { return <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400">{label}<span className="mt-2 block normal-case tracking-normal">{children}</span></label> }
