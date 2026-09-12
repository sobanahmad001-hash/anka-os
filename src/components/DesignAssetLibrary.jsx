import { useEffect, useMemo, useReducer, useState } from 'react'
import { buildDesignAssetRows, designAssetAccessState, designAssetLibraryReducer, designAssetSourceFocus, filterDesignAssetRows, initialDesignAssetLibraryState } from '../data/designAssetLibrary.js'
import DesignAssetComparison from './DesignAssetComparison.jsx'
import DesignAssetUpload from './DesignAssetUpload.jsx'
import DesignAssetVersionBrowser from './DesignAssetVersionBrowser.jsx'

const SELECT = 'rounded-xl border border-white/10 bg-slate-950/70 px-3 py-2 text-sm text-slate-100 focus:border-violet-400 focus:outline-none'
const SECONDARY = 'rounded-xl border border-white/10 px-3 py-2 text-sm font-semibold text-slate-200 hover:border-violet-400/50 focus:outline-none focus:ring-2 focus:ring-violet-400/50'

function display(value, fallback = 'Unavailable / not recorded') {
  return value === null || value === undefined || value === '' ? fallback : String(value)
}

function label(value) {
  return display(value, 'Unknown').replaceAll('_', ' ')
}

function exactId(value) {
  return value ? <code className="break-all text-[11px] text-slate-300">{value}</code> : <span className="text-slate-500">Unavailable / not recorded</span>
}

