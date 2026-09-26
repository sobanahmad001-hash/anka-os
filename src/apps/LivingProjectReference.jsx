import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { useOrganization } from '../context/OrganizationContext.jsx'
import { useAuth } from '../context/AuthContext.jsx'
import { livingProjectReference } from '../data/livingProjectReferenceRepository.js'
import { selectLivingProjectSnapshot } from '../data/livingProjectReference.js'
import { canPreserveReportsSnapshot } from '../data/reportsAndRecordsOperation.js'

const button = 'rounded-xl border border-white/10 px-3 py-2 text-sm text-violet-200 disabled:opacity-40'
const label = value => String(value || 'Not recorded').replaceAll('_', ' ')
const date = value => value ? new Date(value).toLocaleString() : 'Not recorded'
const taskPath = (kind, id) => `/sphere/workspace/items/${kind}/${encodeURIComponent(id)}`
function Section({ title, children }) { return <section className="rounded-2xl border border-white/10 bg-white/[0.025] p-5"><h2 className="mb-4 text-lg font-semibold">{title}</h2>{children}</section> }
function Text({ value }) { return <p className="whitespace-pre-wrap text-sm leading-6 text-slate-300">{value || 'Not recorded in an existing project field.'}</p> }
function Rows({ rows, render, empty = 'No accessible records in this section.' }) { return <div className="space-y-3">{rows.length ? rows.map(render) : <p className="text-sm text-slate-500">{empty}</p>}</div> }

