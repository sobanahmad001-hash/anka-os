import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext.jsx'
import { useOrganization } from '../context/OrganizationContext.jsx'
import { delivery } from '../data/delivery.js'
import { TASK_TRANSITIONS } from '../data/deliveryRepository.js'
import { buildMyWorkPlan, WORK_RECORD_TYPES, workRecordPath } from '../data/workItemExperience.js'

const TABS = [
  ['overview', 'Readiness'],
  ['tasks', 'Project Tasks'],
  ['engagement-work', 'Engagement Work Items'],
  ['handoffs', 'Requests & Handoffs'],
  ['deliverables', 'My Deliverables'],
  ['review', 'Internal Review'],
  ['release', 'Client Release'],
]
const INPUT = 'w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white outline-none focus:border-purple-500'

const isAbortedRequest = (error, signal) => Boolean(signal?.aborted || error?.name === 'AbortError' || error?.cause?.name === 'AbortError')
const isCurrentOrganizationScope = (request, current) => Boolean(
  request?.organizationId &&
  request.organizationId === current?.organizationId &&
  request.revision === current?.revision &&
  !request.signal?.aborted
)
const isBefore = (value, today) => Boolean(value && new Date(`${value.slice(0, 10)}T00:00:00Z`) < today)
const readinessFor = (rows, isOpen, dateField, today) => {
  const open = rows.filter(isOpen)
  return {
    total: open.length,
    blocked: open.filter(item => item.status === 'blocked').length,
    overdue: open.filter(item => isBefore(item[dateField], today)).length,
  }
}
const buildMyWorkReadiness = (workspace = {}) => {
  const today = new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00Z`)
  return {
    projectTasks: readinessFor(workspace.tasks || [], item => !['done', 'cancelled'].includes(item.status), 'due_date', today),
    engagementWorkItems: readinessFor(workspace.workItems || [], item => item.status !== 'done', 'due_date', today),
    requests: readinessFor(workspace.requests || [], item => !['completed', 'declined', 'withdrawn'].includes(item.status), 'required_by', today),
    deliverables: readinessFor(workspace.deliverables || [], item => !['delivered_published', 'withdrawn', 'archived'].includes(item.status), 'due_date', today),
    internalReviews: { total: (workspace.reviewVersions || []).length },
    controlledReleases: { total: (workspace.releaseVersions || []).length },
  }
}

const labelize = value => String(value || '').replaceAll('_', ' ').replace(/\b\w/g, letter => letter.toUpperCase())
const dateLabel = value => value ? new Intl.DateTimeFormat('en', { dateStyle: 'medium' }).format(new Date(`${value}T00:00:00`)) : 'No deadline'

export default function MyWork() {
  const { user } = useAuth()
  const { activeOrganizationId, selectionRequired, loading: organizationLoading, handleOrganizationAccessError, scopeRevision, requestSignal } = useOrganization()
  const currentScope = useRef(null)
  currentScope.current = { organizationId: activeOrganizationId, revision: scopeRevision }
  const [workspace, setWorkspace] = useState(null)
  const [activeTab, setActiveTab] = useState('overview')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState('')
  const [error, setError] = useState('')
  const [versionTarget, setVersionTarget] = useState(null)
  const [versionForm, setVersionForm] = useState({ title: '', changeSummary: '', previewUrl: '', file: null })
  const [reviewTarget, setReviewTarget] = useState(null)
  const [reviewForm, setReviewForm] = useState({ decision: 'approved', rationale: '', quality: true, brief: true, technical: true })

  const loadWorkspace = useCallback(async () => {
    if (!user?.id || organizationLoading || selectionRequired || !activeOrganizationId) return
    const requestedScope = { organizationId: activeOrganizationId, revision: scopeRevision, signal: requestSignal }
    setLoading(true)
    setError('')
    try {
      const next = await delivery.getMyWork(user.id, activeOrganizationId, { signal: requestSignal })
      if (isCurrentOrganizationScope(requestedScope, currentScope.current)) setWorkspace(next)
    } catch (loadError) {
      if (!isAbortedRequest(loadError, requestSignal) && isCurrentOrganizationScope(requestedScope, currentScope.current)) {
        handleOrganizationAccessError(loadError, { membershipMismatch: loadError.membershipMismatch })
        setError(loadError.message)
      }
    } finally {
      if (isCurrentOrganizationScope(requestedScope, currentScope.current)) setLoading(false)
    }
  }, [activeOrganizationId, handleOrganizationAccessError, organizationLoading, requestSignal, scopeRevision, selectionRequired, user?.id])

  useEffect(() => {
    setWorkspace(null); setActiveTab('overview'); setLoading(true); setSaving(''); setError('')
    setVersionTarget(null); setVersionForm({ title: '', changeSummary: '', previewUrl: '', file: null })
    setReviewTarget(null); setReviewForm({ decision: 'approved', rationale: '', quality: true, brief: true, technical: true })
    if (user?.id && !organizationLoading && !selectionRequired && activeOrganizationId) loadWorkspace()
  }, [activeOrganizationId, loadWorkspace, organizationLoading, scopeRevision, selectionRequired, user?.id])

  async function mutate(key, action) {
    setSaving(key)
    setError('')
    try {
      await action()
      await loadWorkspace()
    } catch (mutationError) {
      handleOrganizationAccessError(mutationError, { membershipMismatch: mutationError.membershipMismatch })
      setError(mutationError.message)
    } finally {
      setSaving('')
    }
  }

  function createVersion(event) {
    event.preventDefault()
    if (!versionTarget) return
    mutate(`version-${versionTarget.id}`, async () => {
      await delivery.createDeliverableVersion({
        projectId: versionTarget.project_id,
        deliverableId: versionTarget.id,
        ...versionForm,
      }, user.id)
      setVersionTarget(null)
      setVersionForm({ title: '', changeSummary: '', previewUrl: '', file: null })
    })
  }

  function decideReview(event) {
    event.preventDefault()
    if (!reviewTarget) return
    mutate(`review-${reviewTarget.id}`, async () => {
      await delivery.recordInternalQualityDecision({
        projectId: reviewTarget.project_id,
        deliverableId: reviewTarget.deliverable_id,
        deliverableVersionId: reviewTarget.id,
        decision: reviewForm.decision,
        rationale: reviewForm.rationale,
        checklistResult: {
          quality_standard: reviewForm.quality,
          matches_brief: reviewForm.brief,
          technically_ready: reviewForm.technical,
        },
      }, user.id)
      setReviewTarget(null)
      setReviewForm({ decision: 'approved', rationale: '', quality: true, brief: true, technical: true })
    })
  }

  const readiness = useMemo(() => buildMyWorkReadiness(workspace || {}), [workspace])
  const plan = useMemo(() => buildMyWorkPlan(workspace || {}), [workspace])

  if (organizationLoading) return <QueueState title="Loading My Work" message="Checking your organization access…" busy />
  if (selectionRequired || !activeOrganizationId) return <QueueState title="Choose an organization" message="My Work stays closed until an active organization is selected." />
  if (loading) return <QueueState title="Loading My Work" message="Loading your active-organization personal queues…" busy />
  if (error && !workspace) return <QueueState title="My Work could not be loaded" message={error} retry={loadWorkspace} />

  return (
    <div className="min-h-full bg-slate-950 text-white">
      <header className="border-b border-slate-800 bg-slate-950/95 px-6 py-5">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-purple-400">Personal operating queue</p>
        <div className="mt-1 flex flex-wrap items-end justify-between gap-4">
          <div><h1 className="text-2xl font-semibold">My Work</h1><p className="mt-1 text-sm text-slate-400">Personal readiness and supported actions across assignments, handoffs, exact-version review, and controlled release.</p></div>
          <div className="flex flex-wrap gap-3"><Metric label="Project Tasks" value={readiness.projectTasks.total} /><Metric label="Engagement Work Items" value={readiness.engagementWorkItems.total} /><Metric label="Awaiting review" value={readiness.internalReviews.total} /><Metric label="Ready to release" value={readiness.controlledReleases.total} /></div>
        </div>
      </header>

      {error && <div role="status" className="mx-6 mt-4 rounded-xl border border-amber-900 bg-amber-950/50 px-4 py-3 text-sm text-amber-200">The queue could not refresh. The last loaded organization-scoped results remain visible. {error}</div>}

      <nav className="flex gap-1 overflow-x-auto border-b border-slate-800 px-6 pt-4">
        {TABS.map(([id, label]) => <button key={id} onClick={() => setActiveTab(id)} className={`whitespace-nowrap border-b-2 px-4 py-3 text-sm ${activeTab === id ? 'border-purple-500 text-white' : 'border-transparent text-slate-500 hover:text-slate-200'}`}>{label}</button>)}
      </nav>

      <main className="p-6">
        {activeTab === 'overview' && <ReadinessOverview readiness={readiness} plan={plan} />}
        {activeTab === 'tasks' && <TaskQueue tasks={workspace?.tasks || []} saving={saving} onTransition={(task, status) => mutate(`task-${task.id}`, () => delivery.transitionTask(task.id, status))} />}
        {activeTab === 'engagement-work' && <WorkItemQueue items={workspace?.workItems || []} />}
        {activeTab === 'handoffs' && <RequestQueue requests={workspace?.requests || []} />}
        {activeTab === 'deliverables' && <DeliverableQueue deliverables={workspace?.deliverables || []} saving={saving} onCreateVersion={item => { setVersionTarget(item); setVersionForm({ title: item.title, changeSummary: '', previewUrl: '', file: null }) }} onSubmitReview={version => mutate(`submit-${version.id}`, () => delivery.transitionDeliverableVersion(version.id, 'ready_for_internal_review'))} />}
        {activeTab === 'review' && <ReviewQueue versions={workspace?.reviewVersions || []} onReview={setReviewTarget} />}
        {activeTab === 'release' && <ReleaseQueue versions={workspace?.releaseVersions || []} saving={saving} onRelease={version => mutate(`release-${version.id}`, () => delivery.releaseDeliverableVersion({ projectId: version.project_id, deliverableId: version.deliverable_id, deliverableVersionId: version.id }, user.id))} />}
      </main>

      {versionTarget && <Modal title={`Create a new version · ${versionTarget.title}`} onClose={() => setVersionTarget(null)}><form onSubmit={createVersion} className="space-y-4"><Field label="Version title"><input required className={INPUT} value={versionForm.title} onChange={event => setVersionForm({ ...versionForm, title: event.target.value })} /></Field><Field label="Change summary"><textarea className={INPUT} rows="3" value={versionForm.changeSummary} onChange={event => setVersionForm({ ...versionForm, changeSummary: event.target.value })} /></Field><Field label="Preview URL (optional)"><input type="url" className={INPUT} value={versionForm.previewUrl} onChange={event => setVersionForm({ ...versionForm, previewUrl: event.target.value })} /></Field><Field label="File (optional)"><input type="file" className={INPUT} onChange={event => setVersionForm({ ...versionForm, file: event.target.files?.[0] || null })} /></Field><button disabled={Boolean(saving)} className="w-full rounded-xl bg-purple-600 px-4 py-2.5 text-sm font-semibold disabled:opacity-50">Save immutable version</button></form></Modal>}

      {reviewTarget && <Modal title={`Internal quality review · ${reviewTarget.title}`} onClose={() => setReviewTarget(null)}><form onSubmit={decideReview} className="space-y-4"><div className="space-y-2">{[['quality', 'Meets Anka Sphere quality standard'], ['brief', 'Matches the approved brief'], ['technical', 'Technically ready to share']].map(([key, label]) => <label key={key} className="flex items-center gap-3 rounded-xl border border-slate-800 p-3 text-sm"><input type="checkbox" checked={reviewForm[key]} onChange={event => setReviewForm({ ...reviewForm, [key]: event.target.checked })} />{label}</label>)}</div><Field label="Decision"><select className={INPUT} value={reviewForm.decision} onChange={event => setReviewForm({ ...reviewForm, decision: event.target.value })}><option value="approved">Approve for client-ready stage</option><option value="changes_required">Changes required</option></select></Field><Field label="Review rationale"><textarea required className={INPUT} rows="4" value={reviewForm.rationale} onChange={event => setReviewForm({ ...reviewForm, rationale: event.target.value })} /></Field><button disabled={Boolean(saving) || (reviewForm.decision === 'approved' && (!reviewForm.quality || !reviewForm.brief || !reviewForm.technical))} className="w-full rounded-xl bg-purple-600 px-4 py-2.5 text-sm font-semibold disabled:opacity-50">Record human decision</button></form></Modal>}
    </div>
  )
}

function TaskQueue({ tasks, saving, onTransition }) {
  return <Section title="Project Tasks" description="Canonical Project Tasks assigned through assigned_to. Only existing valid lifecycle moves are shown.">{tasks.length ? tasks.map(task => <Card key={task.id} title={<Link className="hover:text-purple-300" to={workRecordPath(WORK_RECORD_TYPES.PROJECT_TASK, task.id)}>{task.title}</Link>} context={`${task.projects?.name || 'Project'} · ${task.workstreams?.name || labelize(task.department_id)}`} status={task.status} meta={`Due ${dateLabel(task.due_date)}`}><div className="mt-3 flex flex-wrap gap-2">{(TASK_TRANSITIONS[task.status] || []).map(status => <button key={status} disabled={saving === `task-${task.id}`} onClick={() => onTransition(task, status)} className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-300 hover:border-purple-500 hover:text-white disabled:opacity-50">Move to {labelize(status)}</button>)}</div></Card>) : <Empty text="No assigned Project Tasks." />}</Section>
}

function WorkItemQueue({ items }) {
  return <Section title="Engagement Work Items" description="Engagement-level assignments use assignee_id and remain separate from Project Tasks. Supported actions stay in the owning engagement.">{items.length ? items.map(item => <Card key={item.id} title={<Link className="hover:text-purple-300" to={workRecordPath(WORK_RECORD_TYPES.ENGAGEMENT_WORK_ITEM, item.id)}>{item.title}</Link>} context={`${item.projects?.name || 'Project'} · ${item.engagements?.name || 'Engagement'}`} status={item.status} meta={`Due ${dateLabel(item.due_date)}`}><p className="mt-3 text-sm text-slate-400">{item.description || 'No description provided.'}</p></Card>) : <Empty text="No assigned Engagement Work Items." />}</Section>
}

function ReadinessOverview({ readiness, plan }) {
  const rows = [
    ['Project Tasks', readiness.projectTasks, 'Assigned through the canonical Project Task owner field.'],
    ['Engagement Work Items', readiness.engagementWorkItems, 'Assigned through the engagement Work Item assignee field.'],
    ['Requests & handoffs', readiness.requests, 'Owned by you or requested by you.'],
    ['My deliverables', readiness.deliverables, 'Deliverables using the existing owner field.'],
  ]
  return <div className="mx-auto max-w-5xl space-y-6"><section><div className="mb-4"><h2 className="text-lg font-semibold">What to do next</h2><p className="mt-1 text-sm text-slate-500">{plan.scope}. Next-up range: {plan.range}. Later and undated work remain visible.</p></div><div className="grid gap-3 lg:grid-cols-3"><NextActionGroup title="Overdue" rows={plan.overdue} tone="red" empty="Nothing overdue." /><NextActionGroup title={`Due in ${plan.horizonDays} days`} rows={plan.next} tone="purple" empty="Nothing due in this range." /><NextActionGroup title="Blocked" rows={plan.blocked} tone="amber" empty="Nothing blocked." /></div><div className="mt-3 rounded-2xl border border-slate-800 bg-slate-900/70 px-4 py-3 text-sm text-slate-400">Beyond the next-up range: <span className="font-semibold text-white">{plan.later.length}</span> later-dated · <span className="font-semibold text-white">{plan.undated.length}</span> undated</div></section><section><div className="mb-4"><h2 className="text-lg font-semibold">Personal readiness</h2><p className="mt-1 text-sm text-slate-500">Each work system remains separately counted.</p></div><div className="grid gap-3 md:grid-cols-2">{rows.map(([title, item, note]) => <div key={title} className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4"><div className="flex items-center justify-between gap-3"><p className="font-medium">{title}</p><span className="text-2xl font-semibold">{item.total}</span></div><p className="mt-2 text-xs text-slate-500">{item.blocked || 0} blocked · {item.overdue || 0} overdue</p><p className="mt-3 text-sm leading-6 text-slate-400">{note}</p></div>)}</div><div className="mt-3 grid gap-3 md:grid-cols-2"><div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4"><p className="font-medium">Exact-version internal review</p><p className="mt-2 text-2xl font-semibold">{readiness.internalReviews.total}</p></div><div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4"><p className="font-medium">Controlled client release</p><p className="mt-2 text-2xl font-semibold">{readiness.controlledReleases.total}</p></div></div></section></div>
}

function NextActionGroup({ title, rows, tone, empty }) { const palette = tone === 'red' ? 'border-red-900/60' : tone === 'amber' ? 'border-amber-900/60' : 'border-purple-900/60'; return <section className={`rounded-2xl border ${palette} bg-slate-900/70 p-4`}><div className="flex items-center justify-between"><h3 className="font-semibold">{title}</h3><span className="rounded-full bg-slate-800 px-2 py-0.5 text-xs">{rows.length}</span></div><div className="mt-3 space-y-2">{rows.length ? rows.slice(0, 5).map(item => <Link key={`${item.kind}-${item.id}`} to={item.path} className="block rounded-xl bg-slate-950/70 px-3 py-2 hover:bg-slate-950"><p className="truncate text-sm font-medium">{item.title}</p><p className="mt-1 text-[11px] text-slate-500">{item.kind === WORK_RECORD_TYPES.PROJECT_TASK ? 'Project Task' : 'Engagement Work Item'} · {item.dueDate ? `Due ${dateLabel(item.dueDate)}` : 'No deadline'}</p></Link>) : <p className="py-4 text-center text-sm text-slate-500">{empty}</p>}</div></section> }

function RequestQueue({ requests }) {
  return <Section title="Requests and handoffs" description="Incoming work and requests you created remain linked to the project.">{requests.length ? requests.map(item => <Card key={item.id} title={item.title} context={item.projects?.name || 'Project'} status={item.status} meta={`${labelize(item.request_type)} · Due ${dateLabel(item.required_by)}`}><p className="mt-3 text-sm text-slate-400">{item.requested_output}</p></Card>) : <Empty text="No requests assigned or created by you." />}</Section>
}

function DeliverableQueue({ deliverables, saving, onCreateVersion, onSubmitReview }) {
  return <Section title="My deliverables" description="Create immutable versions, then deliberately submit the exact version for internal review.">{deliverables.length ? deliverables.map(item => <Card key={item.id} title={item.title} context={`${item.projects?.name || 'Project'} · ${item.workstreams?.name || 'Workstream'}`} status={item.status} meta={`Due ${dateLabel(item.due_date)}`}><div className="mt-3 space-y-2">{(item.deliverable_versions || []).sort((a, b) => b.version_number - a.version_number).map(version => <div key={version.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-slate-950 px-3 py-2 text-xs"><span>Version {version.version_number} · {labelize(version.review_status)}</span>{version.review_status === 'in_production' && <button disabled={saving === `submit-${version.id}`} onClick={() => onSubmitReview(version)} className="rounded-lg bg-amber-700 px-3 py-1.5 font-semibold text-white disabled:opacity-50">Submit for internal review</button>}</div>)}</div><button onClick={() => onCreateVersion(item)} className="mt-3 rounded-lg border border-purple-700 px-3 py-1.5 text-xs text-purple-300 hover:bg-purple-950">+ New version</button></Card>) : <Empty text="No deliverables assigned to you." />}</Section>
}

function ReviewQueue({ versions, onReview }) {
  return <Section title="Internal quality review" description="A human reviewer must evaluate the exact immutable version before client release.">{versions.length ? versions.map(version => <Card key={version.id} title={version.title} context={`${version.projects?.name || 'Project'} · ${version.deliverables?.title || 'Deliverable'}`} status={version.review_status} meta={`Version ${version.version_number}`}><p className="mt-3 text-sm text-slate-400">{version.change_summary || 'No change summary provided.'}</p><button onClick={() => onReview(version)} className="mt-3 rounded-lg bg-purple-600 px-3 py-1.5 text-xs font-semibold">Open review</button></Card>) : <Empty text="Nothing is waiting for internal review." />}</Section>
}

function ReleaseQueue({ versions, saving, onRelease }) {
  return <Section title="Approved client-ready versions" description="Release creates a sanitized portal item and moves only this exact version into client review.">{versions.length ? versions.map(version => <Card key={version.id} title={version.title} context={`${version.projects?.name || 'Project'} · ${version.deliverables?.title || 'Deliverable'}`} status={version.review_status} meta={`Version ${version.version_number}`}><button disabled={saving === `release-${version.id}` || !version.projects?.client_id} onClick={() => onRelease(version)} className="mt-3 rounded-lg bg-emerald-700 px-3 py-1.5 text-xs font-semibold disabled:opacity-40">{version.projects?.client_id ? 'Release to client portal' : 'Internal project — cannot release'}</button></Card>) : <Empty text="No approved versions are waiting for client release." />}</Section>
}

function Section({ title, description, children }) { return <section className="mx-auto max-w-5xl"><div className="mb-4"><h2 className="text-lg font-semibold">{title}</h2><p className="mt-1 text-sm text-slate-500">{description}</p></div><div className="space-y-3">{children}</div></section> }
function Card({ title, context, status, meta, children }) { return <article className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4"><div className="flex flex-wrap justify-between gap-3"><div><p className="font-medium">{title}</p><p className="mt-1 text-xs text-slate-500">{context} · {meta}</p></div><span className="h-fit rounded-full bg-slate-800 px-2.5 py-1 text-[11px] font-semibold text-slate-300">{labelize(status)}</span></div>{children}</article> }
function Empty({ text }) { return <div className="rounded-2xl border border-dashed border-slate-800 py-16 text-center text-sm text-slate-500">{text}</div> }
function Metric({ label, value }) { return <div className="min-w-24 rounded-xl border border-slate-800 bg-slate-900 px-3 py-2"><p className="text-lg font-semibold">{value}</p><p className="text-[10px] uppercase tracking-wider text-slate-500">{label}</p></div> }
function Field({ label, children }) { return <label><span className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-slate-400">{label}</span>{children}</label> }
function Modal({ title, onClose, children }) { return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4"><div className="max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-2xl border border-slate-700 bg-slate-900 p-6 shadow-2xl"><div className="mb-5 flex justify-between gap-4"><h2 className="text-lg font-semibold">{title}</h2><button onClick={onClose} className="text-slate-500 hover:text-white">Close</button></div>{children}</div></div> }
function QueueState({ title, message, busy, retry }) { return <div className="flex min-h-full items-center justify-center bg-slate-950 px-4 py-16 text-white"><div className="w-full max-w-lg rounded-2xl border border-slate-800 bg-slate-900/70 p-8 text-center">{busy && <div className="mx-auto mb-5 h-8 w-8 animate-spin rounded-full border-b-2 border-purple-500" />}<p className="text-xs font-semibold uppercase tracking-[0.16em] text-purple-400">Personal operating queue</p><h1 className="mt-2 text-xl font-semibold">{title}</h1><p className="mt-3 text-sm leading-6 text-slate-400">{message}</p>{retry && <button type="button" onClick={retry} className="mt-6 rounded-xl bg-purple-600 px-4 py-2 text-sm font-semibold">Try again</button>}</div></div> }
