import { useEffect, useReducer } from 'react'
import { designAssetAccessState, designAssetSourceFocus } from '../data/designAssetLibrary.js'
import { designAssetComparisonModel, designAssetComparisonReducer, initialDesignAssetComparisonState } from '../data/designAssetComparison.js'

const CONTROL = 'rounded-xl border border-white/10 bg-slate-950/70 px-3 py-2 text-sm text-slate-100 focus:border-violet-400 focus:outline-none focus:ring-2 focus:ring-violet-400/40'
const SECONDARY = 'rounded-xl border border-white/10 px-3 py-2 text-sm font-semibold text-slate-200 hover:border-violet-400/50 focus:outline-none focus:ring-2 focus:ring-violet-400/50 disabled:cursor-not-allowed disabled:opacity-40'

const display = value => value === null || value === undefined || value === '' ? 'Unavailable / not recorded' : String(value)
const outputLabel = row => `${row.directionTitle || 'Untitled output'} · ${row.id}`

export default function DesignAssetComparison({ rows, contextKey, accessOptions, onClose, onFocusSource }) {
  const [state, dispatch] = useReducer(designAssetComparisonReducer, contextKey, initialDesignAssetComparisonState)
  const comparison = designAssetComparisonModel(rows, state)

  useEffect(() => {
    dispatch({ type: 'context_changed', contextKey })
  }, [contextKey])

  return <section aria-labelledby="design-output-comparison-title" className="mt-5 rounded-2xl border border-cyan-400/20 bg-cyan-500/[0.04] p-4 sm:p-5">
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div><p className="text-xs font-semibold uppercase tracking-wider text-cyan-300">Read-only output comparison</p><h3 id="design-output-comparison-title" className="mt-1 text-xl font-semibold">Compare two outputs</h3><p className="mt-2 max-w-3xl text-sm leading-6 text-slate-400">Choose two distinct outputs already loaded in this authorized context. Recorded direction sources may differ; this does not establish asset version lineage or claim that either output revises the other.</p></div>
      <button type="button" onClick={onClose} className={SECONDARY}>Close comparison</button>
    </div>

    <div className="mt-5 grid gap-4 lg:grid-cols-2">
      <OutputSelector side="left" label="Output A" value={state.leftAssetId} otherValue={state.rightAssetId} rows={rows} dispatch={dispatch} />
      <OutputSelector side="right" label="Output B" value={state.rightAssetId} otherValue={state.leftAssetId} rows={rows} dispatch={dispatch} />
    </div>
    {(state.leftAssetId || state.rightAssetId) && <button type="button" onClick={() => dispatch({ type: 'clear_all' })} className="mt-3 text-sm font-semibold text-cyan-300 focus:outline-none focus:ring-2 focus:ring-cyan-300/50">Clear both outputs</button>}

    {rows.length < 2 ? <ComparisonEmpty title="Two outputs are required" text="This authorized context does not currently contain two recorded outputs to compare." />
      : !comparison.ready ? <ComparisonEmpty title="Choose output A and output B" text="Selections must be two distinct outputs. No comparison or lineage is inferred before both are chosen." />
        : <>
          <div className="mt-5 grid gap-4 lg:grid-cols-2">
            <OutputPane label="Output A" row={comparison.left} accessOptions={accessOptions} onFocusSource={onFocusSource} />
            <OutputPane label="Output B" row={comparison.right} accessOptions={accessOptions} onFocusSource={onFocusSource} />
          </div>
          <div className="mt-5 overflow-x-auto rounded-xl border border-white/10" tabIndex={0} aria-label="Scrollable recorded output comparison facts">
            <div className="grid min-w-[42rem] grid-cols-[minmax(8rem,0.8fr)_minmax(0,1fr)_minmax(0,1fr)] gap-px bg-white/10 text-xs font-semibold uppercase tracking-wider text-slate-500"><span className="bg-slate-950 p-3">Recorded fact</span><span className="bg-slate-950 p-3">Output A</span><span className="bg-slate-950 p-3">Output B</span></div>
            {comparison.facts.map(fact => <div key={fact.key} className="grid min-w-[42rem] grid-cols-[minmax(8rem,0.8fr)_minmax(0,1fr)_minmax(0,1fr)] gap-px border-t border-white/10 bg-white/10 text-sm"><div className="bg-slate-950 p-3"><span className="font-semibold text-slate-300">{fact.label}</span><span className={'ml-2 text-[10px] uppercase tracking-wider ' + (fact.relationship === 'different' ? 'text-cyan-300' : fact.relationship === 'same' ? 'text-emerald-300' : 'text-amber-300')}>{fact.relationship}</span></div><div className="min-w-0 break-words bg-slate-950 p-3 text-slate-300">{display(fact.leftValue)}</div><div className="min-w-0 break-words bg-slate-950 p-3 text-slate-300">{display(fact.rightValue)}</div></div>)}
          </div>
        </>}
  </section>
}

