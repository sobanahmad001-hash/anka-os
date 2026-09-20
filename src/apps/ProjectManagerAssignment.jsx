import { useEffect, useRef, useState } from 'react'
import { projectDraftRepository } from '../data/projectDraftRepository.js'
import { canShowAuthorityAdministration } from '../data/authorityAdministration.js'

export default function ProjectManagerAssignment({ project, organizationId, membership, scopeRevision, requestSignal, onAssigned, onAccessError }) {
  const admin = canShowAuthorityAdministration(membership)
  const [state, setState] = useState(null)
  const [managerId, setManagerId] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const requestId = useRef(null)
  const generation = useRef(0)

  useEffect(() => {
    const current = ++generation.current
    setState(null); setManagerId(''); setError(''); requestId.current = null
    if (!admin || project.status !== 'planning') return () => { generation.current += 1 }
    projectDraftRepository.managerState(organizationId, project.id, { signal: requestSignal })
      .then(data => { if (current === generation.current && !requestSignal?.aborted) setState(data) })
      .catch(cause => {
        if (current === generation.current && cause?.name !== 'AbortError') {
          onAccessError?.(cause, { membershipMismatch: cause.status === 403 })
          setError(cause.message || 'Unable to load manager assignment.')
        }
      })
    return () => { generation.current += 1 }
  }, [admin, organizationId, project.id, project.status, requestSignal, scopeRevision, onAccessError])

  if (!admin || project.status !== 'planning') return null
  const assign = async event => {
    event.preventDefault()
    if (saving || !managerId) return
    const current = generation.current
    const id = requestId.current || globalThis.crypto?.randomUUID?.()
    if (!id) { setError('A secure request ID is unavailable.'); return }
    requestId.current = id
    setSaving(true); setError('')
    try {
      await projectDraftRepository.assignManager({ organizationId, projectId: project.id, managerId, requestId: id })
      const data = await projectDraftRepository.managerState(organizationId, project.id, { signal: requestSignal })
      if (current === generation.current && !requestSignal?.aborted) { setState(data); requestId.current = null; onAssigned?.() }
    } catch (cause) {
      if (current === generation.current) {
        onAccessError?.(cause, { membershipMismatch: cause.status === 403 })
        setError(cause.message || 'Unable to assign manager. Retrying uses the same request ID.')
      }
    } finally { if (current === generation.current) setSaving(false) }
  }
  return <section aria-label="Project manager assignment" className="mt-5 rounded-xl border border-white/10 bg-white/[0.025] p-4 text-sm">
    <h2 className="font-medium">Project manager</h2>
    {error && <p role="alert" className="mt-2 text-rose-300">{error}</p>}
    {!state && !error && <p className="mt-2 text-slate-400">Checking assignment…</p>}
    {state?.manager_id ? <p className="mt-2 text-slate-300">Assigned: {state.members.find(row => row.id === state.manager_id)?.name || 'Active project manager'}. This draft can be activated.</p>
      : state && <form onSubmit={assign} className="mt-3 flex flex-wrap items-end gap-3"><label className="min-w-60 flex-1 text-xs text-slate-400">Assign an active team member<select required value={managerId} onChange={event => { setManagerId(event.target.value); requestId.current = null }} className="mt-1 w-full rounded-lg border border-white/10 bg-[#111622] px-3 py-2 text-sm text-white"><option value="">Select project manager</option>{state.members.map(member => <option key={member.id} value={member.id}>{member.name}</option>)}</select></label><button type="submit" disabled={!managerId || saving} className="rounded-lg border border-violet-400/30 px-4 py-2 text-violet-200 disabled:opacity-40">{saving ? 'Assigning…' : 'Assign PM'}</button></form>}
  </section>
}
