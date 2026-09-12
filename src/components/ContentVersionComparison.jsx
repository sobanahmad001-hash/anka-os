import { useEffect, useReducer, useState } from 'react'

import {
  contentVersionComparisonModel,
  contentVersionComparisonReducer,
  initialContentVersionComparisonState,
} from '../data/contentVersionComparison.js'

const CONTROL = 'w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm text-white outline-none focus:border-amber-500 focus:ring-2 focus:ring-amber-500/30'
const SECONDARY = 'rounded-xl border border-slate-700 px-3 py-2 text-xs font-semibold text-slate-200 hover:border-amber-500 focus:outline-none focus:ring-2 focus:ring-amber-500/40 disabled:cursor-not-allowed disabled:opacity-40'
const STATUS = {
  same: 'text-slate-500',
  changed: 'text-amber-300',
  added: 'text-emerald-300',
  removed: 'text-rose-300',
}

function versionLabel(version) {
  const instant = version.created_at ? new Date(version.created_at).toLocaleString() : 'timestamp unavailable'
  return `Version ${version.version_number} - ${instant} - ${version.id}`
}

function pathLabel(path) {
  return String(path).replaceAll('_', ' ').replaceAll('.', ' / ')
}

export default function ContentVersionComparison({ versions, contextKey, preferredVersionId, stale = false, onClose }) {
  const [state, dispatch] = useReducer(
    contentVersionComparisonReducer,
    null,
    () => initialContentVersionComparisonState(contextKey, versions, preferredVersionId),
  )
  const [showUnchanged, setShowUnchanged] = useState(false)
  const versionIdentity = versions.map(version => `${version.id}:${version.content_checksum || ''}`).join('|')
  const displayState = state.contextKey === contextKey ? state : initialContentVersionComparisonState(contextKey, versions, preferredVersionId)
  const comparison = contentVersionComparisonModel(versions, displayState)
  const contentRows = comparison.content.filter(row => showUnchanged || row.relationship !== 'same')

  useEffect(() => {
    dispatch({ type: 'sync_context', contextKey, versions, preferredVersionId })
    setShowUnchanged(false)
  }, [contextKey, preferredVersionId, versionIdentity, versions])

  return <section aria-labelledby="content-version-comparison-title" className="mt-5 rounded-2xl border border-amber-500/25 bg-amber-950/10 p-4 sm:p-5">
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div><p className="text-xs font-semibold uppercase tracking-[0.14em] text-amber-300">Read-only exact-version comparison</p><h3 id="content-version-comparison-title" className="mt-1 text-xl font-semibold text-white">Compare saved versions</h3><p className="mt-2 max-w-3xl text-sm leading-6 text-slate-400">Choose two distinct immutable versions of this artifact. The comparison uses only snapshots already loaded in the current authorized organization and never changes content, review, or approval state.</p></div>
      <button type="button" onClick={onClose} className={SECONDARY}>Close comparison</button>
    </div>
    {stale && <p className="mt-4 rounded-xl border border-amber-900/60 bg-amber-950/30 p-3 text-xs leading-5 text-amber-200">This comparison uses the last successfully authorized library snapshot. Refresh must succeed before relying on it as current.</p>}

    <div className="mt-5 grid gap-4 lg:grid-cols-2">
      <VersionSelector side="left" label="Version A" value={displayState.leftVersionId} otherValue={displayState.rightVersionId} versions={versions} dispatch={dispatch} />
      <VersionSelector side="right" label="Version B" value={displayState.rightVersionId} otherValue={displayState.leftVersionId} versions={versions} dispatch={dispatch} />
    </div>
    {(displayState.leftVersionId || displayState.rightVersionId) && <button type="button" onClick={() => dispatch({ type: 'clear_all' })} className="mt-3 text-xs font-semibold text-amber-300 focus:outline-none focus:ring-2 focus:ring-amber-400/50">Clear both versions</button>}

    {versions.length < 2 ? <Empty title="Two versions are required" text="This artifact does not yet have two authorized saved versions to compare." />
      : !comparison.ready ? <Empty title="Choose version A and version B" text="Selections must be two distinct versions of the same artifact." />
        : <>
          <div className="mt-5 grid gap-3 sm:grid-cols-4">
            {['changed', 'added', 'removed', 'same'].map(status => <div key={status} className="rounded-xl bg-slate-950/60 p-3"><p className={`text-lg font-semibold ${STATUS[status]}`}>{comparison.summary[status]}</p><p className="mt-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-600">{status} fields</p></div>)}
          </div>

          <ComparisonTable label="Version metadata comparison" rows={comparison.metadata} rowKey="key" rowLabel="label" />
          <div className="mt-5 flex flex-wrap items-center justify-between gap-3"><h4 className="font-semibold text-white">Saved content fields</h4><label className="flex items-center gap-2 text-xs text-slate-400"><input type="checkbox" checked={showUnchanged} onChange={event => setShowUnchanged(event.target.checked)} />Show unchanged fields</label></div>
          {contentRows.length ? <ComparisonTable label="Saved content field comparison" rows={contentRows} rowKey="path" rowLabel="path" />
            : <p className="mt-3 rounded-xl border border-dashed border-slate-700 p-5 text-center text-sm text-slate-500">No recorded content fields differ between these exact versions.</p>}
        </>}
  </section>
}

