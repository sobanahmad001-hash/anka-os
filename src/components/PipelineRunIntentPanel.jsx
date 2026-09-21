import { useEffect, useRef, useState } from 'react'
import { pipelineRunIntents } from '../data/pipelineRunIntents.js'

export default function PipelineRunIntentPanel({ organizationId, engagement, assets, membership, signal }) {
  const [rows, setRows] = useState([])
  const [assetIds, setAssetIds] = useState([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const requestId = useRef('')
  const allowed = ['system_owner', 'operations_admin'].includes(membership?.role)

  async function refresh() {
    try {
      const result = await pipelineRunIntents.list(organizationId, engagement.id, { signal })
      if (!signal?.aborted) setRows(result || [])
      if (!signal?.aborted) setError('')
    } catch (failure) {
      if (!signal?.aborted) setError(failure.message)
    } finally {
      if (!signal?.aborted) setLoading(false)
    }
  }

  useEffect(() => {
    refresh()
    // The parent remounts this workspace when organization scope changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [organizationId, engagement.id, signal])

  function toggleAsset(id) {
    requestId.current = ''
    setAssetIds(current => current.includes(id) ? current.filter(value => value !== id) : [...current, id])
  }

  async function start() {
    setBusy(true)
    setError('')
    setNotice('')
    try {
      if (!requestId.current) requestId.current = crypto.randomUUID()
      const result = await pipelineRunIntents.start({
        organizationId, engagementId: engagement.id, requestId: requestId.current, assetIds,
      }, { signal })
      setNotice(`Run request ${result.idempotent_replay ? 'recovered' : 'recorded'} for review. No provider job or spend started.`)
      requestId.current = ''
      await refresh()
    } catch (failure) {
      if (!signal?.aborted) setError(failure.message)
    } finally {
      if (!signal?.aborted) setBusy(false)
    }
  }

  return <section className="rounded-2xl border border-white/[0.07] bg-[#0e111a]/80 p-5">
    <h2 className="font-semibold">Manual pipeline runs</h2>
    <p className="mt-1 text-xs text-slate-500">Pin a published preset and selected engagement assets for review. Execution, approvals, and provider spend are not active yet.</p>
    {allowed && <div className="mt-4">
      <p className="text-xs font-medium text-slate-300">Pin assets (up to 20)</p>
      <div className="mt-2 space-y-2">{assets.map(asset => <label key={asset.id} className="flex gap-2 text-xs text-slate-400">
        <input type="checkbox" checked={assetIds.includes(asset.id)} onChange={() => toggleAsset(asset.id)} />
        <span>{asset.name} · {asset.asset_kind}</span>
      </label>)}</div>
      <button type="button" disabled={busy || !['planning', 'active'].includes(engagement.status) || assetIds.length > 20}
        onClick={start} className="mt-4 rounded-lg bg-violet-500 px-3 py-2 text-xs font-semibold text-white disabled:opacity-40">
        {busy ? 'Recording…' : 'Request manual run review'}
      </button>
    </div>}
    {notice && <p role="status" className="mt-3 text-xs text-emerald-300">{notice}</p>}
    {error && <p role="alert" className="mt-3 text-xs text-red-300">{error}</p>}
    <div className="mt-5 space-y-2">
      {loading && <p className="text-xs text-slate-500">Loading run requests…</p>}
      {!loading && rows.length === 0 && <p className="text-xs text-slate-500">No manual run requests yet.</p>}
      {rows.map(row => <div key={row.id} className="rounded-lg border border-white/[0.06] p-3 text-xs text-slate-400">
        <span className="font-medium text-slate-200">{row.status.replaceAll('_', ' ')}</span>
        <span className="ml-2">{new Date(row.requested_at).toLocaleString()}</span>
        <p className="mt-1">Pinned preset {row.input_manifest?.pipeline?.version_id?.slice(0, 8)} · {row.input_manifest?.assets?.length || 0} assets · hash {row.input_sha256.slice(0, 12)}</p>
      </div>)}
    </div>
  </section>
}
