import { useEffect, useRef, useState } from 'react'

export default function ProjectDepartmentParticipation({ organizationId, projects, departments, client, requestSignal }) {
  const [projectId, setProjectId] = useState('')
  const [snapshot, setSnapshot] = useState(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [revision, setRevision] = useState(0)
  const inFlight = useRef(false)
  const alive = useRef(false)
  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])
  useEffect(() => {
    const controller = new AbortController()
    const abort = () => controller.abort()
    requestSignal?.addEventListener('abort', abort, { once: true })
    if (requestSignal?.aborted) controller.abort()
    setSnapshot(null)
    if (projectId && !controller.signal.aborted) {
      let query = client.rpc('get_project_department_participation', { p_organization_id: organizationId, p_project_id: projectId })
      if (query.abortSignal) query = query.abortSignal(controller.signal)
      Promise.resolve(query).then(({ data, error }) => {
        if (controller.signal.aborted) return
        if (error) throw error
        if (data?.organization_id !== organizationId || data.project_id !== projectId || !data.token ||
          !Array.isArray(data.records) || data.records.some(row => row.organization_id !== organizationId || row.project_id !== projectId)) {
          throw new Error('Participation response scope mismatch')
        }
        setSnapshot(data)
      }).catch(cause => { if (!controller.signal.aborted) setError(cause.message || 'Participation unavailable') })
    }
    return () => { controller.abort(); requestSignal?.removeEventListener('abort', abort) }
  }, [organizationId, projectId, client, requestSignal, revision])

  async function change(departmentId, enabled) {
    if (!snapshot || inFlight.current || requestSignal?.aborted) return
    inFlight.current = true
    setBusy(true); setError('')
    try {
      const { data, error } = await client.rpc('change_project_department_participation', {
        p_organization_id: organizationId, p_project_id: projectId, p_department_id: departmentId,
        p_enabled: enabled, p_expected_token: snapshot.token, p_request_id: crypto.randomUUID(),
      })
      if (error) throw error
      if (data?.organization_id !== organizationId || data.project_id !== projectId) throw new Error('Participation response scope mismatch')
    } catch (cause) {
      if (alive.current && !requestSignal?.aborted) setError(cause.code === '40001'
        ? 'Participation changed elsewhere. Reload and review before retrying.' : cause.message || 'Save outcome unknown. Reload before retrying.')
    } finally {
      inFlight.current = false
      if (alive.current && !requestSignal?.aborted) { setBusy(false); setSnapshot(null); setRevision(value => value + 1) }
    }
  }
  return <section aria-label="Project department participation" className="space-y-3 border-t border-slate-700 pt-6">
    <h3 className="font-semibold">Explicit project–department participation</h3>
    <p className="text-sm text-slate-400">Only organization owners/admins manage participation. A current department head may assign their own department’s work only in an included project. This does not grant specialist review, PM confirmation or release. No participation is inferred from visibility or titles.</p>
    {error && <p role="alert" className="text-sm text-red-300">{error}</p>}
    <label className="text-sm">Project <select className="rounded border border-slate-600 bg-slate-900 p-2" value={projectId} disabled={busy}
      onChange={event => { setSnapshot(null); setProjectId(event.target.value); setError('') }}>
      <option value="">Select a project</option>
      {projects.map(project => <option key={project.id} value={project.id}>{project.name}</option>)}
    </select></label>
    {projectId && <button className="ml-3 rounded border border-slate-600 px-3 py-2 text-sm" disabled={busy} onClick={() => { setError(''); setRevision(value => value + 1) }}>Reload participation</button>}
    {snapshot && <>
      <ul className="space-y-2">{departments.map(department => {
        const active = snapshot.records.some(row => row.department_id === department.id && row.status === 'active')
        return <li key={department.id} className="flex items-center justify-between gap-4 rounded border border-slate-800 p-3 text-sm">
          <span>{department.name} — {active ? 'Included' : 'Not included'}</span>
          <button className="rounded border border-violet-400/40 px-3 py-2 disabled:opacity-40" disabled={busy} onClick={() => change(department.id, !active)}>{active ? 'Revoke participation' : 'Include department'}</button>
        </li>
      })}</ul>
      <details className="text-xs text-slate-400"><summary>Participation history ({snapshot.records.length})</summary>
        <ul>{snapshot.records.map(row => <li key={row.id}>{row.department_id}: {row.status}; created {row.created_at}; revoked {row.revoked_at || 'never'}</li>)}</ul>
      </details>
    </>}
  </section>
}
