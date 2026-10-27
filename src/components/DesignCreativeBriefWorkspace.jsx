import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
import { CREATIVE_BRIEF_OUTPUTS, creativeBriefForContext, emptyCreativeBrief, latestBriefVersion, nextOperationKey, validateCreativeBrief } from '../data/designCreativeBriefs.js'
import { approvedDesignSystemReferences } from '../data/designIdentityReferences.js'

const INPUT = 'w-full rounded-xl border border-[var(--anka-line)] bg-[var(--anka-surface)] px-3 py-2.5 text-sm text-[var(--anka-ink)] outline-none focus:border-[var(--anka-focus)]'
const BUTTON = 'rounded-xl bg-[var(--anka-violet)] px-4 py-2.5 text-sm font-semibold text-[var(--anka-on-violet)] disabled:cursor-not-allowed disabled:opacity-40'

function snapshot(brief, latest, sources, scopeKey) {
  const content = latest?.content || emptyCreativeBrief()
  const sourceIds = (sources || []).filter(source => source.creative_brief_version_id === latest?.id)
    .map(source => source.artifact_version_id)
  return { scopeKey, savedVersionId: latest?.id || '', savedContent: content,
    savedSourceIds: sourceIds, content, sourceIds }
}

function hasEdits(draft) {
  return JSON.stringify(draft.content) !== JSON.stringify(draft.savedContent)
    || JSON.stringify([...draft.sourceIds].sort()) !== JSON.stringify([...draft.savedSourceIds].sort())
}

