import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { shouldApplyConnectionReadinessResponse } from '../data/marketingConnectionReadiness.js'
import { loadMarketingConnectionReadiness } from '../data/marketingConnectionReadinessRepository.js'

const STATE_LABELS = Object.freeze({
  not_configured: 'Not configured',
  authorization_required: 'Authorization required',
  connected_no_data: 'Connected with no data',
  healthy: 'Healthy',
  stale: 'Stale',
  rate_limited: 'Rate limited',
  failed: 'Failed',
  status_unavailable: 'Status unavailable',
})

const CAPABILITY_LABELS = Object.freeze({
  live_reporting_read: 'Live reporting read',
  stored_snapshot_read: 'Stored snapshot read',
  organic_insights: 'Organic insights',
  setup_only: 'Setup only',
})

function stateClass(state) {
  if (state === 'healthy') return 'bg-emerald-950 text-emerald-300'
  if (['stale', 'authorization_required', 'connected_no_data'].includes(state)) return 'bg-amber-950 text-amber-200'
  if (['failed', 'rate_limited'].includes(state)) return 'bg-red-950 text-red-300'
  return 'bg-slate-800 text-slate-400'
}

function timestamp(value) {
  if (!value) return 'Not recorded'
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? 'Unavailable' : parsed.toISOString().replace('.000Z', 'Z')
}

export default function MarketingConnectionReadinessPanel({
  organizationId,
  scopeRevision,
  signal,
  onAccessError,
  brand,
  canManage,
}) {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const generation = useRef(0)
  const current = useRef({ organizationId, brandId: brand.id, revision: scopeRevision })
  current.current = { organizationId, brandId: brand.id, revision: scopeRevision }

  useEffect(() => {
    const requestGeneration = ++generation.current
    const request = { organizationId, brandId: brand.id, revision: scopeRevision, signal }
    const selectedBrand = { id: brand.id, name: brand.name, organization_id: brand.organization_id }
    setRows([]); setLoading(true); setError('')
    loadMarketingConnectionReadiness({ organizationId, brand: selectedBrand, signal }).then(result => {
      if (shouldApplyConnectionReadinessResponse(request, current.current, requestGeneration, generation.current)) setRows(result)
    }).catch(loadError => {
      if (!shouldApplyConnectionReadinessResponse(request, current.current, requestGeneration, generation.current) || loadError?.name === 'AbortError') return
      onAccessError(loadError, { membershipMismatch: loadError?.membershipMismatch === true })
      setError(loadError.message)
    }).finally(() => {
      if (shouldApplyConnectionReadinessResponse(request, current.current, requestGeneration, generation.current)) setLoading(false)
    })
    return () => { generation.current += 1 }
  }, [brand.id, brand.name, brand.organization_id, onAccessError, organizationId, scopeRevision, signal])

  if (loading) return <div className="py-20 text-center text-sm text-slate-500">Loading connection readiness…</div>
  if (error) return <div className="rounded-xl border border-red-900/60 bg-red-950/50 px-4 py-3 text-sm text-red-300">{error}</div>

  return <section className="space-y-5">
    <div className="flex flex-wrap items-start justify-between gap-4 rounded-2xl border border-indigo-900/60 bg-indigo-950/30 p-5">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-indigo-300">Read-only readiness</p>
        <h2 className="mt-1 text-xl font-semibold">{brand.name} connections</h2>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-400">This view reports safe stored connection and account evidence only. It does not retry reads, contact providers, start authorization, or change mappings.</p>
      </div>
      {canManage && <Link to="/settings" className="rounded-xl border border-indigo-700 px-4 py-2 text-sm font-semibold text-indigo-200 transition hover:border-indigo-400 hover:text-white">Manage connections in Settings</Link>}
    </div>

    <div className="overflow-x-auto rounded-2xl border border-slate-800 bg-slate-900/70">
      <table className="w-full min-w-[980px] text-left text-sm">
        <thead className="border-b border-slate-700 text-xs uppercase tracking-wide text-slate-500">
          <tr><th className="px-4 py-3">Source</th><th className="px-4 py-3">Account or resource</th><th className="px-4 py-3">Visible mapping</th><th className="px-4 py-3">State</th><th className="px-4 py-3">Permitted capability</th><th className="px-4 py-3">Last successful read</th><th className="px-4 py-3">Last error category</th></tr>
        </thead>
        <tbody>{rows.map(item => <tr key={item.id} className="border-b border-slate-800 align-top last:border-0">
          <td className="px-4 py-4"><p className="font-semibold text-white">{item.providerLabel}</p><p className="mt-1 text-xs text-slate-500">{item.connectionLabel}</p></td>
          <td className="px-4 py-4"><p className="text-slate-200">{item.accountLabel}</p><p className="mt-1 break-all text-xs text-slate-500">{item.accountId || 'Unavailable'}</p></td>
          <td className="px-4 py-4"><p className="text-slate-200">{item.brand.name}</p><p className="mt-1 text-xs text-slate-500">{item.mappingLabel}</p></td>
          <td className="px-4 py-4"><span className={'inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ' + stateClass(item.state)}>{STATE_LABELS[item.state] || 'Status unavailable'}</span>{item.state === 'stale' && <p className="mt-2 text-xs text-slate-500">More than {item.staleAfterHours} hours since the stored successful read.</p>}</td>
          <td className="px-4 py-4 text-slate-300">{CAPABILITY_LABELS[item.capability] || 'Setup only'}</td>
          <td className="px-4 py-4 text-slate-300">{timestamp(item.lastSuccessfulRead)}</td>
          <td className="px-4 py-4 text-slate-300">{item.lastErrorCategory || 'Not recorded'}</td>
        </tr>)}</tbody>
      </table>
    </div>
    <p className="text-xs leading-5 text-slate-500">Healthy and stale states use only provider-specific persisted snapshot timestamps. Connector health-check times are not treated as successful data reads. Rate-limited and failed states appear only when a safe stored category supports them; otherwise the state remains unavailable.</p>
  </section>
}
