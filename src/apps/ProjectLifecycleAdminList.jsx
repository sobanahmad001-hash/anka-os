import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { projectLifecycleRepository } from '../data/projectLifecycleRepository.js'
import ProjectLifecyclePanel from './ProjectLifecyclePanel.jsx'

export default function ProjectLifecycleAdminList({ organizationId, membership, scopeRevision, requestSignal, onChanged }) {
  const [archived, setArchived] = useState(true)
  const [rows, setRows] = useState([])
  const [selected, setSelected] = useState(null)
  const [error, setError] = useState('')
  const [revision, setRevision] = useState(0)
  const [loading, setLoading] = useState(true)
  useEffect(() => { setSelected(null) }, [organizationId, archived, requestSignal, scopeRevision])
  useEffect(() => {
    let live = true
    setRows([]); setError(''); setLoading(true)
    projectLifecycleRepository.list(organizationId, archived, { signal: requestSignal })
      .then(value => { if (live && !requestSignal?.aborted) setRows(value) })
      .catch(cause => { if (live && !requestSignal?.aborted) setError(cause.message) })
      .finally(() => { if (live) setLoading(false) })
    return () => { live = false }
  }, [organizationId, archived, requestSignal, scopeRevision, revision])
  const refresh = useCallback(() => { setRevision(value => value + 1); onChanged?.() }, [onChanged])
  const changed = useCallback(result => {
    setSelected(current => current?.id === result.project_id
      ? { ...current, archived_at: result.archived_at, status: result.status } : current)
    refresh()
  }, [refresh])
  const deleted = useCallback(() => { setSelected(null); refresh() }, [refresh])
  return <section aria-label="Admin project lifecycle" className="workspace-card mt-6 p-4 space-y-3">
    <h2 className="font-semibold">Project lifecycle administration</h2>
    <div className="flex gap-2"><button type="button" className="workspace-button" aria-pressed={archived} onClick={() => setArchived(true)}>Archived projects</button><button type="button" className="workspace-button" aria-pressed={!archived} onClick={() => setArchived(false)}>Planning projects · deletion review</button><button type="button" className="workspace-button" onClick={() => setRevision(value => value + 1)}>Refresh list</button></div>
    {loading ? <p>Loading projects…</p> : rows.length ? <ul className="space-y-2">{rows.map(row => <li key={row.id} className="flex items-center gap-3"><button type="button" className="workspace-button" onClick={() => setSelected(row)}>{row.name} · {row.status}{row.archived_at ? ' · archived' : ''}</button><Link to={`/sphere/workspace/projects/${encodeURIComponent(row.id)}`} className="text-sm text-[var(--anka-violet)]">Open project detail</Link></li>)}</ul> : <p>No projects in this list.</p>}
    {error && <p role="alert">{error}</p>}
    {selected && <ProjectLifecyclePanel key={`${organizationId}:${selected.id}:${scopeRevision}`} project={selected} organizationId={organizationId} membership={membership} scopeRevision={scopeRevision} requestSignal={requestSignal} onChanged={changed} onDeleted={deleted} />}
  </section>
}
