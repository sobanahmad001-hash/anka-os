import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'

import { connectorsForDepartment } from '../config/connectorCatalog.js'
import { integrations } from '../data/integrationRepository.js'

function labelize(value) {
  return String(value || '').replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())
}

function Status({ value }) {
  const styles = {
    verified: 'bg-emerald-950 text-emerald-300',
    configured: 'bg-blue-950 text-blue-300',
    error: 'bg-red-950 text-red-300',
    disconnected: 'bg-slate-800 text-slate-300',
    oauth_planned: 'bg-amber-950 text-amber-300',
    planned: 'bg-slate-800 text-slate-400',
  }
  return <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${styles[value] || styles.disconnected}`}>{labelize(value)}</span>
}

export default function DepartmentConnectors({ departmentId, departmentName }) {
  const [connections, setConnections] = useState([])
  const [canManage, setCanManage] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const catalog = useMemo(() => connectorsForDepartment(departmentId), [departmentId])

  useEffect(() => {
    let active = true
    setLoading(true)
    setError('')
    integrations.list(departmentId)
      .then((result) => {
        if (!active) return
        setConnections(result.connections || [])
        setCanManage(Boolean(result.can_manage))
      })
      .catch((loadError) => { if (active) setError(loadError.message) })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [departmentId])

  const byProvider = useMemo(() => {
    const result = new Map()
    for (const connection of connections) {
      const group = result.get(connection.provider) || []
      group.push(connection)
      result.set(connection.provider, group)
    }
    return result
  }, [connections])

  const verifiedCount = connections.filter((connection) => connection.status === 'verified').length

  return (
    <section className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-4 rounded-2xl border border-slate-800 bg-slate-900/70 p-5">
        <div>
          <h2 className="font-semibold text-white">{departmentName} connectors</h2>
          <p className="mt-1 max-w-3xl text-sm leading-6 text-slate-400">Use approved agency connections in this department. Credentials remain in secure server-side secrets; this workspace receives status and authorised capabilities only.</p>
        </div>
        <div className="flex items-center gap-3">
          <span className="rounded-full bg-slate-950 px-3 py-1.5 text-xs text-slate-400">{verifiedCount} verified</span>
          {canManage && <Link to="/settings" className="rounded-xl bg-purple-600 px-4 py-2 text-sm font-semibold text-white hover:bg-purple-500">Manage connectors</Link>}
        </div>
      </div>

      {error && <div className="rounded-xl border border-red-900/60 bg-red-950/50 px-4 py-3 text-sm text-red-300">{error}</div>}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {catalog.map((connector) => {
          const providerConnections = byProvider.get(connector.id) || []
          const bestConnection = providerConnections.find((connection) => connection.status === 'verified') || providerConnections[0]
          const status = bestConnection?.status || connector.availability
          return (
            <article key={connector.id} className="flex min-h-64 flex-col rounded-2xl border border-slate-800 bg-slate-900/70 p-5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">{connector.category}</p>
                  <h3 className="mt-1 font-semibold text-white">{connector.label}</h3>
                </div>
                <Status value={status} />
              </div>
              <p className="mt-3 text-sm leading-6 text-slate-400">{connector.description}</p>
              <div className="mt-4 flex flex-wrap gap-2">
                {connector.capabilities.map((capability) => <span key={capability} className="rounded-full bg-slate-950 px-2.5 py-1 text-[11px] text-slate-500">{capability}</span>)}
              </div>
              <div className="mt-auto border-t border-slate-800 pt-4 text-xs text-slate-500">
                {loading ? 'Checking connection status…' : bestConnection ? `${bestConnection.display_name} · ${bestConnection.secret_configured ? 'Credential available' : 'Credential pending'}` : connector.availability === 'oauth_planned' ? 'OAuth authorisation is the next implementation step.' : connector.availability === 'planned' ? 'Planned connector; no credentials requested yet.' : 'Available to configure in Administration.'}
                {connector.id === 'openai' && bestConnection?.status === 'verified' && <Link to={`/assistant?department=${departmentId}`} className="mt-3 block font-semibold text-purple-400 hover:text-purple-300">Open department assistant →</Link>}
              </div>
            </article>
          )
        })}
      </div>
    </section>
  )
}
