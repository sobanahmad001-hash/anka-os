import { useEffect, useMemo, useState } from 'react'
import { latestDesignAssetVersion } from '../data/designAssetLibrary.js'

const MAX_BYTES = 10 * 1024 * 1024
const INPUT = 'w-full rounded-xl border border-white/10 bg-slate-950/70 px-3 py-2.5 text-sm text-slate-100 outline-none focus:border-violet-400'
const BUTTON = 'rounded-xl px-4 py-2.5 text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-violet-300 disabled:cursor-not-allowed disabled:opacity-40'

async function designAssetFileBase64(file) {
  const bytes = new Uint8Array(await file.arrayBuffer())
  let binary = ''
  for (let offset = 0; offset < bytes.length; offset += 32768) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 32768))
  }
  return btoa(binary)
}

function validateDesignAssetFile(file) {
  if (!file) return 'Choose a PNG file.'
  if (file.type !== 'image/png' || !/\.png$/i.test(file.name || '')) return 'Only PNG files are supported by the configured Design asset bucket.'
  if (!file.size || file.size > MAX_BYTES) return 'PNG files must be non-empty and no larger than 10 MiB.'
  return ''
}

export default function DesignAssetUpload({ workspace, contextKey, canUpload, busy, onUpload, onClose }) {
  const [assetId, setAssetId] = useState('')
  const [name, setName] = useState('')
  const [placement, setPlacement] = useState('')
  const [rightsNotes, setRightsNotes] = useState('')
  const [changeSummary, setChangeSummary] = useState('')
  const [file, setFile] = useState(null)
  const [error, setError] = useState('')
  const [operationKey, setOperationKey] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const assets = workspace.designAssets || []
  const versions = useMemo(() => workspace.designAssetVersions || [], [workspace.designAssetVersions])
  const selectedAsset = assets.find(item => item.id === assetId) || null
  const latest = useMemo(() => latestDesignAssetVersion(versions.filter(item => item.asset_id === assetId)), [assetId, versions])

  useEffect(() => {
    setAssetId(''); setName(''); setPlacement(''); setRightsNotes(''); setChangeSummary(''); setFile(null); setError(''); setOperationKey(''); setSubmitting(false)
  }, [contextKey])

  function chooseAsset(nextId) {
    const asset = assets.find(item => item.id === nextId)
    setAssetId(nextId)
    setName(asset?.name || '')
    setPlacement(asset?.placement || '')
    setRightsNotes(asset?.rights_notes || '')
    setChangeSummary('')
    setError('')
    setOperationKey('')
  }

  async function submit(event) {
    event.preventDefault()
    if (submitting) return
    const fileError = validateDesignAssetFile(file)
    if (!canUpload) return setError('An authorized official Design contributor context is required.')
    if (!name.trim()) return setError('Asset name is required.')
    if (fileError) return setError(fileError)
    if (selectedAsset && !latest) return setError('The selected asset has no current version. Refresh before replacing it.')
    try {
      setError('')
      setSubmitting(true)
      const stableOperationKey = operationKey || crypto.randomUUID()
      if (!operationKey) setOperationKey(stableOperationKey)
      await onUpload({
        engagement_id: workspace.engagement.id,
        brand_id: workspace.engagement.brand_id,
        asset_id: selectedAsset?.id || null,
        expected_latest_version_id: latest?.id || null,
        source_direction_version_id: null,
        name: name.trim(),
        placement: placement.trim(),
        rights_notes: rightsNotes.trim(),
        change_summary: changeSummary.trim(),
        original_filename: file.name,
        mime_type: file.type,
        file_base64: await designAssetFileBase64(file),
        operation_key: stableOperationKey,
      })
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Asset upload failed.')
    } finally {
      setSubmitting(false)
    }
  }

  return <form onSubmit={submit} className="mt-5 rounded-2xl border border-cyan-400/20 bg-cyan-500/[0.04] p-4" aria-labelledby="design-upload-title">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><p className="text-xs font-semibold uppercase tracking-wider text-cyan-300">Authorized draft upload</p><h3 id="design-upload-title" className="mt-1 text-lg font-semibold">Upload PNG asset version</h3><p className="mt-1 text-sm text-slate-400">PNG only · 10 MiB maximum. Replacing creates a new immutable draft version; it never overwrites an earlier object.</p></div>
      <button type="button" onClick={onClose} className={BUTTON + ' border border-white/10 text-slate-200'}>Close upload</button>
    </div>
    <div className="mt-4 grid gap-4 sm:grid-cols-2">
      <label className="grid gap-1 text-sm text-slate-300">Destination<select value={assetId} onChange={event => chooseAsset(event.target.value)} className={INPUT}><option value="">New Design asset</option>{assets.map(asset => <option key={asset.id} value={asset.id}>New version of {asset.name}</option>)}</select></label>
      <label className="grid gap-1 text-sm text-slate-300">PNG file<input type="file" accept="image/png,.png" onChange={event => { const nextFile = event.target.files?.[0] || null; setFile(nextFile); setOperationKey(crypto.randomUUID()); if (nextFile && !name.trim()) setName(nextFile.name.replace(/\.png$/i, '')); setError('') }} className={INPUT} /></label>
      <label className="grid gap-1 text-sm text-slate-300">Asset name<input value={name} disabled={Boolean(selectedAsset)} maxLength={180} onChange={event => setName(event.target.value)} className={INPUT} /></label>
      <label className="grid gap-1 text-sm text-slate-300">Placement, optional<input value={placement} maxLength={500} onChange={event => setPlacement(event.target.value)} className={INPUT} /></label>
      <label className="grid gap-1 text-sm text-slate-300 sm:col-span-2">Rights or usage notes, optional<textarea value={rightsNotes} maxLength={2000} onChange={event => setRightsNotes(event.target.value)} className={INPUT} /></label>
      {selectedAsset && <label className="grid gap-1 text-sm text-slate-300 sm:col-span-2">Change summary, optional<textarea value={changeSummary} maxLength={1000} onChange={event => setChangeSummary(event.target.value)} className={INPUT} /></label>}
    </div>
    {selectedAsset && <p className="mt-3 text-xs text-slate-400">Current exact version: {latest ? `v${latest.version_number} · ${latest.id}` : 'Unavailable — refresh required'}.</p>}
    <p className="mt-3 text-xs text-slate-500">Private asset uploads are not configured in this S05 contract. This action saves only to the visible official engagement and brand.</p>
    {error && <p role="alert" className="mt-3 text-sm text-red-200">{error}</p>}
    <button type="submit" disabled={!canUpload || busy || submitting} className={BUTTON + ' mt-4 bg-cyan-600 text-white hover:bg-cyan-500'}>{busy || submitting ? 'Uploading and validating…' : selectedAsset ? 'Upload new draft version' : 'Upload draft asset'}</button>
  </form>
}
