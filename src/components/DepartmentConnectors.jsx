import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'

import { connectorsForDepartment } from '../config/connectorCatalog.js'
import { integrations } from '../data/integrationRepository.js'

function labelize(value) {
  return String(value || '').replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())
}

function Status({ value }) {
  const styles = {
    verified: 'bg-[var(--anka-success-soft)] text-[var(--anka-success)]',
    configured: 'bg-[color-mix(in_srgb,var(--anka-info)_12%,var(--anka-surface))] text-[var(--anka-info)]',
    authorizing: 'bg-[var(--anka-warning-soft)] text-[var(--anka-warning)]',
    error: 'bg-[var(--anka-danger-soft)] text-[var(--anka-danger)]',
    disconnected: 'bg-[var(--anka-surface-raised)] text-[var(--anka-ink)]',
    oauth_planned: 'bg-[var(--anka-warning-soft)] text-[var(--anka-warning)]',
    planned: 'bg-[var(--anka-surface-raised)] text-[var(--anka-muted)]',
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
      <div className="flex flex-wrap items-start justify-between gap-4 rounded-2xl border border-[var(--anka-line)] bg-[var(--anka-surface)] p-5">
        <div>
          <h2 className="font-semibold text-[var(--anka-ink)]">{departmentName} connectors</h2>
          <p className="mt-1 max-w-3xl text-sm leading-6 text-[var(--anka-muted)]">Use approved agency connections in this department. Provider secrets and encrypted OAuth tokens remain server-side; this workspace receives status and authorised capabilities only.</p>
        </div>
        <div className="flex items-center gap-3">
          <span className="rounded-full bg-[var(--anka-canvas)] px-3 py-1.5 text-xs text-[var(--anka-muted)]">{verifiedCount} verified</span>
          {canManage && <Link to="/settings" className="rounded-xl bg-[var(--anka-violet)] px-4 py-2 text-sm font-semibold text-[var(--anka-on-violet)] hover:brightness-110">Manage connectors</Link>}
        </div>
      </div>

      {error && <div className="rounded-xl border border-[var(--anka-danger)] bg-[var(--anka-danger-soft)] px-4 py-3 text-sm text-[var(--anka-danger)]">{error}</div>}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {catalog.map((connector) => {
          const providerConnections = byProvider.get(connector.id) || []
          const bestConnection = providerConnections.find((connection) => connection.status === 'verified') || providerConnections[0]
          const status = bestConnection?.status || connector.availability
          return (
            <article key={connector.id} className="flex min-h-64 flex-col rounded-2xl border border-[var(--anka-line)] bg-[var(--anka-surface)] p-5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--anka-muted)]">{connector.category}</p>
                  <h3 className="mt-1 font-semibold text-[var(--anka-ink)]">{connector.label}</h3>
                </div>
                <Status value={status} />
              </div>
              <p className="mt-3 text-sm leading-6 text-[var(--anka-muted)]">{connector.description}</p>
              <div className="mt-4 flex flex-wrap gap-2">
                {connector.capabilities.map((capability) => <span key={capability} className="rounded-full bg-[var(--anka-canvas)] px-2.5 py-1 text-[11px] text-[var(--anka-muted)]">{capability}</span>)}
              </div>
              <div className="mt-auto border-t border-[var(--anka-line)] pt-4 text-xs text-[var(--anka-muted)]">
                {loading ? 'Checking connection status…' : bestConnection ? `${bestConnection.display_name} · ${connector.authMode === 'oauth' ? (bestConnection.status === 'verified' ? 'Google account authorised' : 'Google authorisation required') : bestConnection.secret_configured ? 'Credential available' : 'Credential pending'}` : connector.availability === 'oauth_planned' ? 'OAuth authorisation is the next implementation step.' : connector.availability === 'planned' ? 'Planned connector; no credentials requested yet.' : 'Available to configure in Administration.'}
                {connector.id === 'openai' && bestConnection?.status === 'verified' && <Link to={`/assistant?department=${departmentId}`} className="mt-3 block font-semibold text-[var(--anka-violet)] hover:text-[var(--anka-ink)]">Open department assistant →</Link>}
              </div>
            </article>
          )
        })}
      </div>
    </section>
  )
}