export default function LivingProjectReference() {
  const { projectId } = useParams()
  const [params, setParams] = useSearchParams()
  const { user } = useAuth()
  const { activeOrganizationId, activeMembership, scopeRevision, requestSignal, handleOrganizationAccessError } = useOrganization()
  const [state, setState] = useState(null)
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState(null)
  const request = useRef(0)
  const snapshotRequest = useRef(null)
  const scope = `${activeOrganizationId}:${scopeRevision}:${projectId}:${user?.id}`
  const current = useRef(scope); current.current = scope
  const loaded = state?.scope === scope && state.signal === requestSignal ? state.data : null
  const doc = loaded?.document
  const errorMessage = error?.scope === scope && error.signal === requestSignal ? error.message : ''
  const noticeMessage = notice?.scope === scope && notice.signal === requestSignal ? notice.message : ''
  const load = useCallback(async () => {
    const generation = ++request.current
    if (!activeOrganizationId || !projectId || requestSignal?.aborted) return
    setLoading(true); setError(null)
    try {
      const data = await livingProjectReference.load(activeOrganizationId, projectId, { signal: requestSignal, actorId: user?.id })
      if (generation === request.current && current.current === scope && !requestSignal?.aborted) setState({ scope, signal: requestSignal, data })
    } catch (cause) {
      if (generation === request.current && current.current === scope && !requestSignal?.aborted) {
        setState(null); setError({ scope, signal: requestSignal, message: cause.message }); handleOrganizationAccessError(cause, { membershipMismatch: cause.membershipMismatch })
      }
    } finally { if (generation === request.current && current.current === scope) setLoading(false) }
  }, [activeOrganizationId, projectId, requestSignal, scope, user?.id, handleOrganizationAccessError])
  useEffect(() => { setState(null); setNotice(null); setError(null); setSaving(false); snapshotRequest.current = null; load(); return () => { request.current += 1 } }, [load])
  const preserve = async () => {
    const requestedScope = scope
    if (!doc || !canPreserveReportsSnapshot({ membership: activeMembership, userId: user?.id, projectOwnerId: doc.project.owner_id })) return
    snapshotRequest.current ||= { requestId: crypto.randomUUID(), sourceVersion: doc.sourceVersion }
    setSaving(true); setNotice(null)
    try {
      const saved = await livingProjectReference.preserve({ organizationId: activeOrganizationId, projectId,
        livingRecordId: loaded.records.livingRecord.id, projectionKind: 'internal',
        sourceVersion: snapshotRequest.current.sourceVersion, requestId: snapshotRequest.current.requestId,
        reason: 'Project document record checkpoint',
      }, { signal: requestSignal, actorId: user?.id })
      if (current.current === requestedScope && !requestSignal?.aborted) {
        snapshotRequest.current = null; setNotice({ scope, signal: requestSignal, message: saved.snapshot?.schema_version === 2 ? 'Recorded reference checkpoint preserved, including accessible supplemental sections. Older checkpoints remain unchanged.' : 'Core record checkpoint preserved. Supplementary sections are not included in this older checkpoint schema.' }); await load()
      }
    } catch (cause) {
      if (current.current === requestedScope && !requestSignal?.aborted) {
        setNotice({ scope, signal: requestSignal, message: cause.message + ' Refresh before retrying a changed source version.' }); handleOrganizationAccessError(cause)
        if (cause.status === 409 || cause.cause?.code === '40001') snapshotRequest.current = null
      }
    } finally { if (current.current === requestedScope) setSaving(false) }
  }
  const snapshotId = params.get('snapshot')
  let snapshot = null
  if (snapshotId && doc) { try { snapshot = selectLivingProjectSnapshot(doc.snapshots, snapshotId, activeOrganizationId, projectId, loaded.records.livingRecord.id) } catch { /* Invalid history never falls back to current reference. */ } }
  const selectHistory = id => { const next = new URLSearchParams(params); if (id) next.set('snapshot', id); else next.delete('snapshot'); setParams(next) }
  return <main className="min-h-full bg-slate-950 p-4 text-white sm:p-8"><div className="mx-auto max-w-6xl space-y-5">
    <Link to={`/sphere/workspace/projects/${encodeURIComponent(projectId)}`} className="text-sm text-violet-300">← Project Overview</Link>
    <header className="flex flex-wrap items-start justify-between gap-4"><div><h1 className="text-3xl font-semibold">Living Project Document</h1><p className="mt-2 text-slate-400">{doc?.project.name || 'Exact selected project'} · recorded work, decisions and open changes.</p></div><button className={button} onClick={load} disabled={loading || saving}>{loading ? 'Refreshing…' : 'Refresh current records'}</button></header>
    {errorMessage && <p role="alert" className="text-rose-300">{errorMessage}</p>}{noticeMessage && <p role="status" className="text-amber-200">{noticeMessage}</p>}
    {!doc && !errorMessage && <p className="text-slate-400">{loading ? 'Loading accessible project records…' : 'Select an accessible organization and project.'}</p>}
    {doc && <>
      <Section title="Freshness & version history"><p className="text-sm text-slate-400">Current records loaded {date(doc.loadedAt)} · core source v{doc.sourceVersion}. Refresh reads recorded changes; this is not a live conversation feed.</p><p className="mt-2 text-xs text-amber-200">{doc.coverage}</p>{doc.unavailable.length > 0 && <p className="mt-2 text-xs text-amber-200">Unavailable to this view: {doc.unavailable.join(', ')}. No agreement is inferred from missing data.</p>}<div className="mt-4 flex flex-wrap items-center gap-3"><label className="text-sm">View <select aria-label="Document version" className="ml-2 rounded-lg bg-slate-900 p-2" value={snapshotId || ''} onChange={event => selectHistory(event.target.value)}><option value="">Current composed reference</option>{doc.snapshots.map(row => <option key={row.id} value={row.id}>{label(row.projection_kind)} {row.snapshot?.schema_version === 2 ? 'reference' : 'core'} v{row.source_version} · {date(row.generated_at)}</option>)}</select></label><button className={button} onClick={preserve} disabled={saving || loading || Boolean(snapshotId) || !canPreserveReportsSnapshot({ membership: activeMembership, userId: user?.id, projectOwnerId: doc.project.owner_id })}>{saving ? 'Preserving…' : 'Preserve checkpoint'}</button></div></Section>
      {snapshotId ? snapshot ? <Section title={`Preserved ${label(snapshot.projection_kind)} checkpoint v${snapshot.source_version}`}><p className="mb-3 text-sm text-slate-400">Generated {date(snapshot.generated_at)} · {snapshot.reason}. Only this saved projection is shown; current records are not merged into history.</p><pre className="max-h-[70vh] overflow-auto whitespace-pre-wrap break-words rounded-xl bg-black/20 p-4 text-xs text-slate-300">{JSON.stringify(snapshot.snapshot, null, 2)}</pre></Section> : <p role="alert" className="text-rose-300">This checkpoint is unavailable in the selected project. No current record is shown as history.</p> : <>
        <Section title="Project brief"><h3 className="text-sm font-semibold">Brief</h3><Text value={doc.brief.description} /><h3 className="mt-4 text-sm font-semibold">Objectives</h3><Text value={doc.brief.objective} /><h3 className="mt-4 text-sm font-semibold">Audience</h3><Text value={doc.brief.audience} /><h3 className="mt-4 text-sm font-semibold">Included scope</h3><Text value={doc.brief.scope} /><h3 className="mt-4 text-sm font-semibold">Exclusions</h3><Text value={doc.brief.exclusions} /></Section>
        <Section title="Agreed services & delivery approach"><p className="mb-3 text-xs text-slate-400">Active, paused or completed service records are distinguished from proposals. No new scope is approved here.</p><Rows rows={doc.agreedServices} render={row => <div key={row.id} className="rounded-xl border border-white/10 p-3"><p>{row.name} · {label(row.status)} · quantity {row.quantity}</p><p className="mt-1 text-xs text-slate-400">Service scope {row.id} · revision {row.revision} · {label(row.source)}</p><Text value={row.scope_statement} /></div>} /><div className="mt-4 text-sm"><p>Pipeline: {doc.activeConfiguration ? `Activated configuration revision ${doc.activeConfiguration.revision}` : 'No accessible activated configuration is recorded.'}</p>{doc.activeConfiguration && <p className="mt-2 text-slate-400">{doc.activeConfiguration.selected_steps.map(step => `${step.key} ×${step.quantity}`).join(', ')}</p>}<Link className="mt-3 inline-block text-violet-300" to={`/sphere/workspace/projects/${encodeURIComponent(projectId)}?tab=services`}>Open Services & Pipelines</Link></div></Section>
        <Section title="Approved decisions & confirmed preferences"><Rows rows={doc.decisions} render={row => <div key={row.id} className="rounded-xl border border-white/10 p-3"><Link className="text-violet-300" to={taskPath('project_task', row.task_id)}>Applied task decision: {label(row.before_status)} → {label(row.proposed_status)}</Link><p className="mt-1 text-xs text-slate-400">Proposal {row.id} · decided {date(row.decided_at)}</p></div>} /><div className="mt-4"><Rows rows={doc.confirmedPreferences} render={row => <div key={row.id} className="rounded-xl border border-white/10 p-3"><Text value={row.statement} /><Link className="mt-2 inline-block text-xs text-violet-300" to={`/sphere/workspace/projects/${encodeURIComponent(projectId)}?tab=discussion#project-message-${encodeURIComponent(row.source_comment_id)}`}>Confirmed record {row.id} · source message</Link></div>} empty="No accessible independently confirmed project preferences." /></div></Section>
        <Section title="Recurring delivery plans"><p className="mb-3 text-xs text-slate-400">Recorded approvals and effective dates are shown separately from draft versions. This document does not generate work or change a plan.</p><Rows rows={doc.recurringPlans || []} render={plan => <div key={plan.id} className="rounded-xl border border-white/10 p-3"><p>{plan.name || plan.title || 'Recurring plan'} · {label(plan.status)}</p><Rows rows={plan.versions} render={version => <div key={version.id} className="mt-3 border-t border-white/10 pt-3"><p className="text-sm">Version {version.version_number} · {version.approved ? 'Recorded approval' : 'Draft / no recorded approval'} · {label(version.frequency)} · effective {version.effective_start || 'Not recorded'} to {version.effective_end || 'Open'}</p><Rows rows={version.items} render={item => <p key={item.id} className="mt-2 text-xs text-slate-400">{item.title || item.template_key || 'Template work'} · start offset {item.start_offset_days ?? 'Not recorded'} days · due offset {item.due_offset_days ?? 'Not recorded'} days</p>} /></div>} /></div>} /><Link className="mt-4 inline-block text-sm text-violet-300" to={`/sphere/workspace/projects/${encodeURIComponent(projectId)}?tab=retainer-planning`}>Open recurring planning</Link></Section>
        <Section title="Current delivery plan"><p className="mb-3 text-sm text-slate-400">Project owner: {doc.owner.name} · target {doc.project.due_date || 'Not recorded'}. Planned work is not automatically an agreed scope change.</p><Rows rows={doc.milestones} render={row => <p key={row.id}>{row.name} · {label(row.status)} · target {row.target_date || 'Not recorded'}</p>} /><div className="mt-4"><Rows rows={[...doc.tasks.map(row => ({ ...row, kind: 'project_task' })), ...doc.workItems.map(row => ({ ...row, kind: 'engagement_work_item' }))]} render={row => <Link key={`${row.kind}:${row.id}`} className="block rounded-xl border border-white/10 p-3 text-violet-300" to={taskPath(row.kind, row.id)}>{row.title} · {label(row.kind)} · {label(row.status)} · due {row.due_date || 'Not recorded'}</Link>} /></div></Section>
        <Section title="Open questions & proposed changes"><p className="mb-3 text-xs text-slate-400">These records have not amended the agreed project scope. Approval and application remain separate governed actions.</p><Rows rows={doc.proposedServices} render={row => <p key={row.id}>Proposed service: {row.name} · quantity {row.quantity} · scope revision {row.revision}</p>} /><div className="mt-3"><Rows rows={doc.proposedChanges} render={row => <p key={row.id}>Task change proposal {row.id}: {label(row.before_status)} → {label(row.proposed_status)} · {label(row.status)}</p>} /></div><Link className="mt-4 inline-block text-sm text-violet-300" to={`/sphere/workspace/projects/${encodeURIComponent(projectId)}?tab=discussion`}>Review project proposals in Chat</Link></Section>
      </>}
    </>}
  </div></main>
}