function VersionSelector({ side, label, value, otherValue, versions, dispatch }) {
  const id = `content-version-comparison-${side}`
  return <div>
    <label htmlFor={id} className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">{label}</label>
    <div className="mt-2 flex gap-2"><select id={id} aria-label={label} value={value} onChange={event => dispatch({ type: 'select_slot', slot: side, versionId: event.target.value })} className={CONTROL}><option value="">Choose an exact version</option>{versions.filter(version => version.id !== otherValue).map(version => <option key={version.id} value={version.id}>{versionLabel(version)}</option>)}</select><button type="button" disabled={!value} onClick={() => dispatch({ type: 'clear_slot', slot: side })} className={SECONDARY}>Clear</button></div>
  </div>
}

function ComparisonTable({ label, rows, rowKey, rowLabel }) {
  return <div className="mt-3 overflow-x-auto rounded-xl border border-slate-800" tabIndex={0} aria-label={label}>
    <div className="grid min-w-[48rem] grid-cols-[minmax(10rem,0.8fr)_minmax(0,1fr)_minmax(0,1fr)] gap-px bg-slate-800 text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500"><span className="bg-slate-950 p-3">Recorded field</span><span className="bg-slate-950 p-3">Version A</span><span className="bg-slate-950 p-3">Version B</span></div>
    {rows.map(row => <div key={row[rowKey]} className="grid min-w-[48rem] grid-cols-[minmax(10rem,0.8fr)_minmax(0,1fr)_minmax(0,1fr)] gap-px border-t border-slate-800 bg-slate-800 text-sm"><div className="bg-slate-950 p-3"><span className="font-semibold text-slate-300">{pathLabel(row[rowLabel])}</span><span className={`ml-2 text-[10px] font-semibold uppercase tracking-[0.1em] ${STATUS[row.relationship] || STATUS.same}`}>{row.relationship}</span></div><pre className="min-w-0 whitespace-pre-wrap break-words bg-slate-950 p-3 font-sans text-xs leading-5 text-slate-300">{row.leftValue}</pre><pre className="min-w-0 whitespace-pre-wrap break-words bg-slate-950 p-3 font-sans text-xs leading-5 text-slate-300">{row.rightValue}</pre></div>)}
  </div>
}

function Empty({ title, text }) {
  return <div className="mt-5 rounded-xl border border-dashed border-slate-700 p-6 text-center"><p className="font-semibold text-slate-200">{title}</p><p className="mt-2 text-sm text-slate-500">{text}</p></div>
}
