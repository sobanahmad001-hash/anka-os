import { useEffect, useRef, useState } from 'react'
import { projectMemoryRepository } from '../data/projectMemoryRepository.js'
import { clientBrandMemoryRepository } from '../data/clientBrandMemoryRepository.js'
import { departmentMemoryRepository } from '../data/departmentMemoryRepository.js'
import { organizationPolicyRepository } from '../data/organizationPolicyRepository.js'

const projectLink = (projectId, commentId) =>
  '/sphere/workspace/projects/' + encodeURIComponent(projectId)
  + '?tab=discussion#project-message-' + encodeURIComponent(commentId)

function _MemoryRows({ label, rows, statement }) {
  return <div>
    <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-400">{label} · {rows.length}</h4>
    {rows.slice(0, 10).map(row => <article key={row.id} className="mt-2 rounded-lg border border-slate-800 bg-slate-950/50 p-3">
      <p className="text-xs text-slate-200">{row[statement]}</p>
      <div className="mt-2 flex flex-wrap gap-3 text-[11px] text-slate-500">
        {row.scope_kind && <span>{row.scope_kind === 'brand' ? 'Brand' : 'Client'}</span>}
        <span>Reviewed {row.reviewed_at ? new Date(row.reviewed_at).toLocaleDateString() : 'date unavailable'}</span>
        {row.project_id && row.source_comment_id ? <a className="text-violet-300" href={projectLink(row.project_id, row.source_comment_id)}>Source discussion</a> : row.source_note && <span>Source basis: {row.source_note}</span>}
      </div>
    </article>)}
    {rows.length > 10 && <p className="mt-2 text-[11px] text-slate-500">Showing 10 of {rows.length}; open the relevant memory screen for the full set.</p>}
  </div>
}

export default function AssistantMemoryContext({
  organizationId, projectId, departmentId, scopeRevision, onAccessError,
}) {
  const [context, setContext] = useState(null)
  const [error, setError] = useState('')
  const [refreshRevision, setRefreshRevision] = useState(0)
  const generation = useRef(0)

  useEffect(() => {
    const current = ++generation.current
    setContext(null); setError('')
    if (!organizationId || !projectId || !departmentId) return () => { generation.current += 1 }
    Promise.allSettled([
      projectMemoryRepository.list(organizationId, projectId),
      clientBrandMemoryRepository.list(organizationId, projectId),
      departmentMemoryRepository.list(organizationId, departmentId),
      organizationPolicyRepository.list(organizationId),
    ]).then(results => {
      if (current !== generation.current) return
      const [project, clientBrand, department, policy] = results
      if (project.status === 'rejected') {
        onAccessError?.(project.reason, { membershipMismatch: project.reason?.status === 403 })
        setError(project.reason?.message || 'Project memory unavailable.')
        return
      }
      if (clientBrand.status === 'rejected' && clientBrand.reason?.status !== 403) {
        setError(clientBrand.reason?.message || 'Client and brand memory unavailable.')
        return
      }
      if (department.status === 'rejected' && department.reason?.status !== 403) {
        setError(department.reason?.message || 'Department memory unavailable.')
        return
      }
      if (policy.status === 'rejected') {
        setError(policy.reason?.message || 'Organization policy unavailable.')
        return
      }
      setContext({
        policy: policy.value.confirmed,
        project: project.value.confirmed.map(row => ({ ...row, project_id: projectId })),
        clientBrand: clientBrand.status === 'fulfilled' ? clientBrand.value.confirmed : [],
        department: department.status === 'fulfilled' ? department.value.confirmed : [],
        clientBrandUnavailable: clientBrand.status === 'rejected',
        departmentUnavailable: department.status === 'rejected',
      })
    })
    return () => { generation.current += 1 }
  }, [organizationId, projectId, departmentId, scopeRevision, refreshRevision, onAccessError])

  if (!projectId || !departmentId) return null
  return <section aria-label="Reviewed memory preview" className="rounded-xl border border-slate-800 bg-slate-950/40 p-4">
    <div className="flex items-center justify-between gap-3"><h3 className="text-sm font-semibold">Reviewed memory for this selection</h3><button type="button" onClick={() => setRefreshRevision(value => value + 1)} className="text-xs text-violet-300">Refresh sources</button></div>
    <p className="mt-1 text-xs leading-5 text-slate-500">This is a read-only preview. For an Assistant run with a verified connection mapped to this engagement, the server rechecks and sends up to 20 confirmed project lessons to the AI provider. Project-only or unmapped runs omit memory. Other memory scopes shown here are not sent. Refresh before relying on a changed project.</p>
    {error && <p role="alert" className="mt-3 text-xs text-rose-300">{error}</p>}
    {!context && !error && <p className="mt-3 text-xs text-slate-500">Checking current sources…</p>}
    {context && <div className="mt-4 space-y-4">
      <_MemoryRows label="Organization policies" rows={context.policy} statement="statement" />
      <_MemoryRows label="Project lessons" rows={context.project} statement="statement" />
      <_MemoryRows label="Client and brand requirements" rows={context.clientBrand} statement="statement" />
      {context.clientBrandUnavailable && <p className="text-xs text-slate-500">No active client and brand scope is available for this project.</p>}
      <_MemoryRows label="Department methods" rows={context.department} statement="generalized_statement" />
      {context.departmentUnavailable && <p className="text-xs text-slate-500">Department methods are unavailable to this role.</p>}
    </div>}
  </section>
}
