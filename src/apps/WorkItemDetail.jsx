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

  return <div className="min-h-full bg-[var(--anka-canvas)] text-[var(--anka-ink)]">
    <header className="border-b border-[var(--anka-line)] bg-[var(--anka-surface)] px-4 py-5 sm:px-6">
      <div className="workspace-container">
        <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--anka-muted)]"><Link className="hover:text-[var(--anka-ink)]" to="/sphere/my-work">My Work</Link><span>/</span><span>{typeLabel}</span></div>
        <div className="mt-3 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0"><p className="workspace-eyebrow">{typeLabel} · canonical record</p><h1 className="workspace-title">{record.title}</h1><p className="mt-2 text-sm text-[var(--anka-muted)]">{contextLabel || 'No project context available'}</p></div>
          <div className="flex flex-wrap gap-2"><Link to={`/sphere/workspace/projects/${encodeURIComponent(record.project_id)}?tab=overview`} className="workspace-button">Project workspace</Link>{workshopPath && <Link to={workshopPath} className="workspace-button workspace-button-primary">Continue in Workshop</Link>}</div>
        </div>
      </div>
    </header>

    <main className="workspace-container workspace-page space-y-5">
      {state === 'stale' && <Notice tone="amber" title="Stale record" message={`This ${typeLabel} is archived or removed. Its available history remains visible, but action links are disabled.`} />}
      {error && <Notice tone="red" title="Some detail could not refresh" message={error} />}

      <section className="grid gap-4 xl:grid-cols-[minmax(0,1.65fr)_minmax(280px,0.75fr)]">
        <Panel title="Description" subtitle="Stored on this exact canonical record."><p className="whitespace-pre-wrap text-sm leading-7 text-[var(--anka-ink)]">{record.description || 'No description provided.'}</p>{record.acceptance_criteria && <div className="mt-5 border-t border-[var(--anka-line)] pt-4"><p className="text-xs font-semibold uppercase tracking-wider text-[var(--anka-muted)]">Acceptance criteria</p><p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-[var(--anka-ink)]">{record.acceptance_criteria}</p></div>}</Panel>
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

function RelationList({ label, rows, kind }) { return <div className="mt-4 first:mt-0"><p className="text-xs font-semibold uppercase tracking-wider text-[var(--anka-muted)]">{label}</p><div className="mt-2 space-y-2">{rows.length ? rows.map(item => <Link key={item.id} to={`/sphere/workspace/items/${kind}/${item.id}`} className="flex items-center justify-between rounded-xl border border-[var(--anka-line)] bg-[var(--anka-canvas)] px-3 py-2 text-sm hover:border-[var(--anka-violet)]"><span>{item.title}</span><span className="text-xs text-[var(--anka-muted)]">{labelize(item.status)}</span></Link>) : <EmptyLine text={`No records this item ${label.toLowerCase()}.`} />}</div></div> }

function Outputs({ detail }) { return <Panel title="Outputs" subtitle={detail.outputAvailability}><div className="space-y-3">{detail.outputs.length ? detail.outputs.map(output => <div key={output.id} className="rounded-xl border border-[var(--anka-line)] bg-[var(--anka-canvas)] p-3"><p className="font-medium">{output.title}</p>{output.description && <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-[var(--anka-ink)]">{output.description}</p>}<p className="mt-2 text-xs text-[var(--anka-muted)]">{labelize(output.artifact_type)}{output.versions.length ? ` · ${output.versions.length} stored version${output.versions.length === 1 ? '' : 's'}` : ''}</p></div>) : <EmptyLine text={detail.outputAvailability} />}</div></Panel> }

function Discussion({ detail }) { return <Panel title="Discussion" subtitle={detail.discussionAvailability === 'available' ? 'Task-linked comments in chronological order.' : 'No cross-record conversation is inferred.'}>{detail.discussion.length ? <div className="space-y-3">{detail.discussion.map(item => <article key={item.id} className="rounded-xl border border-[var(--anka-line)] bg-[var(--anka-canvas)] p-3"><p className="whitespace-pre-wrap text-sm text-[var(--anka-ink)]">{item.content}</p><p className="mt-2 text-xs text-[var(--anka-muted)]">{dateLabel(item.created_at)} · {labelize(item.visibility)}</p></article>)}</div> : <EmptyLine text={detail.discussionAvailability === 'available' ? 'No discussion on this Project Task.' : detail.discussionAvailability} />}</Panel> }

function History({ rows, kind }) { return <Panel title="History" subtitle="Immutable source-system events; no synthetic timeline entries.">{rows.length ? <ol className="space-y-3">{rows.map(item => <li key={item.id} className="border-l border-[var(--anka-line)] pl-3"><p className="text-sm font-medium">{labelize(kind === WORK_RECORD_TYPES.PROJECT_TASK ? item.action : item.event_type)}</p><p className="mt-1 text-xs text-[var(--anka-muted)]">{dateLabel(item.occurred_at)}</p></li>)}</ol> : <EmptyLine text="No readable history events for this record." />}</Panel> }

function Panel({ title, subtitle, children }) { return <section className="workspace-card p-5"><h2 className="text-lg font-semibold">{title}</h2><p className="mt-1 text-xs leading-5 text-[var(--anka-muted)]">{subtitle}</p><div className="mt-4">{children}</div></section> }
function Fact({ label, value }) { return <div><dt className="text-[10px] font-semibold uppercase tracking-wider text-[var(--anka-muted)]">{label}</dt><dd className="mt-1 break-words text-[var(--anka-ink)]">{value}</dd></div> }
function EmptyLine({ text }) { return <p className="rounded-xl border border-dashed border-[var(--anka-line)] px-3 py-5 text-center text-sm text-[var(--anka-muted)]">{text}</p> }
function Notice({ tone, title, message }) { const palette = tone === 'red' ? 'border-[var(--anka-danger)] bg-[var(--anka-danger-soft)] text-[var(--anka-danger)]' : 'border-[var(--anka-warning)] bg-[var(--anka-warning-soft)] text-[var(--anka-warning)]'; return <div role="status" className={`rounded-2xl border px-4 py-3 ${palette}`}><p className="font-semibold">{title}</p><p className="mt-1 text-sm opacity-90">{message}</p></div> }
function StatePage({ title, message, busy, denied, retry }) { return <div className="flex min-h-full items-center justify-center bg-[var(--anka-canvas)] px-4 py-16 text-[var(--anka-ink)]"><div className="w-full max-w-lg workspace-card p-8 text-center">{busy && <div className="mx-auto mb-5 h-8 w-8 animate-spin rounded-full border-b-2 border-[var(--anka-violet)]" />}<p className="workspace-eyebrow">{denied ? 'Access boundary' : 'Work-item detail'}</p><h1 className="workspace-title">{title}</h1><p className="mt-3 text-sm leading-6 text-[var(--anka-muted)]">{message}</p><div className="mt-6 flex justify-center gap-3"><Link to="/sphere/my-work" className="workspace-button">Back to My Work</Link>{retry && <button type="button" onClick={retry} className="workspace-button workspace-button-primary">Try again</button>}</div></div></div> }
