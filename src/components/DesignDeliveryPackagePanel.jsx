import { useMemo, useRef, useState } from 'react'

import {
  activePackageDestinations, designPackageTargetKey, emptyDesignPackageDraft,
  isCurrentPackageResponse, packageVersionStatus, validateDesignPackageDraft,
} from '../data/designDeliveryPackages.js'

const INPUT = 'w-full rounded-xl border border-white/10 bg-slate-950/70 px-3 py-2.5 text-sm text-slate-100 outline-none focus:border-violet-500/60'
const BUTTON = 'rounded-xl bg-violet-500 px-4 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40'

export default function DesignDeliveryPackagePanel({ workspace, context, canSave, onPreview, onSave }) {
  const [draft, setDraft] = useState(emptyDesignPackageDraft)
  const [preview, setPreview] = useState(null)
  const [previewKey, setPreviewKey] = useState('')
  const [operationKey, setOperationKey] = useState('')
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const requestSequence = useRef(0)
  const destinations = useMemo(() => activePackageDestinations(workspace.deliveryServices), [workspace.deliveryServices])
  const selectedDestination = destinations.find(item => item.id === draft.destination_engagement_service_id)
  const latestVersion = draft.artifact_id
    ? [...workspace.deliveryPackageVersions.filter(item => item.artifact_id === draft.artifact_id)]
      .sort((left, right) => right.version_number - left.version_number)[0]
    : null
  const targetKey = designPackageTargetKey(context, draft, latestVersion?.id)
  const validation = validateDesignPackageDraft(draft, context)

  function change(field, value) {
    requestSequence.current += 1
    setDraft(current => ({ ...current, [field]: value }))
    setPreview(null); setPreviewKey(''); setOperationKey(''); setError(''); setMessage('')
  }
  function toggleVersion(versionId) {
    const selected = draft.selected_version_ids.includes(versionId)
      ? draft.selected_version_ids.filter(id => id !== versionId)
      : [...draft.selected_version_ids, versionId]
    change('selected_version_ids', selected)
  }
  function payload(key = operationKey) {
    return {
      artifact_id: draft.artifact_id || null,
      expected_latest_version_id: latestVersion?.id || null,
      engagement_id: workspace.engagement.id,
      brand_id: workspace.engagement.brand_id,
      source_engagement_service_id: context.activeServiceId,
      destination_department_id: selectedDestination?.departmentId || null,
      destination_engagement_service_id: selectedDestination?.id || null,
      project_task_id: context.workRecord?.kind === 'project_task' ? context.workRecord.id : null,
      engagement_work_item_id: context.workRecord?.kind === 'engagement_work_item' ? context.workRecord.id : null,
      operation_key: key,
      title: draft.title,
      asset_version_ids: draft.selected_version_ids,
      content: draft,
    }
  }
  async function runPreview() {
    if (!validation.valid) { setError(`Complete: ${validation.missing.join(', ')}.`); return }
    const sequence = ++requestSequence.current
    const key = targetKey
    setBusy('preview'); setError(''); setMessage('')
    try {
      const result = await onPreview(payload())
      if (!isCurrentPackageResponse(sequence, requestSequence.current, key, designPackageTargetKey(context, draft, latestVersion?.id))) return
      setPreview(result); setPreviewKey(key)
    } catch (reason) { if (sequence === requestSequence.current) setError(reason.message) }
    finally { if (sequence === requestSequence.current) setBusy('') }
  }
  async function save() {
    if (!canSave || previewKey !== targetKey || !preview) { setError('Preview the current exact target before saving.'); return }
    const key = operationKey || crypto.randomUUID()
    if (!operationKey) setOperationKey(key)
    const sequence = ++requestSequence.current
    setBusy('save'); setError(''); setMessage('')
    try {
      const result = await onSave(payload(key))
      if (sequence !== requestSequence.current) return
      setMessage(`Saved immutable package version ${result.version.version_number}. No approval, release, publication, or delivery occurred.`)
      setDraft(emptyDesignPackageDraft()); setPreview(null); setPreviewKey(''); setOperationKey('')
    } catch (reason) {
      if (sequence === requestSequence.current) setError(`${reason.message} Retry keeps the same package operation identity.`)
    } finally { if (sequence === requestSequence.current) setBusy('') }
  }
  function openPackage(artifact) {
    const version = [...workspace.deliveryPackageVersions.filter(item => item.artifact_id === artifact.id)]
      .sort((left, right) => right.version_number - left.version_number)[0]
    if (!version) return
    const packageContext = workspace.deliveryPackageContexts.find(item => item.artifact_version_id === version.id)
    const references = workspace.deliveryPackageAssetReferences.filter(item => item.artifact_version_id === version.id)
      .sort((left, right) => left.position - right.position)
    requestSequence.current += 1
    setDraft({ ...emptyDesignPackageDraft(), ...version.content, title: artifact.title, artifact_id: artifact.id,
      destination_engagement_service_id: packageContext?.destination_engagement_service_id || '',
      selected_version_ids: references.map(item => item.design_asset_version_id) })
    setPreview(null); setPreviewKey(''); setOperationKey(''); setError(''); setMessage('Loaded the latest immutable version as a new draft. Preview before saving another version.')
  }

  return <section aria-labelledby="design-delivery-title" className="mt-6 rounded-2xl border border-violet-400/20 bg-slate-900/70 p-5">
    <div className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-xs font-semibold uppercase tracking-wider text-violet-300">Design S07 · Review package</p><h2 id="design-delivery-title" className="mt-2 text-xl font-semibold">Website or social package draft</h2><p className="mt-2 max-w-3xl text-sm leading-6 text-slate-400">Pin exact asset versions, usage and placement to the existing work record. Preview and save create no approval, publication, client delivery, downstream work, or ZIP.</p></div><span className="rounded-full bg-amber-500/15 px-3 py-1 text-xs font-semibold text-amber-200">Unapproved draft</span></div>
    {error && <p role="alert" className="mt-4 rounded-xl bg-red-500/10 p-3 text-sm text-red-200">{error}</p>}
    {message && <p aria-live="polite" className="mt-4 rounded-xl bg-emerald-500/10 p-3 text-sm text-emerald-200">{message}</p>}
    <div className="mt-5 grid gap-4 lg:grid-cols-2">
      <label className="text-xs font-semibold uppercase tracking-wider text-slate-500">Package title<input className={`${INPUT} mt-2 normal-case tracking-normal`} value={draft.title} onChange={event => change('title', event.target.value)} /></label>
      <label className="text-xs font-semibold uppercase tracking-wider text-slate-500">Destination<select className={`${INPUT} mt-2 normal-case tracking-normal`} value={draft.destination_type} onChange={event => change('destination_type', event.target.value)}><option value="website">Website</option><option value="social">Social</option></select></label>
      <label className="text-xs font-semibold uppercase tracking-wider text-slate-500">Placement label<input className={`${INPUT} mt-2 normal-case tracking-normal`} value={draft.placement_label} onChange={event => change('placement_label', event.target.value)} placeholder="Homepage hero or launch post" /></label>
      {draft.destination_type === 'website'
        ? <label className="text-xs font-semibold uppercase tracking-wider text-slate-500">Website page or section<input className={`${INPUT} mt-2 normal-case tracking-normal`} value={draft.website_page_section} onChange={event => change('website_page_section', event.target.value)} /></label>
        : <label className="text-xs font-semibold uppercase tracking-wider text-slate-500">Platform or custom placement<input className={`${INPUT} mt-2 normal-case tracking-normal`} value={draft.social_platform} onChange={event => change('social_platform', event.target.value)} /></label>}
      <div className="grid grid-cols-2 gap-3"><label className="text-xs font-semibold uppercase tracking-wider text-slate-500">Width px<input type="number" min="1" className={`${INPUT} mt-2 normal-case tracking-normal`} value={draft.width} onChange={event => change('width', event.target.value)} /></label><label className="text-xs font-semibold uppercase tracking-wider text-slate-500">Height px<input type="number" min="1" className={`${INPUT} mt-2 normal-case tracking-normal`} value={draft.height} onChange={event => change('height', event.target.value)} /></label></div>
      <label className="text-xs font-semibold uppercase tracking-wider text-slate-500">Existing downstream service<select className={`${INPUT} mt-2 normal-case tracking-normal`} value={draft.destination_engagement_service_id} onChange={event => change('destination_engagement_service_id', event.target.value)}><option value="">None — downstream delivery blocked</option>{destinations.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
      <label className="text-xs font-semibold uppercase tracking-wider text-slate-500 lg:col-span-2">Usage instructions<textarea rows="3" className={`${INPUT} mt-2 normal-case tracking-normal`} value={draft.usage_instructions} onChange={event => change('usage_instructions', event.target.value)} /></label>
      <label className="text-xs font-semibold uppercase tracking-wider text-slate-500 lg:col-span-2">Placement and export guidance<textarea rows="2" className={`${INPUT} mt-2 normal-case tracking-normal`} value={draft.export_guidance} onChange={event => change('export_guidance', event.target.value)} /></label>
    </div>
    <div className="mt-5"><p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Exact asset versions</p><div className="mt-2 grid gap-2 md:grid-cols-2">{workspace.designAssetVersions.map(version => { const asset = workspace.designAssets.find(item => item.id === version.asset_id); return <label key={version.id} className="flex items-center gap-3 rounded-xl border border-white/10 p-3 text-sm"><input type="checkbox" checked={draft.selected_version_ids.includes(version.id)} onChange={() => toggleVersion(version.id)} /><span className="min-w-0"><span className="block truncate font-semibold">{asset?.name || 'Design asset'} · v{version.version_number}</span><span className="block text-xs text-slate-500">{version.width || 'Unknown'}×{version.height || 'Unknown'} · {version.id.slice(0, 8)}</span></span></label>})}</div>{!workspace.designAssetVersions.length && <p className="mt-2 text-sm text-slate-500">No accessible exact asset versions are available.</p>}</div>
    <div className="mt-5 flex flex-wrap gap-3"><button type="button" className="rounded-xl border border-violet-400/30 px-4 py-2.5 text-sm font-semibold text-violet-200 disabled:opacity-40" disabled={busy !== '' || !validation.valid} onClick={runPreview}>{busy === 'preview' ? 'Checking exact versions…' : 'Preview package'}</button><button type="button" className={BUTTON} disabled={busy !== '' || !canSave || previewKey !== targetKey} onClick={save}>{busy === 'save' ? 'Saving exact version…' : 'Save unapproved version'}</button></div>
    {preview && previewKey === targetKey && <div className="mt-5 rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-4"><p className="font-semibold text-emerald-200">Current target preview is valid</p><p className="mt-1 text-xs text-slate-400">{preview.selected_versions.length} exact version(s) · temporary previews expire in {preview.signed_url_expires_in} seconds · downstream: {preview.destination_status.replaceAll('_', ' ')}</p><div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{preview.selected_versions.map(item => <figure key={item.id}><img className="aspect-video w-full rounded-lg object-cover" src={item.preview_url} alt={`Temporary preview of ${item.original_filename}`} /><figcaption className="mt-1 text-xs text-slate-500">v{item.version_number} · {item.width || '?'}×{item.height || '?'}</figcaption></figure>)}</div></div>}
    {!draft.destination_engagement_service_id && <p className="mt-4 text-sm text-amber-200">Content, Marketing, or Development delivery is blocked until an already active permitted service is selected. Saving this independent Design draft remains allowed.</p>}
    <div className="mt-6 border-t border-white/10 pt-5"><h3 className="font-semibold">Existing package versions</h3><div className="mt-3 space-y-2">{workspace.deliveryPackageArtifacts.map(artifact => { const versions = workspace.deliveryPackageVersions.filter(item => item.artifact_id === artifact.id); const latest = [...versions].sort((a, b) => b.version_number - a.version_number)[0]; const workLabel = context.workRecord ? `${context.workRecord.kind}:${context.workRecord.id.slice(0, 8)}` : 'existing work unavailable'; return <button type="button" key={artifact.id} onClick={() => openPackage(artifact)} className="flex w-full items-center justify-between rounded-xl border border-white/10 p-3 text-left"><span><span className="block text-sm font-semibold">{artifact.title}</span><span className="text-xs text-slate-500">{workLabel} · exact version {latest?.version_number || '?'}</span></span><span className="text-xs font-semibold capitalize text-violet-300">{packageVersionStatus(latest, workspace.approvals, workspace.deliveryPackageContexts)}</span></button>})}{!workspace.deliveryPackageArtifacts.length && <p className="text-sm text-slate-500">No saved package versions for this engagement.</p>}</div><p className="mt-3 text-xs text-slate-500">Submit-for-review remains on the existing shared artifact approval contract. This panel does not duplicate or alter that authority.</p></div>
  </section>
}
