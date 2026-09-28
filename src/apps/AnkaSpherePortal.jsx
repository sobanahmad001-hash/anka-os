import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '../context/AuthContext.jsx'
import { delivery } from '../data/delivery.js'

const TABS = [['overview', 'Progress'], ['deliverables', 'Deliverables'], ['requests', 'Requests'], ['conversation', 'Conversation']]
const INPUT = 'w-full rounded-xl border border-[var(--anka-line)] bg-[var(--anka-canvas)] px-3 py-2.5 text-sm text-[var(--anka-ink)] focus:border-[var(--anka-violet)]'
const labelize = value => String(value || '').replaceAll('_', ' ').replace(/\b\w/g, letter => letter.toUpperCase())
const dateTime = value => value ? new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) : ''

export default function AnkaSpherePortal() {
  const { user, profile } = useAuth()
  const [contact, setContact] = useState(null)
  const [projects, setProjects] = useState([])
  const [selectedId, setSelectedId] = useState('')
  const [portal, setPortal] = useState(null)
  const [activeTab, setActiveTab] = useState('overview')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [revisionTarget, setRevisionTarget] = useState(null)
  const [revision, setRevision] = useState({ title: '', requestedOutput: '', priority: 'medium' })
  const [comment, setComment] = useState('')
  const [feedbackTarget, setFeedbackTarget] = useState(null)
  const [feedback, setFeedback] = useState({ reference: '', content: '' })
  const [approvalTarget, setApprovalTarget] = useState(null)
  const [approvalRationale, setApprovalRationale] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => { if (user?.id) loadProjects() }, [user?.id])
  useEffect(() => {
    if (!selectedId) return undefined
    loadPortal(selectedId)
    return delivery.subscribeClientPortal(selectedId, () => loadPortal(selectedId, false))
  }, [selectedId])

  async function loadProjects() {
    setLoading(true)
    setError('')
    try {
      const [identity, available] = await Promise.all([
        delivery.getClientContact(user.id),
        delivery.listClientPortalProjects(),
      ])
      setContact(identity)
      setProjects(available)
      setSelectedId(current => available.some(item => item.project_id === current) ? current : available[0]?.project_id || '')
    } catch (loadError) {
      setError(loadError.message)
    } finally {
      setLoading(false)
    }
  }

  async function loadPortal(projectId, showLoader = true) {
    if (showLoader) setLoading(true)
    try {
      setPortal(await delivery.getClientPortal(projectId))
    } catch (loadError) {
      setError(loadError.message)
    } finally {
      if (showLoader) setLoading(false)
    }
  }

  async function submitRevision(event) {
    event.preventDefault()
    if (!revisionTarget) return
    setSaving(true)
    setError('')
    try {
      await delivery.submitClientRevision({
        projectId: selectedId,
        deliverableVersionId: revisionTarget.source_id,
        ...revision,
      }, user.id)
      setRevisionTarget(null)
      setRevision({ title: '', requestedOutput: '', priority: 'medium' })
      await loadPortal(selectedId, false)
    } catch (revisionError) {
      setError(revisionError.message)
    } finally {
      setSaving(false)
    }
  }

  async function submitComment(event) {
    event.preventDefault()
    if (!comment.trim()) return
    setSaving(true)
    setError('')
    try {
      await delivery.createClientComment({
        projectId: selectedId,
        entityId: selectedId,
        entityType: 'project',
        content: comment,
        clientContactId: contact?.id,
      }, user.id)
      setComment('')
      await loadPortal(selectedId, false)
    } catch (commentError) {
      setError(commentError.message)
    } finally {
      setSaving(false)
    }
  }

  async function submitVersionFeedback(event) {
    event.preventDefault()
    if (!feedbackTarget || !feedback.reference.trim() || !feedback.content.trim()) return
    setSaving(true)
    setError('')
    try {
      await delivery.createClientComment({
        projectId: selectedId,
        entityId: feedbackTarget.source_id,
        entityType: 'deliverable_version',
        content: feedback.content,
        clientContactId: contact?.id,
        anchor: { kind: 'section', label: feedback.reference.trim() },
      }, user.id)
      setFeedbackTarget(null)
      setFeedback({ reference: '', content: '' })
      await loadPortal(selectedId, false)
    } catch (feedbackError) {
      setError(feedbackError.message)
    } finally {
      setSaving(false)
    }
  }

  async function submitApproval(event) {
    event.preventDefault()
    if (!approvalTarget) return
    setSaving(true)
    setError('')
    try {
      await delivery.recordClientApproval({
        organizationId: approvalTarget.organization_id,
        deliverableVersionId: approvalTarget.source_id,
        expectedStateVersion: approvalTarget.capabilities?.state_version,
        decision: 'approved',
        rationale: approvalRationale,
        requestId: approvalTarget.requestId,
      }, user.id)
      setApprovalTarget(null)
      setApprovalRationale('')
      await loadPortal(selectedId, false)
    } catch (approvalError) {
      setError(approvalError.message)
    } finally {
      setSaving(false)
    }
  }

  async function openFile(item) {
    const previewUrl = item.payload?.preview_url
    if (previewUrl) return window.open(previewUrl, '_blank', 'noopener,noreferrer')
    if (!item.payload?.file_id) return setError('This version has no preview or attached file.')
    try {
      const signedUrl = await delivery.getPortalFileUrl(item.payload.file_id)
      window.open(signedUrl, '_blank', 'noopener,noreferrer')
    } catch (fileError) {
      setError(fileError.message)
    }
  }

  const itemsByType = useMemo(() => {
    const result = { deliverable: [], design_handoff: [], milestone: [], workstream: [], activity: [], report: [] }
    for (const item of portal?.items || []) (result[item.item_type] ||= []).push(item)
    return result
  }, [portal])

  if (loading) return <div className="flex h-full items-center justify-center bg-[var(--anka-canvas)]"><div className="h-8 w-8 animate-spin rounded-full border-b-2 border-[var(--anka-violet)]" /></div>

  return (
    <div className="min-h-full bg-[var(--anka-canvas)] text-[var(--anka-ink)]">
      <header className="border-b border-[var(--anka-line)] bg-[var(--anka-surface)] px-6 py-6">
        <div className="workspace-container flex flex-wrap items-center justify-between gap-4">
          <div><p className="workspace-eyebrow">Anka Sphere Client Portal</p><h1 className="workspace-title">Welcome, {contact?.full_name || profile?.full_name || 'project partner'}</h1><p className="mt-1 text-sm text-[var(--anka-muted)]">Released progress, exact deliverable versions, and feedback in one secure place.</p></div>
          {!contact && <span className="rounded-full border border-[var(--anka-warning)] bg-[var(--anka-warning-soft)] px-3 py-1.5 text-xs text-[var(--anka-warning)]">Internal portal preview</span>}
        </div>
      </header>

      {error && <div className="mx-auto mt-4 max-w-6xl rounded-xl border border-[var(--anka-danger)] bg-[var(--anka-danger-soft)] px-4 py-3 text-sm text-[var(--anka-danger)]">{error}</div>}

      {!projects.length ? <EmptyPortal contact={contact} /> : <div className="workspace-page workspace-container grid gap-6 lg:grid-cols-[260px_1fr]">
        <aside className="space-y-2"><p className="mb-3 text-xs font-semibold uppercase tracking-wider text-[var(--anka-muted)]">Your engagements</p>{projects.map(project => <button key={project.project_id} onClick={() => { setSelectedId(project.project_id); setActiveTab('overview') }} className={`w-full rounded-xl border p-4 text-left ${selectedId === project.project_id ? 'border-[var(--anka-violet)] bg-[var(--anka-violet-soft)]' : 'border-[var(--anka-line)] bg-[var(--anka-surface)] hover:border-[var(--anka-line)]'}`}><p className="font-medium">{project.project_name}</p><p className="mt-1 text-xs text-[var(--anka-muted)]">{labelize(project.engagement_type)} · {labelize(project.status)}</p><span className="mt-3 inline-flex rounded-full bg-[var(--anka-surface-raised)] px-2 py-1 text-[10px] text-[var(--anka-ink)]">{labelize(project.health)}</span></button>)}</aside>
        <section className="min-w-0">
          {portal && <>
            <div className="workspace-card p-5"><div className="flex flex-wrap items-start justify-between gap-4"><div><h2 className="text-xl font-semibold">{portal.project.project_name}</h2><p className="mt-2 max-w-2xl text-sm text-[var(--anka-muted)]">{portal.project.summary || 'Your project team will publish a client-ready summary here.'}</p></div><span className="rounded-full bg-[var(--anka-success-soft)] px-3 py-1 text-xs text-[var(--anka-success)]">Live · {labelize(portal.project.status)}</span></div>{portal.project.next_action && <div className="mt-4 rounded-xl border border-[var(--anka-violet)] bg-[var(--anka-violet-soft)] p-3 text-sm"><span className="font-semibold text-[var(--anka-violet)]">Next action: </span>{portal.project.next_action}</div>}</div>
            <nav className="mt-5 flex gap-1 overflow-x-auto border-b border-[var(--anka-line)]">{TABS.map(([id, label]) => <button key={id} onClick={() => setActiveTab(id)} className={`border-b-2 px-4 py-3 text-sm ${activeTab === id ? 'border-[var(--anka-violet)] text-[var(--anka-ink)]' : 'border-transparent text-[var(--anka-muted)]'}`}>{label}</button>)}</nav>
            <div className="pt-5">
              {activeTab === 'overview' && <ProgressView portal={portal} itemsByType={itemsByType} />}
              {activeTab === 'deliverables' && <><div className="mb-6"><h3 className="mb-3 font-semibold">Design handoffs</h3>{itemsByType.design_handoff.length ? <div className="space-y-3">{itemsByType.design_handoff.map(item => <Record key={item.id} item={item} />)}</div> : <p className="text-sm text-[var(--anka-muted)]">No Design handoff has been released for review.</p>}<p className="mt-2 text-xs text-[var(--anka-muted)]">The team will share client-ready files separately. Internal production ZIPs are not available here.</p></div><DeliverablesView items={itemsByType.deliverable} onOpen={openFile} onFeedback={item => { setFeedbackTarget(item); setFeedback({ reference: '', content: '' }) }} onRevision={item => { setRevisionTarget(item); setRevision({ title: `Revision request: ${item.title}`, requestedOutput: '', priority: 'medium' }) }} onApprove={item => { setApprovalTarget({ ...item, requestId: crypto.randomUUID() }); setApprovalRationale('') }} /></>}
              {activeTab === 'requests' && <RequestsView requests={portal.requests} />}
              {activeTab === 'conversation' && <ConversationView comments={portal.comments} comment={comment} setComment={setComment} onSubmit={submitComment} saving={saving} />}
            </div>
          </>}
        </section>
      </div>}

      {revisionTarget && <Modal title={`Request changes · ${revisionTarget.title}`} onClose={() => setRevisionTarget(null)}><form onSubmit={submitRevision} className="space-y-4"><Field label="Request title"><input required className={INPUT} value={revision.title} onChange={event => setRevision({ ...revision, title: event.target.value })} /></Field><Field label="What should change, and why?"><textarea required rows="5" className={INPUT} value={revision.requestedOutput} onChange={event => setRevision({ ...revision, requestedOutput: event.target.value })} /></Field><Field label="Priority"><select className={INPUT} value={revision.priority} onChange={event => setRevision({ ...revision, priority: event.target.value })}><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option><option value="urgent">Urgent</option></select></Field><button disabled={saving} className="w-full rounded-xl bg-[var(--anka-warning-soft)] px-4 py-2.5 text-sm font-semibold disabled:opacity-50">Submit revision request</button><p className="text-xs text-[var(--anka-muted)]">This request stays linked to version {revisionTarget.payload?.version_number} and appears in the assigned team queue.</p></form></Modal>}
      {feedbackTarget && <Modal title={`Comment on version ${feedbackTarget.payload?.version_number} · ${feedbackTarget.title}`} onClose={() => setFeedbackTarget(null)}><form onSubmit={submitVersionFeedback} className="space-y-4"><Field label="Section, page, frame, or timecode"><input required className={INPUT} value={feedback.reference} onChange={event => setFeedback({ ...feedback, reference: event.target.value })} placeholder="Homepage hero, page 4, frame 12, or 00:18" /></Field><Field label="Comment"><textarea required rows="5" className={INPUT} value={feedback.content} onChange={event => setFeedback({ ...feedback, content: event.target.value })} placeholder="Describe the observation or question for this exact version…" /></Field><button disabled={saving} className="w-full workspace-button workspace-button-primary disabled:opacity-50">Add version comment</button><p className="text-xs text-[var(--anka-muted)]">Use a revision request when the comment requires a tracked change and delivery response.</p></form></Modal>}
      {approvalTarget && <Modal title={`Approve version ${approvalTarget.payload?.version_number} · ${approvalTarget.title}`} onClose={() => setApprovalTarget(null)}><form onSubmit={submitApproval} className="space-y-4"><p className="rounded-xl border border-[var(--anka-success)] bg-[var(--anka-success-soft)] p-3 text-sm text-[var(--anka-success)]">Your approval applies only to this exact released version and becomes part of the permanent project record.</p><Field label="Approval note (optional)"><textarea rows="4" className={INPUT} value={approvalRationale} onChange={event => setApprovalRationale(event.target.value)} placeholder="Add any final confirmation or context…" /></Field><button disabled={saving} className="w-full rounded-xl bg-[var(--anka-success-soft)] px-4 py-2.5 text-sm font-semibold disabled:opacity-50">Confirm approval</button></form></Modal>}
    </div>
  )
}

