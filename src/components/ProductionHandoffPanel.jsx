const BUTTON = 'rounded-xl bg-violet-500 px-4 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40'

function statusTone(status) {
  if (status === 'ready') return 'bg-emerald-500/15 text-emerald-300'
  if (status === 'failed') return 'bg-red-500/15 text-red-300'
  return 'bg-amber-500/15 text-amber-300'
}

export default function ProductionHandoffPanel({
  release,
  packages,
  busy,
  onPrepare,
  onDownload,
}) {
  const releasePackages = (packages || [])
    .filter(item => item.design_direction_release_id === release.id)
    .sort((left, right) => new Date(right.created_at) - new Date(left.created_at))
  return <section className="rounded-2xl border border-violet-400/20 bg-slate-900/70 p-5">
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div>
        <p className="text-xs font-semibold uppercase tracking-wider text-violet-300">DS6 · Production handoff</p>
        <h2 className="mt-2 text-xl font-semibold">Package the released direction</h2>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-400">
          Bundle this exact release, its direction specification, ready media, and released-format
          variants. Existing files are copied as-is; nothing is edited, regenerated, or published.
        </p>
      </div>
      <button
        type="button"
        className={BUTTON}
        disabled={busy === `handoff-${release.id}`}
        onClick={() => onPrepare(release)}
      >
        {busy === `handoff-${release.id}` ? 'Preparing package…' : 'Prepare production package'}
      </button>
    </div>
    <div className="mt-5 space-y-3">
      {releasePackages.map(item => <article
        key={item.id}
        className="rounded-xl border border-white/10 bg-slate-950/60 p-4"
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-sm font-semibold">Package {item.id.slice(0, 8)}</p>
            <p className="mt-1 text-xs text-slate-500">
              {new Date(item.created_at).toLocaleString()} · {(item.included_asset_ids || []).length} files
            </p>
          </div>
          <span className={`rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase ${statusTone(item.status)}`}>
            {item.status}
          </span>
        </div>
        {item.status === 'failed' && <p className="mt-3 rounded-lg bg-red-500/10 p-3 text-xs leading-5 text-red-300">
          {item.failure_reason || 'Packaging failed before a complete archive could be created.'}
        </p>}
        {item.status === 'ready' && <button
          type="button"
          className="mt-3 rounded-xl border border-white/10 px-3 py-2 text-sm font-semibold text-slate-200 disabled:opacity-40"
          disabled={busy === `download-${item.id}`}
          onClick={() => onDownload(item.id)}
        >
          {busy === `download-${item.id}` ? 'Signing download…' : 'Download signed ZIP'}
        </button>}
      </article>)}
      {!releasePackages.length && <div className="rounded-xl border border-dashed border-white/10 p-6 text-center text-sm text-slate-500">
        No handoff package has been prepared for this release.
      </div>}
    </div>
  </section>
}
