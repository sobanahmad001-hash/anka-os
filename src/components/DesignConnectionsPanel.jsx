import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { integrations } from '../data/integrationRepository.js'
import { DESIGN_CONNECTION_STATE_COPY, designConnectionState, figmaFileUrl } from '../data/designIdentityReferences.js'

const BUTTON = 'rounded-xl border border-white/10 px-3 py-2 text-sm font-semibold text-slate-200 disabled:opacity-40'
const label = value => String(value || '').replaceAll('_', ' ').replace(/\b\w/g, letter => letter.toUpperCase())

export default function DesignConnectionsPanel({ canManage }) {
  const [connections, setConnections] = useState([])
  const [loading, setLoading] = useState(true)
  const [testingId, setTestingId] = useState('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  async function load({ preserveError = false } = {}) {
    setLoading(true)
    if (!preserveError) setError('')
    try {
      const result = await integrations.list('design')
      setConnections((result.connections || []).filter(item => item.provider === 'figma'))
    } catch (reason) { setError(reason.message) }
    finally { setLoading(false) }
  }

  useEffect(() => { load() }, []) // eslint-disable-line react-hooks/exhaustive-deps
  const connection = useMemo(() => connections.find(item => item.status === 'verified') || connections[0] || null, [connections])
  const state = designConnectionState(connection)
  const externalUrl = figmaFileUrl(connection)

  async function testAccess() {
    if (!connection || !canManage) return
    setTestingId(connection.id); setMessage(''); setError('')
    try {
      await integrations.test(connection.id)
      setMessage('Figma read-only access was tested. The refreshed result is authoritative.')
      await load()
    } catch (reason) {
      await load({ preserveError: true })
      setError(reason.message)
    }
    finally { setTestingId('') }
  }

  return <section aria-labelledby="design-connections-title" className="mt-6 rounded-2xl border border-cyan-500/20 bg-slate-900/70 p-5">
    <div className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-xs font-semibold uppercase tracking-wider text-cyan-300">B05 · S08 capability surface</p><h2 id="design-connections-title" className="mt-2 text-xl font-semibold">External Design references</h2><p className="mt-2 max-w-3xl text-sm leading-6 text-slate-400">Only the existing Figma read-only file check is supported. There is no live synchronization, file editing, or automatic import.</p></div><span className="rounded-full bg-slate-950 px-3 py-1 text-xs font-semibold text-slate-300">{label(state)}</span></div>
    {error && <p role="alert" className="mt-4 rounded-xl border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-200">{error}</p>}
    {message && <p role="status" className="mt-4 rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-3 text-sm text-emerald-200">{message}</p>}
    {loading ? <p className="mt-5 text-sm text-slate-500">Checking visible Design connections…</p> : <div className="mt-5 grid gap-4 lg:grid-cols-[1fr_.8fr]">
      <div className="rounded-xl border border-white/10 bg-slate-950/50 p-4"><p className="font-semibold">{connection?.display_name || 'Figma reference connection'}</p><p className="mt-2 text-sm leading-6 text-slate-400">{DESIGN_CONNECTION_STATE_COPY[state]}</p><dl className="mt-4 grid gap-2 text-xs text-slate-500"><div><dt className="inline font-semibold text-slate-300">Supported: </dt><dd className="inline">test read access; open the configured file</dd></div><div><dt className="inline font-semibold text-slate-300">Snapshot import: </dt><dd className="inline">Not available</dd></div><div><dt className="inline font-semibold text-slate-300">Last verified: </dt><dd className="inline">{connection?.last_checked_at ? new Date(connection.last_checked_at).toLocaleString() : 'Not verified'}</dd></div></dl><div className="mt-4 flex flex-wrap gap-2">{externalUrl && <a className={BUTTON} href={externalUrl} target="_blank" rel="noreferrer">Open configured Figma file ↗</a>}{canManage && connection && <button type="button" onClick={testAccess} disabled={!connection.secret_configured || testingId === connection.id} className={BUTTON}>{testingId === connection.id ? 'Testing…' : 'Test available access'}</button>}{canManage && <Link className={BUTTON} to="/settings?provider=figma">{connection ? 'Manage or reconnect' : 'Configure in Administration'}</Link>}</div></div>
      <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-4"><p className="font-semibold text-amber-100">Captured references stay local and exact</p><p className="mt-2 text-sm leading-6 text-slate-400">The currently supported path does not import a provider snapshot. Use approved DS5 versions as pinned identity references. A future import must add preview and destination confirmation before it can appear here.</p><p className="mt-4 text-sm font-semibold text-slate-300">Video not configured</p></div>
    </div>}
  </section>
}