export default function DesignAssetLibrary({ workspace, contextKey, canUpload = false, busy = false, onUpload, onClose, onFocusSource }) {
  const [state, dispatch] = useReducer(designAssetLibraryReducer, contextKey, initialDesignAssetLibraryState)
  const [clock, setClock] = useState(() => Date.now())
  const [comparisonOpen, setComparisonOpen] = useState(false)
  const [uploadOpen, setUploadOpen] = useState(false)
  const rows = useMemo(() => buildDesignAssetRows(workspace), [workspace])
  const issuedAt = Number(workspace.mediaUrlsRequestedAt)
  const effectiveNow = Math.max(clock, Date.now())
  const accessOptions = { issuedAt, expiresInSeconds: workspace.mediaUrlExpiresIn, trustedOrigin: workspace.mediaUrlOrigin, now: effectiveNow }
  const visible = useMemo(() => filterDesignAssetRows(rows, state.filters, effectiveNow), [rows, state.filters, effectiveNow])
  const selected = rows.find(row => row.id === state.selectedAssetId) || null

  useEffect(() => {
    dispatch({ type: 'context_changed', contextKey })
    setUploadOpen(false)
  }, [contextKey])

  useEffect(() => {
    setClock(Date.now())
    const seconds = Number(workspace.mediaUrlExpiresIn)
    if (!Number.isFinite(issuedAt) || !Number.isFinite(seconds) || seconds <= 5) return undefined
    const expiresAt = issuedAt + ((seconds - 5) * 1000)
    const delay = Math.max(0, expiresAt - Date.now())
    const timer = window.setTimeout(() => setClock(Date.now()), delay + 25)
    return () => window.clearTimeout(timer)
  }, [issuedAt, workspace.mediaUrlExpiresIn])

  const access = designAssetAccessState(selected, accessOptions)

  return <section aria-labelledby="design-asset-library-title" className="rounded-2xl border border-violet-400/20 bg-slate-900/80 p-4 shadow-xl shadow-black/10 sm:p-5">
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div><p className="text-xs font-semibold uppercase tracking-wider text-violet-300">Design S05 · Versioned assets</p><h2 id="design-asset-library-title" className="mt-2 text-2xl font-semibold">Browse assets</h2><p className="mt-2 max-w-3xl text-sm leading-6 text-slate-400">Browse exact versions in the current authorized Design context. Uploading creates an unapproved immutable draft; it never edits, approves, releases, archives, or regenerates an existing object.</p></div>
      <button type="button" onClick={onClose} className={SECONDARY}>Close asset library</button>
    </div>

    <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-[1fr_1fr_1fr_auto]">
      <label className="grid gap-1 text-xs font-semibold uppercase tracking-wider text-slate-500">Status<select value={state.filters.status} onChange={event => dispatch({ type: 'set_filter', name: 'status', value: event.target.value })} className={SELECT}><option value="all">All statuses</option><option value="ready">Ready</option><option value="failed">Failed</option><option value="pending">Pending</option><option value="generating">Generating</option><option value="unavailable">Unavailable</option></select></label>
      <label className="grid gap-1 text-xs font-semibold uppercase tracking-wider text-slate-500">Source<select value={state.filters.source} onChange={event => dispatch({ type: 'set_filter', name: 'source', value: event.target.value })} className={SELECT}><option value="all">All sources</option><option value="upload">Uploaded file</option><option value="generated">Durable generated output</option><option value="variant">Recorded variant</option><option value="recorded">Other recorded output</option></select></label>
      <label className="grid gap-1 text-xs font-semibold uppercase tracking-wider text-slate-500">Created<select value={state.filters.date} onChange={event => dispatch({ type: 'set_filter', name: 'date', value: event.target.value })} className={SELECT}><option value="all">Any date</option><option value="day">Last 24 hours</option><option value="week">Last 7 days</option><option value="month">Last 30 days</option></select></label>
      <div className="flex items-end gap-2"><button type="button" aria-pressed={state.view === 'grid'} onClick={() => dispatch({ type: 'set_view', view: 'grid' })} className={SECONDARY + (state.view === 'grid' ? ' bg-white text-slate-950' : '')}>Grid</button><button type="button" aria-pressed={state.view === 'list'} onClick={() => dispatch({ type: 'set_view', view: 'list' })} className={SECONDARY + (state.view === 'list' ? ' bg-white text-slate-950' : '')}>List</button></div>
    </div>

    <div aria-live="polite" className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-400"><span>{visible.length} of {rows.length} authorized asset{rows.length === 1 ? '' : 's'}</span><span className="flex items-center gap-3">{visible.length !== rows.length && <button type="button" onClick={() => dispatch({ type: 'reset_filters' })} className="font-semibold text-violet-300">Clear filters</button>}<button type="button" disabled={!canUpload} aria-expanded={uploadOpen} onClick={() => setUploadOpen(value => !value)} className="font-semibold text-cyan-300 focus:outline-none focus:ring-2 focus:ring-cyan-300/50 disabled:text-slate-600">{uploadOpen ? 'Hide upload' : 'Upload asset'}</button><button type="button" aria-expanded={comparisonOpen} onClick={() => setComparisonOpen(value => !value)} className="font-semibold text-cyan-300 focus:outline-none focus:ring-2 focus:ring-cyan-300/50">{comparisonOpen ? 'Hide output comparison' : 'Compare two outputs'}</button></span></div>

    {uploadOpen && <DesignAssetUpload workspace={workspace} contextKey={contextKey} canUpload={canUpload} busy={busy} onUpload={onUpload} onClose={() => setUploadOpen(false)} />}
    {comparisonOpen && <DesignAssetComparison rows={rows} contextKey={contextKey} accessOptions={accessOptions} onClose={() => setComparisonOpen(false)} onFocusSource={onFocusSource} />}

    {!rows.length ? <EmptyState title="No assets yet" text={canUpload ? 'Upload an authorized PNG draft or create an output from a Design direction.' : 'No authorized generated or uploaded assets are available.'} />
      : !visible.length ? <EmptyState title="No assets match these filters" text="Clear or change the filters; the underlying authorized results are unchanged." />
        : <div className={'mt-5 ' + (state.view === 'grid' ? 'grid gap-4 sm:grid-cols-2 xl:grid-cols-3' : 'space-y-3')}>{visible.map(row => <button type="button" key={row.id} onClick={() => dispatch({ type: 'select', assetId: row.id })} className={'w-full rounded-2xl border p-3 text-left focus:outline-none focus:ring-2 focus:ring-violet-400/60 ' + (state.selectedAssetId === row.id ? 'border-violet-400 bg-violet-500/10 ' : 'border-white/10 bg-slate-950/50 hover:border-violet-400/40 ') + (state.view === 'list' ? 'grid gap-3 sm:grid-cols-[7rem_1fr_auto] sm:items-center' : '')}>
          <div className={(state.view === 'list' ? 'h-20' : 'aspect-video') + ' overflow-hidden rounded-xl bg-black/30'}>{designAssetAccessState(row, accessOptions).canOpen ? <img src={row.previewUrl} alt="" className="h-full w-full object-cover" /> : <div className="flex h-full items-center justify-center px-3 text-center text-xs text-slate-500">Preview {row.status === 'ready' ? 'link unavailable' : row.status}</div>}</div>
          <div className="min-w-0"><p className="truncate font-semibold text-slate-100">{row.directionTitle || 'Untitled generated output'}</p><p className="mt-1 text-xs capitalize text-slate-400">{label(row.sourceType)} · {label(row.status)}</p><p className="mt-2 truncate text-[11px] text-slate-500">Asset {row.id}</p></div>
          <span className="text-xs font-semibold text-violet-300">View detail</span>
        </button>)}</div>}

    {selected && <aside aria-labelledby="design-asset-detail-title" className="mt-6 rounded-2xl border border-white/10 bg-slate-950/70 p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs font-semibold uppercase tracking-wider text-violet-300">Selected asset</p><h3 id="design-asset-detail-title" className="mt-1 text-xl font-semibold">{selected.directionTitle || 'Untitled generated output'}</h3></div><button type="button" onClick={() => dispatch({ type: 'close_detail' })} className={SECONDARY}>Close detail</button></div>
      <div className="mt-5 grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(18rem,1fr)]">
        <div className="overflow-hidden rounded-xl border border-white/10 bg-black/30">{access.canOpen ? <img src={access.url} alt={selected.prompt || 'Selected Design output'} className="h-full max-h-[32rem] w-full object-contain" /> : <div className="flex min-h-56 items-center justify-center p-6 text-center text-sm text-slate-400">{access.message}</div>}</div>
        <dl className="grid content-start gap-3 text-sm sm:grid-cols-2">
          <Metadata term="Asset ID">{exactId(selected.id)}</Metadata><Metadata term="Status">{label(selected.status)}</Metadata>
          <Metadata term="Source">{selected.sourceType === 'upload' ? 'Uploaded file' : selected.sourceType === 'variant' ? 'Recorded variant · ' + label(selected.recordedVariantFormat) : selected.sourceType === 'generated' ? 'Durable generated output' : 'Other recorded output'}</Metadata><Metadata term="Created">{selected.createdAt ? new Date(selected.createdAt).toLocaleString() : 'Unavailable / not recorded'}</Metadata>
          <Metadata term="Generation job">{exactId(selected.jobId)}</Metadata><Metadata term="Job status">{selected.jobStatus ? label(selected.jobStatus) : 'Unavailable / not recorded'}</Metadata>
          <Metadata term="Model">{selected.modelName ? selected.modelName + ' · ' + selected.modelId : display(selected.modelId)}</Metadata><Metadata term="Immutable direction version">{selected.directionVersionNumber ? 'v' + selected.directionVersionNumber + ' · ' + selected.directionVersionId : display(selected.directionVersionId)}</Metadata>
          <Metadata term="Dimensions">{display(selected.recorded.dimensions)}</Metadata><Metadata term="MIME / file format">{display(selected.recorded.mimeType)}</Metadata>
          <Metadata term="Asset name">{display(selected.recorded.name)}</Metadata><Metadata term="Review state">{display(selected.recorded.reviewState)}</Metadata>
          <Metadata term="Independent asset version">{display(selected.recorded.independentVersion)}</Metadata><Metadata term="Visibility">Already authorized in this Design context</Metadata>
        </dl>
      </div>
      {selected.prompt && <div className="mt-4 rounded-xl bg-white/[0.03] p-3"><p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Recorded prompt</p><p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-300">{selected.prompt}</p></div>}
      <div className="mt-4 flex flex-wrap items-center gap-3">
        {access.canOpen ? <a href={access.url} target="_blank" rel="noreferrer" className="rounded-xl bg-violet-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-violet-500 focus:outline-none focus:ring-2 focus:ring-violet-300">Open or save signed image</a> : <span className="rounded-xl border border-white/10 px-4 py-2.5 text-sm font-semibold text-slate-500">Image link unavailable</span>}
        <button type="button" disabled={!designAssetSourceFocus(selected)} onClick={() => onFocusSource(selected)} className={SECONDARY + ' disabled:cursor-not-allowed disabled:opacity-40'}>Open source in Design desk</button>
      </div>
      <p className={'mt-3 text-xs leading-5 ' + (access.canOpen ? 'text-slate-400' : 'text-amber-300')}>{access.message}</p>
      {!!selected.assetVersions?.length && <DesignAssetVersionBrowser row={selected} contextKey={contextKey} accessOptions={accessOptions} />}
    </aside>}
  </section>
}

function EmptyState({ title, text }) {
  return <div className="mt-6 rounded-xl border border-dashed border-white/10 p-8 text-center"><p className="font-semibold text-slate-200">{title}</p><p className="mt-2 text-sm text-slate-500">{text}</p></div>
}

function Metadata({ term, children }) {
  return <div className="min-w-0 rounded-xl bg-white/[0.03] p-3"><dt className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">{term}</dt><dd className="mt-1 break-words text-slate-200">{children}</dd></div>
}
