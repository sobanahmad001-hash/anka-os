import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'

import { useOrganization } from '../context/OrganizationContext.jsx'
import { workItemExperience } from '../data/workItemExperienceRepository.js'
import { WORK_RECORD_TYPES, workRecordState, workshopPathForRecord } from '../data/workItemExperience.js'

const labelize = value => String(value || 'Not set').replaceAll('_', ' ').replace(/\b\w/g, letter => letter.toUpperCase())
const dateLabel = value => value ? new Intl.DateTimeFormat('en', { dateStyle: 'medium' }).format(new Date(value.length === 10 ? `${value}T00:00:00` : value)) : 'Not set'
const isAborted = (error, signal) => Boolean(signal?.aborted || error?.name === 'AbortError' || error?.cause?.name === 'AbortError')

export default function WorkItemDetail() {
  const { recordKind, recordId } = useParams()
  const { activeOrganizationId, selectionRequired, loading: organizationLoading, handleOrganizationAccessError, scopeRevision, requestSignal } = useOrganization()
  const currentScope = useRef(null)
  currentScope.current = { organizationId: activeOrganizationId, revision: scopeRevision }
  const [detail, setDetail] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [denied, setDenied] = useState(false)

  const loadDetail = useCallback(async () => {
    if (organizationLoading || selectionRequired || !activeOrganizationId) return
    const request = { organizationId: activeOrganizationId, revision: scopeRevision, signal: requestSignal }
    setLoading(true); setError(''); setDenied(false)
    try {
      const next = await workItemExperience.getDetail(recordKind, recordId, activeOrganizationId, { signal: requestSignal })
      const current = currentScope.current
      if (request.organizationId === current.organizationId && request.revision === current.revision && !request.signal?.aborted) {
        setDetail(next)
        setDenied(!next)
      }
    } catch (reason) {
      if (!isAborted(reason, requestSignal)) {
        handleOrganizationAccessError(reason, { membershipMismatch: reason.membershipMismatch })
        const current = currentScope.current
        if (request.organizationId === current.organizationId && request.revision === current.revision) {
          setDenied(reason.status === 403 || reason.status === 404)
          setError(reason.message || 'This work record could not be loaded.')
        }
      }
    } finally {
      const current = currentScope.current
      if (request.organizationId === current.organizationId && request.revision === current.revision && !request.signal?.aborted) setLoading(false)
    }
  }, [activeOrganizationId, handleOrganizationAccessError, organizationLoading, recordId, recordKind, requestSignal, scopeRevision, selectionRequired])

  useEffect(() => {
    setDetail(null); setLoading(true); setError(''); setDenied(false)
    if (!organizationLoading && !selectionRequired && activeOrganizationId) loadDetail()
  }, [activeOrganizationId, loadDetail, organizationLoading, scopeRevision, selectionRequired])

  const state = workRecordState(detail)
  const workshopPath = useMemo(() => state === 'ready' ? workshopPathForRecord(detail) : '', [detail, state])

  if (organizationLoading) return <StatePage title="Loading work item" message="Checking organization access…" busy />
  if (selectionRequired || !activeOrganizationId) return <StatePage title="Choose an organization" message="Work-item details stay closed until an active organization is selected." />
  if (loading) return <StatePage title="Loading work item" message="Loading the exact canonical record in the active organization…" busy />
  if (denied || (!detail && !error)) return <StatePage title="Work item unavailable" message="This exact record does not exist in the active organization, was removed, or your current membership cannot read it." denied />
  if (error && !detail) return <StatePage title="Work item could not be loaded" message={error} retry={loadDetail} />

  const { record } = detail
  const typeLabel = detail.kind === WORK_RECORD_TYPES.PROJECT_TASK ? 'Project Task' : 'Engagement Work Item'
  const contextLabel = [detail.project?.name, detail.engagement?.name || detail.workstream?.name].filter(Boolean).join(' · ')

  return <div className="min-h-full bg-slate-950 text-white">
    <header className="border-b border-slate-800 bg-slate-950/95 px-4 py-5 sm:px-6">
      <div className="mx-auto max-w-7xl">
        <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500"><Link className="hover:text-white" to="/sphere/my-work">My Work</Link><span>/</span><span>{typeLabel}</span></div>
        <div className="mt-3 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0"><p className="text-xs font-semibold uppercase tracking-[0.18em] text-purple-400">{typeLabel} · canonical record</p><h1 className="mt-1 text-2xl font-semibold sm:text-3xl">{record.title}</h1><p className="mt-2 text-sm text-slate-400">{contextLabel || 'No project context available'}</p></div>
          <div className="flex flex-wrap gap-2"><Link to={`/sphere/workspace/projects/${encodeURIComponent(record.project_id)}?tab=overview`} className="rounded-xl border border-slate-700 px-4 py-2 text-sm font-semibold text-slate-200 hover:border-purple-500">Project workspace</Link>{workshopPath && <Link to={workshopPath} className="rounded-xl bg-purple-600 px-4 py-2 text-sm font-semibold hover:bg-purple-500">Continue in Workshop</Link>}</div>
        </div>
      </div>
    </header>

    <main className="mx-auto max-w-7xl space-y-5 px-4 py-6 sm:px-6">
      {state === 'stale' && <Notice tone="amber" title="Stale record" message={`This ${typeLabel} is archived or removed. Its available history remains visible, but action links are disabled.`} />}
      {error && <Notice tone="red" title="Some detail could not refresh" message={error} />}

      <section className="grid gap-4 xl:grid-cols-[minmax(0,1.65fr)_minmax(280px,0.75fr)]">
        <Panel title="Description" subtitle="Stored on this exact canonical record."><p className="whitespace-pre-wrap text-sm leading-7 text-slate-300">{record.description || 'No description provided.'}</p>{record.acceptance_criteria && <div className="mt-5 border-t border-slate-800 pt-4"><p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Acceptance criteria</p><p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-300">{record.acceptance_criteria}</p></div>}</Panel>
        <Panel title="Work facts" subtitle="Identity remains specific to its source system."><dl className="grid grid-cols-2 gap-x-4 gap-y-4 text-sm"><Fact label="Record type" value={typeLabel} /><Fact label="Status" value={labelize(record.status)} /><Fact label="Owner" value={detail.owner?.profile?.full_name || (record.assigned_to || record.assignee_id ? 'Active member · profile unavailable' : 'Unassigned')} /><Fact label="Priority" value={labelize(record.priority)} /><Fact label="Start" value={dateLabel(record.start_date)} /><Fact label="Due" value={dateLabel(record.due_date)} /><Fact label="Department" value={labelize(record.department_id)} /><Fact label="Updated" value={dateLabel(record.updated_at)} /></dl></Panel>
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <Dependencies detail={detail} />
        <Outputs detail={detail} />
        <Discussion detail={detail} />
        <History rows={detail.history || []} kind={detail.kind} />
      </section>
    </main>
  </div>
}

function Dependencies({ detail }) {
  const related = new Map((detail.relatedRecords || []).map(item => [item.id, item]))
  const isTask = detail.kind === WORK_RECORD_TYPES.PROJECT_TASK
  const blockedBy = []; const blocks = []
  for (const relation of detail.dependencies || []) {
    const source = isTask ? relation.task_id : relation.work_item_id
    const dependency = isTask ? relation.depends_on_task_id : relation.depends_on_work_item_id
    if (source === detail.record.id && related.get(dependency)) blockedBy.push(related.get(dependency))
    if (dependency === detail.record.id && related.get(source)) blocks.push(related.get(source))
  }
  const parent = detail.record.parent_work_item_id ? related.get(detail.record.parent_work_item_id) : null
  return <Panel title="Dependencies" subtitle="Read from the source record's own dependency system.">{detail.kind === WORK_RECORD_TYPES.ENGAGEMENT_WORK_ITEM && <><RelationList label="Parent" rows={parent ? [parent] : []} kind={detail.kind} /><RelationList label="Subtasks" rows={detail.subtasks || []} kind={detail.kind} /></>}<RelationList label="Blocked by" rows={blockedBy} kind={detail.kind} /><RelationList label="Blocks" rows={blocks} kind={detail.kind} /></Panel>
}

function RelationList({ label, rows, kind }) { return <div className="mt-4 first:mt-0"><p className="text-xs font-semibold uppercase tracking-wider text-slate-500">{label}</p><div className="mt-2 space-y-2">{rows.length ? rows.map(item => <Link key={item.id} to={`/sphere/workspace/items/${kind}/${item.id}`} className="flex items-center justify-between rounded-xl border border-slate-800 bg-slate-950/60 px-3 py-2 text-sm hover:border-purple-700"><span>{item.title}</span><span className="text-xs text-slate-500">{labelize(item.status)}</span></Link>) : <EmptyLine text={`No records this item ${label.toLowerCase()}.`} />}</div></div> }

function Outputs({ detail }) { return <Panel title="Outputs" subtitle={detail.outputAvailability}><div className="space-y-3">{detail.outputs.length ? detail.outputs.map(output => <div key={output.id} className="rounded-xl border border-slate-800 bg-slate-950/60 p-3"><p className="font-medium">{output.title}</p>{output.description && <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-300">{output.description}</p>}<p className="mt-2 text-xs text-slate-500">{labelize(output.artifact_type)}{output.versions.length ? ` · ${output.versions.length} stored version${output.versions.length === 1 ? '' : 's'}` : ''}</p></div>) : <EmptyLine text={detail.outputAvailability} />}</div></Panel> }

function Discussion({ detail }) { return <Panel title="Discussion" subtitle={detail.discussionAvailability === 'available' ? 'Task-linked comments in chronological order.' : 'No cross-record conversation is inferred.'}>{detail.discussion.length ? <div className="space-y-3">{detail.discussion.map(item => <article key={item.id} className="rounded-xl border border-slate-800 bg-slate-950/60 p-3"><p className="whitespace-pre-wrap text-sm text-slate-300">{item.content}</p><p className="mt-2 text-xs text-slate-600">{dateLabel(item.created_at)} · {labelize(item.visibility)}</p></article>)}</div> : <EmptyLine text={detail.discussionAvailability === 'available' ? 'No discussion on this Project Task.' : detail.discussionAvailability} />}</Panel> }

function History({ rows, kind }) { return <Panel title="History" subtitle="Immutable source-system events; no synthetic timeline entries.">{rows.length ? <ol className="space-y-3">{rows.map(item => <li key={item.id} className="border-l border-slate-700 pl-3"><p className="text-sm font-medium">{labelize(kind === WORK_RECORD_TYPES.PROJECT_TASK ? item.action : item.event_type)}</p><p className="mt-1 text-xs text-slate-500">{dateLabel(item.occurred_at)}</p></li>)}</ol> : <EmptyLine text="No readable history events for this record." />}</Panel> }

function Panel({ title, subtitle, children }) { return <section className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5"><h2 className="text-lg font-semibold">{title}</h2><p className="mt-1 text-xs leading-5 text-slate-500">{subtitle}</p><div className="mt-4">{children}</div></section> }
function Fact({ label, value }) { return <div><dt className="text-[10px] font-semibold uppercase tracking-wider text-slate-600">{label}</dt><dd className="mt-1 break-words text-slate-300">{value}</dd></div> }
function EmptyLine({ text }) { return <p className="rounded-xl border border-dashed border-slate-800 px-3 py-5 text-center text-sm text-slate-500">{text}</p> }
function Notice({ tone, title, message }) { const palette = tone === 'red' ? 'border-red-900 bg-red-950/40 text-red-200' : 'border-amber-800 bg-amber-950/40 text-amber-200'; return <div role="status" className={`rounded-2xl border px-4 py-3 ${palette}`}><p className="font-semibold">{title}</p><p className="mt-1 text-sm opacity-90">{message}</p></div> }
function StatePage({ title, message, busy, denied, retry }) { return <div className="flex min-h-full items-center justify-center bg-slate-950 px-4 py-16 text-white"><div className="w-full max-w-lg rounded-2xl border border-slate-800 bg-slate-900/70 p-8 text-center">{busy && <div className="mx-auto mb-5 h-8 w-8 animate-spin rounded-full border-b-2 border-purple-500" />}<p className="text-xs font-semibold uppercase tracking-[0.16em] text-purple-400">{denied ? 'Access boundary' : 'Work-item detail'}</p><h1 className="mt-2 text-xl font-semibold">{title}</h1><p className="mt-3 text-sm leading-6 text-slate-400">{message}</p><div className="mt-6 flex justify-center gap-3"><Link to="/sphere/my-work" className="rounded-xl border border-slate-700 px-4 py-2 text-sm font-semibold">Back to My Work</Link>{retry && <button type="button" onClick={retry} className="rounded-xl bg-purple-600 px-4 py-2 text-sm font-semibold">Try again</button>}</div></div></div> }
