import { useEffect, useRef, useState } from 'react'
import { useAuth } from '../context/AuthContext.jsx'
import { projectDraftRepository } from '../data/projectDraftRepository.js'
import { canShowAuthorityAdministration } from '../data/authorityAdministration.js'

export default function ProjectDraftActivation({ project, organizationId, membership, scopeRevision, requestSignal, onActivated, onAccessError }) {
  const { user } = useAuth()
  const isAdmin = canShowAuthorityAdministration(membership)
  const [isBoundManager, setIsBoundManager] = useState(false)
  const [checking, setChecking] = useState(!isAdmin)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const requestId = useRef(null)
  const generation = useRef(0)

  useEffect(() => {
    const current = ++generation.current
    setIsBoundManager(false)
    setError('')
    requestId.current = null
    if (isAdmin || !user?.id || !project?.id) { setChecking(false); return () => { generation.current += 1 } }
    setChecking(true)
    projectDraftRepository.hasOwnManagerBinding(organizationId, project.id, user.id, { signal: requestSignal })
      .then(value => { if (current === generation.current && !requestSignal?.aborted) setIsBoundManager(value) })
      .catch(cause => { if (current === generation.current && cause?.name !== 'AbortError') setError(cause.message || 'Unable to verify project access.') })
      .finally(() => { if (current === generation.current) setChecking(false) })
    return () => { generation.current += 1 }
  }, [isAdmin, organizationId, project?.id, requestSignal, scopeRevision, user?.id])

  if (project?.status !== 'planning') return null
  if (!isAdmin && !isBoundManager) return checking ? <p className="text-xs text-slate-500">Checking activation authority…</p> : null

  const activate = async () => {
    if (saving) return
    const current = generation.current
    const id = requestId.current || globalThis.crypto?.randomUUID?.()
    if (!id) { setError('A secure request ID is unavailable in this browser.'); return }
    requestId.current = id
    setSaving(true)
    setError('')
    try {
      await projectDraftRepository.activate({ organizationId, projectId: project.id, requestId: id })
      if (current === generation.current && !requestSignal?.aborted) onActivated()
    } catch (cause) {
      if (current === generation.current) {
        onAccessError?.(cause, { membershipMismatch: cause.status === 403 })
        setError(cause.message || 'Unable to activate this draft. Retrying uses the same request ID.')
      }
    } finally {
      if (current === generation.current) setSaving(false)
    }
  }
  return <div className="flex flex-col items-end gap-2">
    <button type="button" onClick={activate} disabled={saving} className="rounded-xl border border-violet-400/30 bg-violet-500/10 px-4 py-2 text-sm font-medium text-violet-200 disabled:opacity-40">{saving ? 'Activating…' : 'Activate project'}</button>
    {error && <p role="alert" className="max-w-sm text-right text-xs text-rose-300">{error}</p>}
  </div>
}