function ProgressView({ portal, itemsByType }) {
  const progressItems = [...itemsByType.workstream, ...itemsByType.milestone, ...itemsByType.activity]
  return <div className="grid gap-4 md:grid-cols-3"><Stat label="Released items" value={portal.items.length} /><Stat label="Deliverables to review" value={itemsByType.deliverable.filter(item => item.status === 'ready_for_review').length} /><Stat label="Open requests" value={portal.requests.filter(item => !['completed', 'declined', 'withdrawn'].includes(item.status)).length} /><div className="md:col-span-3"><h3 className="mb-3 text-sm font-semibold">Released progress</h3>{progressItems.length ? <div className="space-y-3">{progressItems.map(item => <Record key={item.id} item={item} />)}</div> : <Empty text="The team has not released progress items yet." />}</div></div>
}
function DeliverablesView({ items, onOpen, onFeedback, onRevision, onApprove }) { return <div><div className="mb-4"><h3 className="font-semibold">Released deliverables</h3><p className="mt-1 text-sm text-[var(--anka-muted)]">Only versions that passed internal quality review appear here. Formal actions appear only when the server authorizes this exact version.</p></div>{items.length ? <div className="grid gap-4 md:grid-cols-2">{items.map(item => { const decided = ['client_approved', 'revision_requested'].includes(item.status); return <article key={item.id} className="workspace-card p-5"><p className="text-xs text-[var(--anka-violet)]">Version {item.payload?.version_number}</p><h4 className="mt-1 font-semibold">{item.title}</h4><p className="mt-2 text-sm text-[var(--anka-muted)]">{item.summary || 'Ready for your review.'}</p>{decided && <p className={`mt-3 text-xs font-semibold ${item.status === 'client_approved' ? 'text-[var(--anka-success)]' : 'text-[var(--anka-warning)]'}`}>{labelize(item.status)}</p>}<div className="mt-4 flex flex-wrap gap-2"><button onClick={() => onOpen(item)} className="workspace-button workspace-button-primary">Open version</button><button onClick={() => onFeedback(item)} className="rounded-lg border border-[var(--anka-violet)] px-3 py-2 text-xs text-[var(--anka-violet)]">Comment on version</button>{!decided && <button onClick={() => onRevision(item)} className="rounded-lg border border-[var(--anka-warning)] px-3 py-2 text-xs text-[var(--anka-warning)]">Request revision</button>}{item.capabilities?.can_client_decide && !decided && <button onClick={() => onApprove(item)} className="rounded-lg bg-[var(--anka-success-soft)] px-3 py-2 text-xs font-semibold text-[var(--anka-ink)]">Approve version</button>}</div></article> })}</div> : <Empty text="No deliverables have been released yet." />}</div> }
function RequestsView({ requests }) { return requests.length ? <div className="space-y-3">{requests.map(item => <article key={item.id} className="workspace-card p-4"><div className="flex justify-between gap-3"><div><p className="font-medium">{item.title}</p><p className="mt-1 text-sm text-[var(--anka-muted)]">{item.requested_output}</p></div><span className="h-fit rounded-full bg-[var(--anka-surface-raised)] px-2 py-1 text-xs">{labelize(item.status)}</span></div>{item.resolution && <p className="mt-3 rounded-lg bg-[var(--anka-canvas)] p-3 text-sm text-[var(--anka-success)]">Resolution: {item.resolution}</p>}</article>)}</div> : <Empty text="No revision or client work requests." /> }
function ConversationView({ comments, comment, setComment, onSubmit, saving }) { return <div className="grid gap-5 lg:grid-cols-[1fr_300px]"><div className="space-y-3">{comments.length ? comments.map(item => <article key={item.id} className="workspace-card p-4">{item.entity_type === 'deliverable_version' && <p className="mb-2 text-xs font-medium text-[var(--anka-violet)]">Version comment · {item.anchor?.label || 'Referenced area'}</p>}<p className="text-sm">{item.content}</p><p className="mt-2 text-xs text-[var(--anka-muted)]">{dateTime(item.created_at)}</p></article>) : <Empty text="Start the project conversation here." />}</div><form onSubmit={onSubmit} className="h-fit space-y-3 workspace-card p-4"><Field label="New project message"><textarea required rows="5" className={INPUT} value={comment} onChange={event => setComment(event.target.value)} placeholder="Ask a question or share project context…" /></Field><button disabled={saving || !comment.trim()} className="w-full workspace-button workspace-button-primary disabled:opacity-50">Send message</button></form></div> }
function Record({ item }) { return <article className="rounded-xl border border-[var(--anka-line)] bg-[var(--anka-surface)] p-4"><div className="flex justify-between gap-3"><div><p className="font-medium">{item.title}</p><p className="mt-1 text-sm text-[var(--anka-muted)]">{item.summary}</p></div><span className="h-fit rounded-full bg-[var(--anka-surface-raised)] px-2 py-1 text-xs">{labelize(item.status)}</span></div></article> }
function Stat({ label, value }) { return <div className="workspace-card p-5"><p className="text-3xl font-semibold">{value}</p><p className="mt-1 text-xs uppercase tracking-wider text-[var(--anka-muted)]">{label}</p></div> }
function EmptyPortal({ contact }) { return <div className="mx-auto max-w-xl py-24 text-center"><div className="text-5xl">◌</div><h2 className="mt-5 text-xl font-semibold">No released projects yet</h2><p className="mt-2 text-sm text-[var(--anka-muted)]">{contact ? 'Your Anka Sphere team will publish project progress after the internal quality gate.' : 'Create and release a client project to preview the portal.'}</p></div> }
function Empty({ text }) { return <div className="rounded-2xl border border-dashed border-[var(--anka-line)] py-14 text-center text-sm text-[var(--anka-muted)]">{text}</div> }
function Field({ label, children }) { return <label><span className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-[var(--anka-muted)]">{label}</span>{children}</label> }
function Modal({ title, onClose, children }) { return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4"><div className="max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-2xl border border-[var(--anka-line)] bg-[var(--anka-surface)] p-6"><div className="mb-5 flex justify-between gap-3"><h2 className="text-lg font-semibold">{title}</h2><button onClick={onClose} className="text-sm text-[var(--anka-muted)] hover:text-[var(--anka-ink)]">Close</button></div>{children}</div></div> }
