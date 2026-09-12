import { useEffect, useMemo, useState } from 'react'
import { designAssetAccessState } from '../data/designAssetLibrary.js'

const SELECT = 'rounded-xl border border-white/10 bg-slate-950/70 px-3 py-2 text-sm text-slate-100 focus:border-violet-400 focus:outline-none'
const display = value => value === null || value === undefined || value === '' ? 'Unavailable / not recorded' : String(value)

function versionAccess(row, version, accessOptions) {
  return designAssetAccessState({ ...row, previewUrl: version?.signed_url || '', status: version ? 'ready' : 'unavailable' }, accessOptions)
}

function VersionCard({ row, version, accessOptions, label }) {
  const access = versionAccess(row, version, accessOptions)
  return <article className="min-w-0 rounded-xl border border-white/10 bg-slate-950/60 p-3">
    <p className="text-xs font-semibold uppercase tracking-wider text-cyan-300">{label}</p>
    <h5 className="mt-1 font-semibold">Version {version.version_number}</h5>
    <div className="mt-3 flex min-h-40 items-center justify-center overflow-hidden rounded-lg bg-black/30">{access.canOpen ? <img src={access.url} alt={`${row.recorded.name || 'Design asset'} version ${version.version_number}`} className="max-h-72 w-full object-contain" /> : <p className="p-4 text-center text-xs text-amber-200">{access.message}</p>}</div>
    <dl className="mt-3 grid gap-2 text-xs">
      <Fact term="Exact version">{`v${version.version_number} · ${version.id}`}</Fact>
      <Fact term="Parent version">{display(version.parent_version_id)}</Fact>
      <Fact term="State">{display(version.lifecycle_status)}</Fact>
      <Fact term="Source">{display(version.source_kind).replaceAll('_', ' ')}</Fact>
      <Fact term="Dimensions">{version.width && version.height ? `${version.width}×${version.height}` : 'Unavailable / not recorded'}</Fact>
      <Fact term="MIME">{display(version.mime_type)}</Fact>
      <Fact term="Filename">{display(version.original_filename)}</Fact>
      <Fact term="Created">{version.created_at ? new Date(version.created_at).toLocaleString() : 'Unavailable / not recorded'}</Fact>
      <Fact term="Change summary">{display(version.change_summary)}</Fact>
    </dl>
    {access.canOpen ? <a href={access.url} target="_blank" rel="noreferrer" className="mt-3 inline-flex rounded-lg bg-cyan-700 px-3 py-2 text-xs font-semibold text-white focus:outline-none focus:ring-2 focus:ring-cyan-300">Open or download exact v{version.version_number}</a> : null}
  </article>
}

function Fact({ term, children }) {
  return <div className="grid grid-cols-[7rem_minmax(0,1fr)] gap-2"><dt className="text-slate-500">{term}</dt><dd className="break-words text-slate-200">{children}</dd></div>
}

export default function DesignAssetVersionBrowser({ row, contextKey, accessOptions }) {
  const versions = useMemo(() => [...(row.assetVersions || [])].sort((left, right) => right.version_number - left.version_number), [row.assetVersions])
  const [leftId, setLeftId] = useState(versions[0]?.id || '')
  const [rightId, setRightId] = useState(versions[1]?.id || '')
  useEffect(() => {
    setLeftId(versions[0]?.id || '')
    setRightId(versions[1]?.id || '')
  }, [contextKey, row.assetId]) // eslint-disable-line react-hooks/exhaustive-deps
  const left = versions.find(version => version.id === leftId) || null
  const right = versions.find(version => version.id === rightId) || null
  return <section aria-labelledby="asset-version-history-title" className="mt-5 rounded-xl border border-cyan-400/20 bg-cyan-500/[0.03] p-4">
    <p className="text-xs font-semibold uppercase tracking-wider text-cyan-300">Immutable file history</p>
    <h4 id="asset-version-history-title" className="mt-1 text-lg font-semibold">Asset versions</h4>
    <p className="mt-1 text-xs leading-5 text-slate-400">These versions belong to this one asset identity. Earlier objects remain unchanged; a replacement is always a new draft child version.</p>
    <ol className="mt-3 flex flex-wrap gap-2 text-xs">{versions.map(version => <li key={version.id} className="rounded-lg border border-white/10 px-2.5 py-1.5">v{version.version_number} · {display(version.lifecycle_status)} · {display(version.source_kind).replaceAll('_', ' ')}</li>)}</ol>
    {versions.length < 2 ? <p className="mt-4 rounded-lg border border-dashed border-white/10 p-4 text-sm text-slate-500">Upload a replacement to create a second immutable draft version for comparison.</p> : <>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <label className="grid gap-1 text-xs font-semibold uppercase tracking-wider text-slate-500">Version A<select aria-label="Asset version A" value={leftId} onChange={event => { setLeftId(event.target.value); if (event.target.value === rightId) setRightId('') }} className={SELECT}>{versions.map(version => <option key={version.id} value={version.id}>v{version.version_number}</option>)}</select></label>
        <label className="grid gap-1 text-xs font-semibold uppercase tracking-wider text-slate-500">Version B<select aria-label="Asset version B" value={rightId} onChange={event => { setRightId(event.target.value); if (event.target.value === leftId) setLeftId('') }} className={SELECT}><option value="">Choose version</option>{versions.map(version => <option key={version.id} value={version.id}>v{version.version_number}</option>)}</select></label>
      </div>
      {left && right && left.id !== right.id
        ? <div className="mt-4 grid gap-4 lg:grid-cols-2"><VersionCard row={row} version={left} accessOptions={accessOptions} label="Version A" /><VersionCard row={row} version={right} accessOptions={accessOptions} label="Version B" /></div>
        : <p className="mt-4 text-sm text-amber-200">Choose two distinct versions of this asset.</p>}
    </>}
  </section>
}
