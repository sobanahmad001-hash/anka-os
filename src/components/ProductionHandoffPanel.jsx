import { useEffect, useMemo, useRef, useState } from 'react'

import { designAssetAccessState } from '../data/designAssetLibrary.js'
import {
  productionHandoffPackageEvidence,
  productionHandoffReadiness,
} from '../data/productionHandoffReadiness.js'

const BUTTON = 'rounded-xl bg-violet-500 px-4 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40'
const SECONDARY = 'rounded-xl border border-white/10 px-3 py-2 text-sm font-semibold text-slate-200 disabled:cursor-not-allowed disabled:opacity-40'

function statusTone(status) {
  if (status === 'ready') return 'bg-emerald-500/15 text-emerald-300'
  if (status === 'failed') return 'bg-red-500/15 text-red-300'
  return 'bg-amber-500/15 text-amber-300'
}

export default function ProductionHandoffPanel({
  release,
  packages,
  packageOptions = [],
  clientReleases = [],
  canReleaseClient = false,
  onReleaseClient,
  directionVersions,
  mediaAssets,
  variants,
  mediaAccess,
  canPrepare,
  createUncertain = false,
  busy,
  onPrepare,
  onDownload,
  onRefresh,
}) {
  const releaseRequestIds = useRef(new Map())
  const [detailsOpen, setDetailsOpen] = useState(false)
  const [selectedPackageVersionId, setSelectedPackageVersionId] = useState('')
  const [clock, setClock] = useState(() => Date.now())
  const [localBusy, setLocalBusy] = useState('')
  const [actionError, setActionError] = useState('')
  const [message, setMessage] = useState('')
  const [localCreateUncertain, setLocalCreateUncertain] = useState(false)
  const readiness = useMemo(() => productionHandoffReadiness({
    release, directionVersions, mediaAssets, variants,
  }), [release, directionVersions, mediaAssets, variants])
  const releasePackages = (packages || [])
    .filter(item => item.design_direction_release_id === release.id)
    .sort((left, right) => new Date(right.created_at) - new Date(left.created_at))
  const packagePreparing = releasePackages.some(item => item.status === 'preparing')
  const exactVersionLabel = readiness.version
    ? `v${readiness.version.version_number} · ${readiness.version.id}`
    : readiness.exactVersionId || 'Unavailable in this authorized snapshot'
  const issuedAt = Number(mediaAccess?.issuedAt)
  const effectiveNow = Math.max(clock, Date.now())
  const accessOptions = { ...mediaAccess, now: effectiveNow }
  const submissionUncertain = createUncertain || localCreateUncertain

  useEffect(() => {
    setClock(Date.now())
    const seconds = Number(mediaAccess?.expiresInSeconds)
    if (!Number.isFinite(issuedAt) || !Number.isFinite(seconds) || seconds <= 5) return undefined
    const expiresAt = issuedAt + ((seconds - 5) * 1000)
    const delay = Math.max(0, expiresAt - Date.now())
    const timer = window.setTimeout(() => setClock(Date.now()), delay + 25)
    return () => window.clearTimeout(timer)
  }, [issuedAt, mediaAccess?.expiresInSeconds])

  async function prepare() {
    setLocalBusy('prepare'); setActionError(''); setMessage('')
    try {
      await onPrepare(release, selectedPackageVersionId || null)
    } catch (reason) {
      setLocalCreateUncertain(true)
      setActionError(`${reason instanceof Error ? reason.message : String(reason)} The server may already hold a package. Refresh exact handoff status before preparing another.`)
    } finally {
      setLocalBusy('')
    }
  }

  async function releaseToClient(item) {
    if (!window.confirm(`Release exact Design package ${item.design_delivery_package_version_id} from handoff ${item.id} to the client portal? The internal ZIP will remain team-only.`)) return
    const requestId = releaseRequestIds.current.get(item.id) || crypto.randomUUID()
    releaseRequestIds.current.set(item.id, requestId)
    setLocalBusy(`client-release-${item.id}`); setActionError(''); setMessage('')
    try {
      await onReleaseClient(item.id, requestId, '')
      releaseRequestIds.current.delete(item.id)
      setMessage('Exact Design handoff released to the client portal for review. The internal ZIP was not shared.')
    } catch (reason) {
      setActionError(`${reason instanceof Error ? reason.message : String(reason)} Refresh release status before retrying with the same request.`)
    } finally {
      setLocalBusy('')
    }
  }
  async function download(item) {
    setLocalBusy(`download-${item.id}`); setActionError(''); setMessage('')
    try {
      await onDownload(item.id)
    } catch (reason) {
      setActionError(`${reason instanceof Error ? reason.message : String(reason)} No package was rebuilt. Refresh access and request a new temporary download link.`)
    } finally {
      setLocalBusy('')
    }
  }

  async function refreshStatus() {
    setLocalBusy('refresh'); setActionError(''); setMessage('')
    try {
      const refreshed = await onRefresh()
      if (refreshed === false) throw new Error('The authorized handoff snapshot could not be refreshed.')
      setLocalCreateUncertain(false)
      setMessage('Exact release, package status, and temporary source previews were refreshed. No package was rebuilt.')
    } catch (reason) {
      setActionError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setLocalBusy('')
    }
  }

  function guardPreview(event, asset) {
    const current = designAssetAccessState({
      mediaType: asset.media_type, status: asset.status, previewUrl: asset.signed_url,
    }, { ...mediaAccess, now: Date.now() })
    if (current.canOpen) return
    event.preventDefault()
    setClock(Date.now())
    setActionError(`${current.message} Refresh exact handoff status before opening this source again.`)
  }

  return <section aria-labelledby="production-handoff-title" aria-busy={Boolean(localBusy)} className="rounded-2xl border border-violet-400/20 bg-slate-900/70 p-5">
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div>
        <p className="text-xs font-semibold uppercase tracking-wider text-violet-300">DS6 · Production handoff</p>
        <h2 id="production-handoff-title" className="mt-2 text-xl font-semibold">Package the released direction</h2>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-400">
          Bundle this exact release, its direction specification, ready media, and released-format
          variants. Existing files are copied as-is; nothing is edited, regenerated, or published.
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        <button type="button" className={SECONDARY} aria-expanded={detailsOpen} aria-controls="production-handoff-evidence" onClick={() => setDetailsOpen(value => !value)}>
          {detailsOpen ? 'Hide exact contents' : 'Review exact contents'}
        </button>
        <button
          type="button"
          className={BUTTON}
          disabled={!canPrepare || !readiness.ready || packagePreparing || submissionUncertain || busy === `handoff-${release.id}` || localBusy !== ''}
          onClick={prepare}
        >
          {busy === `handoff-${release.id}` || localBusy === 'prepare' ? 'Preparing package…' : 'Prepare production package'}
        </button>
      </div>
    </div>

    {!!packageOptions.length && <label className="mt-4 block max-w-xl text-xs font-semibold uppercase tracking-wider text-slate-400">Approved Design delivery package to include
      <select value={selectedPackageVersionId} disabled={Boolean(submissionUncertain || packagePreparing || localBusy)} onChange={event => setSelectedPackageVersionId(event.target.value)} className="mt-2 block w-full rounded-xl border border-white/10 bg-slate-950 p-2.5 text-sm font-normal normal-case text-slate-100">
        <option value="">Direction-only handoff (no S07 package)</option>
        {packageOptions.map(item => <option key={item.id} value={item.id}>{item.title || 'Design package'} · v{item.version_number} · {item.id.slice(0, 8)}</option>)}
      </select>
    </label>}
    {!!packageOptions.length && <p className="mt-2 text-xs text-slate-500">Only an already approved exact S07 version can be included. The internal ZIP remains team-only; this does not release anything to clients.</p>}
    <div className="mt-4 grid gap-3 text-xs sm:grid-cols-2 xl:grid-cols-4">
      <p className="rounded-lg bg-white/[0.03] p-3"><span className="block uppercase tracking-wider text-slate-500">Release</span><code className="mt-1 block break-all text-slate-300">{release.id}</code></p>
      <p className="rounded-lg bg-white/[0.03] p-3"><span className="block uppercase tracking-wider text-slate-500">Exact direction version</span><code className="mt-1 block break-all text-slate-300">{exactVersionLabel}</code></p>
      <p className="rounded-lg bg-white/[0.03] p-3"><span className="block uppercase tracking-wider text-slate-500">Content checksum</span><code className="mt-1 block break-all text-slate-300">{readiness.version?.content_checksum || 'Unavailable in this authorized snapshot'}</code></p>
      <p className="rounded-lg bg-white/[0.03] p-3"><span className="block uppercase tracking-wider text-slate-500">Current source rows</span><span className="mt-1 block text-slate-300">{readiness.assets.length} media · {readiness.variants.length} variants</span></p>
    </div>

    {!canPrepare && <p className="mt-4 rounded-xl border border-amber-500/20 bg-amber-500/10 p-3 text-sm text-amber-100">Read-only handoff view. Your current Design capability does not permit preparing a package.</p>}
    {!readiness.ready && <p role="alert" className="mt-4 rounded-xl border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-200">Preparation is blocked: {readiness.blockers.join(', ')}. Refresh the authorized context; no substitute version or file will be used.</p>}
    {submissionUncertain && <p role="status" className="mt-4 rounded-xl border border-amber-500/20 bg-amber-500/10 p-3 text-sm text-amber-100">Package creation remains locked because its result is uncertain. Refresh status before another create action.</p>}
    {actionError && <p role="alert" className="mt-4 rounded-xl border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-200">{actionError}</p>}
    {message && <p aria-live="polite" className="mt-4 rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-3 text-sm text-emerald-100">{message}</p>}

    {detailsOpen && <div id="production-handoff-evidence" className="mt-5 rounded-xl border border-white/10 bg-slate-950/45 p-4">
      <h3 className="font-semibold">Exact source readiness</h3>
      <div className="mt-3 grid gap-3 md:grid-cols-2">
        {readiness.assets.map(asset => {
          const access = designAssetAccessState({
            mediaType: asset.media_type, status: asset.status, previewUrl: asset.signed_url,
          }, accessOptions)
          return <article key={asset.id} className="rounded-xl border border-white/10 p-3">
            <p className="text-sm font-semibold capitalize">{asset.media_type} · {asset.id.slice(0, 8)}</p>
            <p className="mt-1 text-xs text-slate-500">Exact version {readiness.exactVersionId.slice(0, 8) || 'unavailable'} · {asset.status}</p>
            {access.canOpen
              ? <a className="mt-3 block focus:outline-none focus:ring-2 focus:ring-violet-400" href={access.url} target="_blank" rel="noreferrer" onClick={event => guardPreview(event, asset)}><img className="aspect-video w-full rounded-lg object-cover" src={access.url} alt={asset.prompt || `Preview of source asset ${asset.id.slice(0, 8)}`} /><span className="mt-2 block text-xs font-semibold text-violet-200">Open temporary authorized preview</span></a>
              : <p className="mt-3 rounded-lg bg-amber-500/10 p-3 text-xs leading-5 text-amber-200">{access.message}</p>}
          </article>
        })}
        {!readiness.assets.length && <p className="text-sm text-slate-500">This released version has no media source rows. The package may contain only its exact release and direction metadata.</p>}
      </div>
      {!!readiness.variants.length && <ul className="mt-4 space-y-2 text-xs text-slate-400">{readiness.variants.map(item => <li key={item.id} className="rounded-lg bg-white/[0.03] p-2"><span className="font-semibold text-slate-200">{item.variant_format}</span> · {item.status} · source {item.design_media_asset_id?.slice(0, 8) || 'unavailable'}</li>)}</ul>}
    </div>}

    <div className="mt-5 space-y-3">
      {releasePackages.map(item => {
        const evidence = productionHandoffPackageEvidence(item, readiness.assets)
        const clientRelease = clientReleases.find(row => row.handoff_package_id === item.id)
        return <article key={item.id} className="rounded-xl border border-white/10 bg-slate-950/60 p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-sm font-semibold">Package <code>{item.id}</code></p>
              <p className="mt-1 text-xs text-slate-500">{new Date(item.created_at).toLocaleString()} · {evidence.includedIds.length} packaged files · exact release {release.id.slice(0, 8)}{item.design_delivery_package_version_id ? ` · S07 version ${item.design_delivery_package_version_id.slice(0, 8)}` : ` · direction only`}</p>
            </div>
            <span className={`rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase ${statusTone(item.status)}`}>{item.status}</span>
          </div>
          {item.status === 'preparing' && <p role="status" className="mt-3 rounded-lg bg-amber-500/10 p-3 text-xs leading-5 text-amber-200">Packaging is still in progress. Refresh status to read the server result; refreshing does not create another package.</p>}
          {item.status === 'failed' && <p className="mt-3 rounded-lg bg-red-500/10 p-3 text-xs leading-5 text-red-300">{item.failure_reason || 'Packaging failed before a complete archive could be created.'}</p>}
          {!!evidence.unavailableIds.length && <p className="mt-3 text-xs text-amber-200">{evidence.unavailableIds.length} packaged source record(s) are no longer visible in this snapshot. The ready archive remains immutable and can still be requested through the existing authorized download action.</p>}
          {clientRelease && <p className="mt-3 rounded-lg bg-emerald-500/10 p-3 text-xs text-emerald-200">Released to the client portal for review · exact S07 version {clientRelease.design_package_version_id.slice(0, 8)} · {new Date(clientRelease.released_at).toLocaleString()}. The internal ZIP remains team-only.</p>}
          {!clientRelease && item.status === 'ready' && item.design_delivery_package_version_id && canReleaseClient && <button type="button" className={`${BUTTON} mt-3`} disabled={localBusy !== '' || Boolean(busy)} onClick={() => releaseToClient(item)}>{localBusy === `client-release-${item.id}` ? 'Releasing…' : 'Release to client portal'}</button>}
          {evidence.canDownload && <button type="button" className={`${SECONDARY} mt-3`} disabled={localBusy !== '' || busy === `download-${item.id}`} onClick={() => download(item)}>
            {localBusy === `download-${item.id}` || busy === `download-${item.id}` ? 'Requesting temporary link…' : 'Download signed ZIP'}
          </button>}
        </article>
      })}
      {!releasePackages.length && <div className="rounded-xl border border-dashed border-white/10 p-6 text-center text-sm text-slate-500">No handoff package has been prepared for this release.</div>}
    </div>

    <div className="mt-4 flex flex-wrap items-center gap-3">
      <button type="button" className={SECONDARY} disabled={localBusy !== '' || busy === 'load'} onClick={refreshStatus}>{localBusy === 'refresh' || busy === 'load' ? 'Refreshing handoff status…' : 'Refresh exact handoff status'}</button>
      <p className="text-xs text-slate-500">Downloads use the existing five-minute private signed-link action. Refreshing never rebuilds or republishes a package.</p>
    </div>
  </section>
}
