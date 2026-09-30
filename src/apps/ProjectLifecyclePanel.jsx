import { useEffect, useRef, useState } from 'react'
import { useAuth } from '../context/AuthContext.jsx'
import { canShowAuthorityAdministration } from '../data/authorityAdministration.js'
import { projectDraftRepository } from '../data/projectDraftRepository.js'
import { isProjectLifecycleRollbackError, projectLifecycleRepository } from '../data/projectLifecycleRepository.js'

export default function ProjectLifecyclePanel({ project, organizationId, membership, requestSignal, scopeRevision, onChanged, onDeleted }) {
  const { user } = useAuth()
  const admin = canShowAuthorityAdministration(membership)
  const [manager, setManager] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [preview, setPreview] = useState(null)
  const [confirmation, setConfirmation] = useState('')
  const [confirmLifecycle, setConfirmLifecycle] = useState(false)
  const generation = useRef(0)
  const pending = useRef(null)
  const archived = Boolean(project.archived_at)

  useEffect(() => {
    const current = ++generation.current
    setManager(false); setError(''); setPreview(null); setConfirmation(''); setBusy(false); setConfirmLifecycle(false)
    pending.current = null
    if (!admin && user?.id) projectDraftRepository.hasOwnManagerBinding(organizationId, project.id, user.id, { signal: requestSignal })
      .then(value => { if (current === generation.current && !requestSignal?.aborted) setManager(value) })
      .catch(() => { /* Fail closed; the server rechecks all authority. */ })
    return () => { generation.current += 1 }
  }, [organizationId, project.id, archived, admin, user?.id, requestSignal, scopeRevision])

  if (!admin && !manager) return null
  const run = async (action) => {
    if (busy || requestSignal?.aborted) return
    const current = generation.current
    const isCurrent = () => current === generation.current && !requestSignal?.aborted
    setBusy(true); setError('')
    try {
      if (action === 'preview') {
        const value = await projectLifecycleRepository.preview(organizationId, project.id, { signal: requestSignal })
        if (isCurrent()) { setPreview(value); setConfirmation(''); pending.current = null }
      } else {
        const command = action === 'delete' ? { action, confirmation, preview } : { action, archived: !archived }
        // Preserve exact command and request identity after an ambiguous network failure.
        if (!pending.current) pending.current = { ...command, requestId: globalThis.crypto.randomUUID() }
        const saved = pending.current
        if (saved.action !== action) throw new Error('Retry the pending action before starting another lifecycle change.')
        const result = action === 'delete'
          ? await projectLifecycleRepository.deleteEmpty({ organizationId, projectId: project.id, ...saved })
          : await projectLifecycleRepository.setArchived({ organizationId, projectId: project.id, ...saved })
        if (isCurrent()) {
          pending.current = null; setPreview(null); setConfirmLifecycle(false)
          if (action === 'delete') onDeleted?.(result)
          else onChanged?.(result)
        }
      }
    } catch (cause) {
      if (isCurrent()) {
        // Only known rollbacks clear the command; ambiguous outcomes retain it for receipt replay.
        if (isProjectLifecycleRollbackError(cause)) pending.current = null
        setError(cause.message)
      }
    }
    finally { if (isCurrent()) setBusy(false) }
  }
  return <section aria-label="Project lifecycle" className="workspace-card mt-5 p-4 space-y-3 text-sm">
    <h2 className="font-semibold">{archived ? 'Archived project' : 'Project lifecycle'}</h2>
    <p className="text-[var(--anka-muted)]">Archive preserves all work, history, statuses, services, chats, documents and portal settings. It denies client access and blocks new work where existing archive guards apply. In-flight external provider calls may still finish. Previously issued file links may remain valid until they expire. Restoring may re-enable existing active work and client access.</p>
    <button type="button" className="workspace-button" disabled={busy || Boolean(pending.current && pending.current.action !== 'archive')} onClick={() => setConfirmLifecycle(true)}>{archived ? 'Restore project' : 'Archive project'}</button>
    {confirmLifecycle && <div className="space-y-2"><p>{archived ? 'Restore this project with its existing settings and work state?' : 'Archive this project and retain all of its records?'}</p><button type="button" className="workspace-button" disabled={busy} onClick={() => run('archive')}>{busy ? 'Saving…' : pending.current ? 'Retry same request' : archived ? 'Confirm restore' : 'Confirm archive'}</button><button type="button" className="workspace-button" disabled={busy || Boolean(pending.current)} onClick={() => setConfirmLifecycle(false)}>Cancel</button></div>}
    {admin && !archived && <div className="space-y-3">
      <p>Permanent deletion is admin-only and limited to unarchived planning projects with no retained records or history. Draft creation receipts also prevent deletion.</p>
      <button type="button" className="workspace-button" disabled={busy || Boolean(pending.current)} onClick={() => run('preview')}>Preview deletion eligibility</button>
      {preview && <div className="space-y-3">
        <p>{preview.eligible ? 'No referencing records found. This one-use preview expires in five minutes; eligibility is checked again at deletion.' : 'Deletion blocked: this project is archived, is not planning, or has retained records. Archive it to preserve its history.'}</p>
        <details><summary>Referencing tables and row counts</summary><table className="w-full text-left"><thead><tr><th>Schema</th><th>Table</th><th>Rows</th></tr></thead><tbody>{preview.dependencies.map(row => <tr key={JSON.stringify([row.schema, row.table])}><td>{row.schema}</td><td>{row.table}</td><td>{row.count}</td></tr>)}</tbody></table></details>
        {preview.eligible && <><label className="block">Type the exact project name: <strong>{preview.project_name}</strong><input className="block workspace-input mt-2" value={confirmation} disabled={busy || Boolean(pending.current)} onChange={event => setConfirmation(event.target.value)} autoComplete="off" /></label><button type="button" className="workspace-button text-[var(--anka-danger)]" disabled={busy || confirmation !== preview.project_name} onClick={() => run('delete')}>{busy ? 'Deleting…' : pending.current ? 'Retry same deletion request' : 'Permanently delete empty project'}</button></>}
      </div>}
    </div>}
    {error && <p role="alert" className="text-[var(--anka-danger)]">{error}</p>}
  </section>
}