const DesignCreativeBriefWorkspace = forwardRef(function DesignCreativeBriefWorkspace({
  workspace, activeServiceId, workRecord, busy, canSave, onSave, onFreeze, onDirtyChange, onSummaryChange,
  outputTypeLabel = 'Output type', visibility = 'official', selectedPrivateBriefId = '', useBriefLabel = 'Use exact saved version for generation later',
}, ref) {
  const brief = visibility === 'private'
    ? (workspace.creativeBriefs || []).find(item => item.visibility === 'private'
      && item.organization_id === workspace.engagement.organization_id && item.id === selectedPrivateBriefId) || null
    : creativeBriefForContext(
      workspace.creativeBriefs || [], workspace.engagement.organization_id,
      workspace.engagement.id, activeServiceId, workRecord,
    )
  const latest = latestBriefVersion(brief, workspace.creativeBriefVersions || [])
  const scopeKey = [workspace.engagement.organization_id, visibility, selectedPrivateBriefId, workspace.engagement.id, activeServiceId,
    workRecord?.kind || '', workRecord?.id || ''].join(':')
  const [storedDraft, setDraft] = useState(() => snapshot(brief, latest, workspace.creativeBriefSources, scopeKey))
  const operation = useRef(null)
  const localRevision = useRef(0)
  const appliedReceipts = useRef(new Set())
  const adoptedVersion = useRef(null)
  const preserveChatConflict = useRef(false)
  const [chatConflict, setChatConflict] = useState('')
  const [saveError, setSaveError] = useState('')
  const draft = storedDraft.scopeKey !== scopeKey || (storedDraft.savedVersionId !== (latest?.id || '') && storedDraft.savedVersionId !== adoptedVersion.current && !preserveChatConflict.current && !hasEdits(storedDraft))
    ? snapshot(brief, latest, workspace.creativeBriefSources, scopeKey) : storedDraft
  const { content, sourceIds } = draft
  const mediaReferences = content.media_references || []
  const mediaRoots = new Map((workspace.designAssets || []).filter(asset => !asset.archived_at).map(asset => [asset.id, asset]))
  const mediaOptions = (workspace.designAssetVersions || []).filter(version => mediaRoots.has(version.asset_id))
  const dirty = hasEdits(draft)
  const conflict = draft.savedVersionId !== (latest?.id || '')
  const validation = useMemo(() => validateCreativeBrief(content), [content])
  const identityOptions = useMemo(() => approvedDesignSystemReferences(workspace), [workspace])
  const identityVersionIds = useMemo(() => new Set((workspace.identitySystemVersions || []).map(item => item.id)), [workspace.identitySystemVersions])
  const otherSourceVersions = useMemo(() => (workspace.versions || []).filter(version => !identityVersionIds.has(version.id)), [identityVersionIds, workspace.versions])
  const unavailableSourceIds = sourceIds.filter(id => !identityVersionIds.has(id) && !otherSourceVersions.some(version => version.id === id))
  useEffect(() => {
    localRevision.current += 1
    if (adoptedVersion.current === latest?.id) adoptedVersion.current = null
    operation.current = null
    setSaveError('')
    setDraft(current => current.scopeKey !== scopeKey
      || (current.savedVersionId !== (latest?.id || '') && current.savedVersionId !== adoptedVersion.current && !preserveChatConflict.current && !hasEdits(current))
      ? snapshot(brief, latest, workspace.creativeBriefSources, scopeKey) : current)
  }, [scopeKey, latest?.id]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { preserveChatConflict.current = false; adoptedVersion.current = null; appliedReceipts.current.clear(); setChatConflict('') }, [scopeKey])
  useEffect(() => { onDirtyChange?.(dirty) }, [dirty, onDirtyChange])
  useEffect(() => { onSummaryChange?.({briefId:brief?.id||'',serviceId:activeServiceId||'',title:content.title,missing:validation.missing.length,conflict:conflict||Boolean(chatConflict),error:saveError||chatConflict}) }, [onSummaryChange,brief?.id,activeServiceId,content.title,validation.missing.length,conflict,chatConflict,saveError])
  function set(field, value) {
    localRevision.current += 1; operation.current = null; setSaveError('')
    setDraft(current => ({ ...current, content: { ...current.content, [field]: value } }))
  }
  function toggleSource(id) {
    localRevision.current += 1; operation.current = null; setSaveError('')
    setDraft(current => ({ ...current, sourceIds: current.sourceIds.includes(id)
      ? current.sourceIds.filter(item => item !== id) : [...current.sourceIds, id] }))
  }
  function toggleMedia(id) {
    localRevision.current += 1; operation.current = null; setSaveError('')
    setDraft(current => {
      const refs = current.content.media_references || []
      const next = refs.some(ref => ref.kind === 'design_asset_version' && ref.id === id)
        ? refs.filter(ref => ref.id !== id)
        : [...refs, { kind: 'design_asset_version', id }].sort((a, b) => a.id.localeCompare(b.id))
      return { ...current, content: { ...current.content, media_references: next } }
    })
  }
  async function saveDraft() {
    if (!canSave || conflict || !content.title.trim() || busy === 'save-brief') return false
    const fingerprint = JSON.stringify({ scopeKey, content, sourceIds: [...sourceIds].sort() })
    if (operation.current?.fingerprint !== fingerprint) operation.current = { fingerprint, key: nextOperationKey() }
    setSaveError('')
    const result = await onSave({
      creative_brief_id: brief?.id || null, visibility,
      engagement_id: visibility === 'private' ? null : workspace.engagement.id,
      brand_id: visibility === 'private' ? null : workspace.engagement.brand_id,
      engagement_service_id: visibility === 'private' ? null : activeServiceId,
      project_task_id: workRecord?.kind === 'project_task' ? workRecord.id : null,
      engagement_work_item_id: workRecord?.kind === 'engagement_work_item' ? workRecord.id : null,
      expected_revision: brief?.revision || 0, operation_key: operation.current.key,
      content, source_version_ids: sourceIds,
    })
    if (!result) setSaveError('Save failed; your edits remain here. Retry the same draft or refresh its status.')
    return result
  }
  function captureForChat() {
    if (!canSave || conflict || preserveChatConflict.current) throw new Error('Resolve the saved brief conflict before sending another brief update.')
    return { scopeKey, localRevision: localRevision.current, savedVersionId: draft.savedVersionId,
      binding: { creative_brief_id: brief?.id || null, expected_revision: brief?.revision || 0, visibility,
        engagement_id: visibility === 'private' ? null : workspace.engagement.id,
        brand_id: visibility === 'private' ? null : workspace.engagement.brand_id,
        engagement_service_id: visibility === 'private' ? null : activeServiceId,
        content: JSON.parse(JSON.stringify(content)), source_version_ids: [...sourceIds] } }
  }
  function adoptChatResult(sent, receipt) {
    if (!receipt || receipt.status !== 'saved') {
      if (receipt?.status === 'conflict') { preserveChatConflict.current = true; setChatConflict('A newer saved brief exists. Your edits remain here; review the saved version before continuing.') }
      return false
    }
    const saved = receipt.result?.brief, version = receipt.result?.version
    if (!saved?.id || !version?.id || version.creative_brief_id !== saved.id || !version.content
      || saved.visibility !== visibility || saved.organization_id !== workspace.engagement.organization_id
      || (visibility !== 'private' && (saved.engagement_id !== workspace.engagement.id || saved.engagement_service_id !== activeServiceId))) return false
    if (appliedReceipts.current.has(version.id)) return false
    // A reload has no captured local revision: only an untouched editor at the original base may adopt.
    const unchanged = sent && sent.scopeKey === scopeKey && sent.localRevision === localRevision.current
      && sent.savedVersionId === draft.savedVersionId
    if (!unchanged) { preserveChatConflict.current = true; setChatConflict('Chat saved a newer draft. Your current edits were kept; review or reload the saved version before continuing.'); return false }
    const savedSources = [...sent.binding.source_version_ids]
    localRevision.current += 1; operation.current = null; appliedReceipts.current.add(version.id); adoptedVersion.current = version.id
    preserveChatConflict.current = false; setSaveError(''); setChatConflict('')
    setDraft({ scopeKey, savedVersionId: version.id, savedContent: version.content, content: version.content,
      savedSourceIds: savedSources, sourceIds: savedSources })
    return true
  }
  useImperativeHandle(ref, () => ({ isDirty: () => dirty, canSave: () => canSave && !conflict && Boolean(content.title.trim()), save: saveDraft, captureForChat, adoptChatResult }))
  function save(event) { event.preventDefault(); void saveDraft() }
  return <section aria-labelledby="creative-brief-title" className="rounded-2xl border border-[var(--anka-line)] bg-[var(--anka-surface)] p-5">
    <div className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-xs font-semibold uppercase tracking-wider text-[var(--anka-violet)]">Creative brief</p><h2 id="creative-brief-title" className="mt-2 text-xl font-semibold">Shape your brief</h2><p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--anka-muted)]">Save your progress at any time. Choose a complete saved brief when you are ready to create. Saving a brief does not generate media or approve the work.</p></div><span className={`rounded-full px-3 py-1 text-xs font-semibold ${validation.valid ? 'bg-[var(--anka-success-soft)] text-[var(--anka-success)]' : 'bg-[var(--anka-warning-soft)] text-[var(--anka-warning)]'}`}>{validation.valid ? 'Ready to use' : `${validation.missing.length} details to complete`}</span></div>
    <form onSubmit={save} className="mt-5 grid gap-4 lg:grid-cols-2">
      <fieldset className="lg:col-span-2"><legend className="text-xs font-semibold text-[var(--anka-info)]">Saved image and video references</legend>
        <p className="mt-2 text-sm text-[var(--anka-muted)]">Choose saved versions to include. Later edits to those files will not change this brief.</p>
        <div className="mt-2 grid gap-2 sm:grid-cols-2">{mediaOptions.map(version => <label key={version.id} className="flex gap-2 rounded border border-[var(--anka-line)] p-2 text-sm">
          <input type="checkbox" checked={mediaReferences.some(ref => ref.kind === 'design_asset_version' && ref.id === version.id)} onChange={() => toggleMedia(version.id)} />
          <span>{mediaRoots.get(version.asset_id).name} · v{version.version_number} · {version.mime_type}</span>
        </label>)}
        {mediaReferences.filter(ref => !mediaOptions.some(version => version.id === ref.id)).map(ref => <label key={ref.id} className="flex gap-2 p-2 text-sm text-[var(--anka-warning)]">
          <input type="checkbox" checked onChange={() => toggleMedia(ref.id)} /><span>Unavailable exact media reference {ref.id} · remove to save without it</span>
        </label>)}</div>
      </fieldset>
      <Field label="Title"><input required maxLength="200" className={INPUT} value={content.title} onChange={event => set('title', event.target.value)} /></Field>
      <Field label={outputTypeLabel}><select className={INPUT} value={content.output_type} onChange={event => set('output_type', event.target.value)}>{CREATIVE_BRIEF_OUTPUTS.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></Field>
      <Field label="Purpose"><textarea rows="3" className={INPUT} value={content.purpose} onChange={event => set('purpose', event.target.value)} /></Field>
      <Field label="Audience"><textarea rows="3" className={INPUT} value={content.audience} onChange={event => set('audience', event.target.value)} /></Field>
      <Field label="Objective"><textarea rows="3" className={INPUT} value={content.objective} onChange={event => set('objective', event.target.value)} /></Field>
      <Field label="Placement or destination"><textarea rows="3" className={INPUT} value={content.placement_destination} onChange={event => set('placement_destination', event.target.value)} /></Field>
      <Field label="Requested outputs (comma separated)"><input className={INPUT} value={(content.requested_outputs || []).join(', ')} onChange={event => set('requested_outputs', event.target.value.split(',').map(value => value.trim()).filter(Boolean))} /></Field>
      <Field label="Rights notes"><textarea rows="3" className={INPUT} value={content.rights_notes} onChange={event => set('rights_notes', event.target.value)} /></Field>
      <Field label="Instructions"><textarea rows="4" className={INPUT} value={content.instructions} onChange={event => set('instructions', event.target.value)} /></Field>
      <Field label="Exclusions and constraints"><textarea rows="4" className={INPUT} value={content.exclusions_constraints} onChange={event => set('exclusions_constraints', event.target.value)} /></Field>
      <fieldset className="lg:col-span-2"><legend className="text-xs font-semibold uppercase tracking-wider text-[var(--anka-violet)]">Approved identity system references</legend><p className="mt-2 text-sm leading-6 text-[var(--anka-muted)]">Choose an approved design system version. A newer release will not replace your selection automatically.</p><div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">{identityOptions.map(({ artifact, version }) => <label key={version.id} className="flex gap-3 rounded-xl border border-[var(--anka-line)] bg-[var(--anka-violet-soft)] p-3 text-sm"><input type="checkbox" checked={sourceIds.includes(version.id)} onChange={() => toggleSource(version.id)} /><span><span className="block font-semibold">{artifact.title} · v{version.version_number}</span><span className="mt-1 block text-xs text-[var(--anka-muted)]">Exact version {version.id.slice(0, 8)}</span></span></label>)}{!identityOptions.length && <p className="text-sm text-[var(--anka-warning)]">{visibility === 'private' ? 'Identity references are optional for this private brief.' : 'No approved Design System version is visible for this brand.'}</p>}</div></fieldset>
      <fieldset className="lg:col-span-2"><legend className="text-xs font-semibold uppercase tracking-wider text-[var(--anka-muted)]">Other saved references</legend><div className="mt-2 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">{otherSourceVersions.map(version => <label key={version.id} className="flex gap-3 rounded-xl border border-[var(--anka-line)] p-3 text-sm"><input type="checkbox" checked={sourceIds.includes(version.id)} onChange={() => toggleSource(version.id)} /><span>Version {version.version_number} · {version.id.slice(0, 8)}</span></label>)}{unavailableSourceIds.map(id => <label key={id} className="flex gap-3 rounded-xl border border-[var(--anka-warning)] p-3 text-sm text-[var(--anka-warning)]"><input type="checkbox" checked onChange={() => toggleSource(id)} /><span>Unavailable pinned version {id.slice(0, 8)} · uncheck to remove</span></label>)}</div></fieldset>
      {conflict && <p role="alert" className="lg:col-span-2 text-sm text-[var(--anka-warning)]">A newer saved brief version is available. Your edits remain here; reload it only after you choose to discard these edits.</p>}
      {chatConflict && <p role="alert" className="lg:col-span-2">{chatConflict}</p>}
      {saveError && <p role="alert" className="lg:col-span-2 text-sm text-[var(--anka-danger)]">{saveError}</p>}
      {!validation.valid && <p role="status" className="lg:col-span-2 text-sm text-[var(--anka-warning)]">Still needed for {content.output_type.replaceAll('_', ' ')}: {validation.missing.join(', ')}.</p>}
      <div className="flex flex-wrap gap-2 lg:col-span-2"><button disabled={!canSave || conflict || busy === 'save-brief' || !content.title.trim()} className={BUTTON}>{busy === 'save-brief' ? 'Saving…' : 'Save brief'}</button><button type="button" disabled={!canSave || dirty || conflict || !brief || !latest || !latest.validation_snapshot?.valid || busy === 'freeze-brief'} onClick={() => onFreeze({ creative_brief_id: brief.id, creative_brief_version_id: latest.id, expected_revision: brief.revision, operation_key: nextOperationKey() })} className="rounded-xl border border-[var(--anka-line)] px-4 py-2.5 text-sm font-semibold disabled:opacity-40">{busy === 'freeze-brief' ? 'Freezing…' : useBriefLabel}</button></div>
    </form>
    {dirty && <p role="status" className="mt-4 text-xs text-[var(--anka-warning)]">Unsaved brief edits · save this draft or explicitly discard before changing work.</p>}
    {(conflict || chatConflict) && <button type="button" className="mt-3 text-xs font-semibold text-[var(--anka-violet)] underline" onClick={() => { localRevision.current += 1; operation.current = null; setSaveError(''); preserveChatConflict.current = false; setChatConflict(''); setDraft(snapshot(brief, latest, workspace.creativeBriefSources, scopeKey)) }}>Discard edits and reload saved version</button>}
    {latest && <p className="mt-4 text-xs text-[var(--anka-muted)]">Saved v{latest.version_number} · {new Date(latest.created_at).toLocaleString()} · {latest.id.slice(0, 8)}{brief.frozen_version_id === latest.id ? ' · selected for generation' : ''}</p>}
  </section>
})

export default DesignCreativeBriefWorkspace

function Field({ label, children }) { return <label className="block text-xs font-semibold uppercase tracking-wider text-[var(--anka-muted)]">{label}<span className="mt-2 block normal-case tracking-normal">{children}</span></label> }