function OutputSelector({ side, label, value, otherValue, rows, dispatch }) {
  const id = `design-output-comparison-${side}`
  return <div className="grid gap-2"><label htmlFor={id} className="text-xs font-semibold uppercase tracking-wider text-slate-500">{label}</label><span className="flex gap-2"><select id={id} aria-label={label} value={value} onChange={event => dispatch({ type: 'select_slot', slot: side, assetId: event.target.value })} className={CONTROL + ' min-w-0 flex-1'}><option value="">Choose an output</option>{rows.filter(row => row.id !== otherValue).map(row => <option key={row.id} value={row.id}>{outputLabel(row)}</option>)}</select><button type="button" disabled={!value} onClick={() => dispatch({ type: 'clear_slot', slot: side })} className={SECONDARY}>Clear</button></span></div>
}

function OutputPane({ label, row, accessOptions, onFocusSource }) {
  const access = designAssetAccessState(row, accessOptions)
  const source = designAssetSourceFocus(row)
  return <article aria-label={label} className="min-w-0 rounded-xl border border-white/10 bg-slate-950/70 p-3">
    <div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="text-xs font-semibold uppercase tracking-wider text-cyan-300">{label}</p><h4 className="mt-1 truncate font-semibold">{row.directionTitle || 'Untitled output'}</h4></div><span className="rounded-full bg-white/5 px-2 py-1 text-[10px] uppercase text-slate-400">{row.status}</span></div>
    <div className="mt-3 overflow-hidden rounded-lg bg-black/30">{access.canOpen ? <img src={access.url} alt={row.prompt || `${label} Design output`} className="aspect-video h-full w-full object-contain" /> : <div className="flex aspect-video items-center justify-center p-4 text-center text-xs text-slate-400">{access.message}</div>}</div>
    <dl className="mt-3 grid gap-2 text-xs sm:grid-cols-2"><Fact term="Asset">{row.id}</Fact><Fact term="Job">{display(row.jobId)}</Fact><Fact term="Model">{row.modelName ? `${row.modelName} · ${row.modelId}` : display(row.modelId)}</Fact><Fact term="Provider">{display(row.provider)}</Fact><Fact term="Generated by">{display(row.generatedBy)}</Fact><Fact term="Recorded direction source">{row.directionVersionId ? `${row.directionVersionNumber ? `v${row.directionVersionNumber} · ` : ''}${row.directionVersionId}` : display(null)}</Fact></dl>
    <div className="mt-3 flex flex-wrap gap-2">{access.canOpen ? <a href={access.url} target="_blank" rel="noreferrer" className="rounded-lg bg-cyan-600 px-3 py-2 text-xs font-semibold text-white focus:outline-none focus:ring-2 focus:ring-cyan-300">Open or save signed image</a> : <span className="rounded-lg border border-white/10 px-3 py-2 text-xs font-semibold text-slate-500">Image link unavailable</span>}<button type="button" disabled={!source} onClick={() => onFocusSource(row)} className={SECONDARY}>Open recorded source</button></div>
  </article>
}

function Fact({ term, children }) {
  return <div className="min-w-0 rounded-lg bg-white/[0.03] p-2"><dt className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">{term}</dt><dd className="mt-1 break-words text-slate-300">{children}</dd></div>
}

function ComparisonEmpty({ title, text }) {
  return <div className="mt-5 rounded-xl border border-dashed border-white/10 p-6 text-center"><p className="font-semibold text-slate-200">{title}</p><p className="mt-2 text-sm text-slate-500">{text}</p></div>
}
