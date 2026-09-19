import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { createAuthorityAdministrationRepository } from '../data/authorityAdministration'

const field = 'rounded border border-slate-600 bg-slate-900 p-2 text-sm'
const button = 'rounded border border-violet-400/40 px-3 py-2 text-sm disabled:opacity-40'

export default function AuthorityCompatibilityAdmin({ organizationId, organizationName, requestSignal, client = supabase }) {
  const repository = useMemo(() => createAuthorityAdministrationRepository(client), [client])
  const [userId, setUserId] = useState('')
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [revision, setRevision] = useState(0)
  const mutation = useRef(false)
  const alive = useRef(false)
  const [department, setDepartment] = useState('')
  const [project, setProject] = useState('')
  const [designation, setDesignation] = useState('')
  const usable = useCallback(() => alive.current && !requestSignal?.aborted, [requestSignal])

  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])
  useEffect(() => {
    const controller = new AbortController()
    const abort = () => controller.abort()
    requestSignal?.addEventListener('abort', abort, { once: true })
    if (requestSignal?.aborted) controller.abort()
    setLoading(true)
    setData(null)
    repository.read(organizationId, userId || null, { signal: controller.signal }).then(result => {
      if (controller.signal.aborted) return
      setData(result)
      setDepartment('')
      setProject('')
      setDesignation(result.snapshot?.contributor_designations.find(row => row.status === 'active')?.designation || '')
    }).catch(failure => {
      if (!controller.signal.aborted) setError(failure.message || 'Unable to load compatibility records')
    }).finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => { controller.abort(); requestSignal?.removeEventListener('abort', abort) }
  }, [organizationId, userId, repository, requestSignal, revision])

  async function change(action, value) {
    if (mutation.current || !data?.token || loading || !usable()) return
    mutation.current = true
    setBusy(true)
    setError('')
    setNotice('')
    try {
      await repository.change({ organizationId, userId, action, value, token: data.token, requestId: crypto.randomUUID() }, { signal: requestSignal })
      if (usable()) setNotice('Compatibility record saved. Effective permissions and legacy access are unchanged.')
    } catch (failure) {
      if (usable()) setError(failure.code === '40001'
        ? 'Another edit changed these records. Reloading; review the latest state before submitting again.'
        : (failure.message || 'Save outcome unknown. Review reloaded records before trying again.'))
    } finally {
      mutation.current = false
      if (usable()) { setBusy(false); setLoading(true); setData(null); setRevision(value => value + 1) }
    }
  }

  const snapshot = data?.snapshot
  const active = snapshot?.status === 'active'
  const disabled = busy || loading || !snapshot || requestSignal?.aborted
  const history = [
    ...(snapshot?.department_memberships || []).map(row => ({ ...row, label: 'Department: ' + row.department_id, action: 'revoke_department' })),
    ...(snapshot?.contributor_designations || []).map(row => ({ ...row, label: 'Contributor designation: ' + row.designation })),
    ...(snapshot?.project_manager_bindings || []).map(row => ({ ...row, label: 'Project manager: ' + (data.projects.find(project => project.id === row.project_id)?.name || row.project_id), action: 'revoke_project_manager' })),
  ]
  return <section className="space-y-5 p-6 text-slate-100" aria-label="Compatibility administration">
    <header>
      <h2 className="text-lg font-semibold">Compatibility administration — pre-cutover</h2>
      <p className="text-sm text-slate-400">Selected organization: {organizationName || organizationId}</p>
    </header>
    <p className="rounded border border-amber-400/30 bg-amber-400/5 p-3 text-sm text-amber-100">
      These are compatibility records, not effective permissions. Removing a record does not revoke all legacy access.
      Contributor Executive is a designation, not the legacy elevated Executive role. Legacy controls remain separate.
    </p>
    {error && <p role="alert" className="text-sm text-red-300">{error}</p>}
    {notice && <p role="status" className="text-sm text-emerald-300">{notice}</p>}
    <div className="flex flex-wrap items-center gap-3">
      <label>Team member <select className={field} value={userId} disabled={busy || loading} onChange={event => {
        setUserId(event.target.value); setData(null); setLoading(true); setError(''); setNotice(''); setDepartment(''); setProject('')
      }}>
        <option value="">Select a team member</option>
        {data?.members.map(member => <option key={member.user_id} value={member.user_id}>{member.name} — {member.role} ({member.status})</option>)}
      </select></label>
      <button className={button} disabled={busy || loading} onClick={() => { setError(''); setLoading(true); setRevision(value => value + 1) }}>Reload</button>
    </div>
    {loading && <p role="status">Loading current compatibility records…</p>}
    {snapshot && <>
      <p className="text-sm text-slate-400">Legacy role: {snapshot.legacy_role}; legacy department: {snapshot.legacy_department_id || 'none'}; membership: {snapshot.status}. These legacy fields are read-only here.</p>
      <fieldset disabled={disabled || !active} className="flex flex-wrap items-end gap-3">
        <legend className="mb-2 font-medium">Department memberships</legend>
        <label>Department <select className={field} value={department} onChange={event => setDepartment(event.target.value)}>
          <option value="">Select department</option>
          {data.departments.filter(item => !snapshot.department_memberships.some(row => row.department_id === item.id && row.status === 'active'))
            .map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select></label>
        <button className={button} disabled={!department} onClick={() => change('add_department', department)}>Add department record</button>
      </fieldset>
      <fieldset disabled={disabled} className="flex flex-wrap items-end gap-3">
        <legend className="mb-2 font-medium">Contributor designation</legend>
        <label>Designation <select className={field} value={designation} onChange={event => setDesignation(event.target.value)}>
          <option value="">None / clear designation</option>
          <option value="intern" disabled={!active || snapshot.legacy_role !== 'contributor'}>Intern</option>
          <option value="executive" disabled={!active || snapshot.legacy_role !== 'contributor'}>Executive (contributor designation)</option>
        </select></label>
        <button className={button} disabled={Boolean(designation) && (!active || snapshot.legacy_role !== 'contributor')} onClick={() => change('set_designation', designation || null)}>Save designation</button>
      </fieldset>
      <fieldset disabled={disabled || !active} className="flex flex-wrap items-end gap-3">
        <legend className="mb-2 font-medium">Project-manager bindings (multiple managers supported)</legend>
        <label>Project <select className={field} value={project} onChange={event => setProject(event.target.value)}>
          <option value="">Select project</option>
          {data.projects.filter(item => !snapshot.project_manager_bindings.some(row => row.project_id === item.id && row.status === 'active'))
            .map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select></label>
        <button className={button} disabled={!project} onClick={() => change('add_project_manager', project)}>Add manager record</button>
      </fieldset>
      <h3 className="font-medium">Record history</h3>
      {!history.length && <p className="text-sm text-slate-400">No compatibility records. No authority is inferred from titles.</p>}
      <ul className="space-y-3">{history.map(row => <li key={row.id} className="rounded border border-slate-800 p-3 text-sm">
        <div>{row.label} — {row.status}</div>
        <div className="break-all text-xs text-slate-400">Source: {row.source}; created: {row.created_at}; revoked: {row.revoked_at || 'never'}</div>
        {row.status === 'active' && row.action && <button className={button} disabled={disabled} onClick={() => change(row.action, row.id)}>Revoke compatibility record</button>}
      </li>)}</ul>
    </>}
  </section>
}
