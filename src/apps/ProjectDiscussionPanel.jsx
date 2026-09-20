import { useEffect, useRef, useState } from 'react'
import { projectDiscussionRepository } from '../data/projectDiscussionRepository.js'
import _ProjectTaskProposalPanel from './ProjectTaskProposalPanel.jsx'
import _ProjectHandoffPanel from './ProjectHandoffPanel.jsx'

export default function ProjectDiscussionPanel({ organizationId, projectId, tasks, workstreams, scopeRevision, requestSignal, onAccessError, onApplied }) {
  const [page, setPage] = useState(null)
  const [message, setMessage] = useState('')
  const [replyTo, setReplyTo] = useState(null)
  const [sourceCommentId, setSourceCommentId] = useState(null)
  const [loading, setLoading] = useState(true)
  const [loadingOlder, setLoadingOlder] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const requestId = useRef(null)
  const generation = useRef(0)

  useEffect(() => {
    const current = ++generation.current
    setPage(null); setMessage(''); setReplyTo(null); setSourceCommentId(null); setError(''); setLoading(true)
    requestId.current = null
    projectDiscussionRepository.page(organizationId, projectId, null, { signal: requestSignal })
      .then(data => { if (current === generation.current && !requestSignal?.aborted) setPage(data) })
      .catch(cause => {
        if (current === generation.current && cause?.name !== 'AbortError') {
          onAccessError?.(cause, { membershipMismatch: cause.status === 403 })
          setError(cause.message || 'Unable to load project discussion.')
        }
      }).finally(() => { if (current === generation.current) setLoading(false) })
    return () => { generation.current += 1 }
  }, [organizationId, projectId, scopeRevision, requestSignal, onAccessError])

  const loadOlder = async () => {
    if (!page?.has_older || !page.cursor || loadingOlder) return
    const current = generation.current
    setLoadingOlder(true); setError('')
    try {
      const older = await projectDiscussionRepository.page(organizationId, projectId, page.cursor, { signal: requestSignal })
      if (current === generation.current && !requestSignal?.aborted) {
        setPage(latest => ({ ...latest, messages: [...older.messages, ...latest.messages],
          has_older: older.has_older, cursor: older.cursor }))
      }
    } catch (cause) {
      if (current === generation.current && cause?.name !== 'AbortError') {
        onAccessError?.(cause, { membershipMismatch: cause.status === 403 })
        setError(cause.message || 'Unable to load earlier discussion.')
      }
    } finally { if (current === generation.current) setLoadingOlder(false) }
  }

  const post = async event => {
    event.preventDefault()
    if (saving || !message.trim()) return
    const current = generation.current
    const id = requestId.current || globalThis.crypto?.randomUUID?.()
    if (!id) { setError('A secure message ID is unavailable.'); return }
    requestId.current = id
    setSaving(true); setError('')
    try {
      await projectDiscussionRepository.post({ organizationId, projectId, requestId: id,
        content: message, parentCommentId: replyTo?.id || null })
      const latest = await projectDiscussionRepository.page(organizationId, projectId, null, { signal: requestSignal })
      if (current === generation.current && !requestSignal?.aborted) {
        setPage(latest); setMessage(''); setReplyTo(null); requestId.current = null
      }
    } catch (cause) {
      if (current === generation.current && cause?.name !== 'AbortError') {
        onAccessError?.(cause, { membershipMismatch: cause.status === 403 })
        setError(cause.message || 'Unable to post. Retrying keeps the same message ID.')
      }
    } finally { if (current === generation.current) setSaving(false) }
  }

  return <section aria-label="Project discussion" className="space-y-5">
    <div className="rounded-2xl border border-white/[0.07] bg-white/[0.025] p-5">
      <h2 className="font-semibold">Project discussion</h2>
      <p className="mt-1 text-sm text-slate-400">Shared team discussion for this project. Messages record conversation; they do not change scope, work, reviews, or delivery.</p>
      {error && <p role="alert" className="mt-4 rounded-lg border border-rose-500/25 bg-rose-500/10 p-3 text-sm text-rose-200">{error}</p>}
      {loading && <p className="mt-4 text-sm text-slate-400">Loading discussion…</p>}
      {page?.has_older && <button type="button" onClick={loadOlder} disabled={loadingOlder} className="mt-4 rounded-lg border border-white/10 px-3 py-2 text-xs text-slate-300 disabled:opacity-40">{loadingOlder ? 'Loading…' : 'Load earlier messages'}</button>}
      {page && <div className="mt-4 space-y-3">{page.messages.length ? page.messages.map(item => <article id={`project-message-${item.id}`} key={item.id} className={`rounded-xl border border-white/10 p-4 ${item.parent_comment_id ? 'ml-4 border-l-violet-400/40 sm:ml-8' : ''}`}>
        <div className="flex flex-wrap items-center justify-between gap-2"><p className="text-sm font-medium">{item.author_name || 'Team member'} {item.parent_comment_id && <span className="font-normal text-slate-500">· Reply in thread</span>}</p><time className="text-xs text-slate-500" dateTime={item.created_at}>{new Date(item.created_at).toLocaleString()}</time></div>
        <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-300">{item.content}</p>
        <div className="mt-3 flex gap-4">{!item.parent_comment_id && <button type="button" onClick={() => { setReplyTo(item); requestId.current = null }} className="text-xs text-violet-300 hover:text-violet-200">Reply</button>}<button type="button" onClick={() => { setSourceCommentId(item.id); globalThis.document?.getElementById('project-task-proposals')?.scrollIntoView?.({ behavior: 'smooth' }) }} className="text-xs text-violet-300 hover:text-violet-200">Propose task change</button><button type="button" onClick={() => { setSourceCommentId(item.id); globalThis.document?.getElementById('project-handoffs')?.scrollIntoView?.({ behavior: 'smooth' }) }} className="text-xs text-violet-300 hover:text-violet-200">Create handoff</button></div>
      </article>) : <p className="text-sm text-slate-500">No project messages yet.</p>}</div>}
    </div>
    {page && <form onSubmit={post} className="rounded-2xl border border-white/[0.07] bg-white/[0.025] p-5">
      <h3 className="font-medium">{replyTo ? `Reply to ${replyTo.author_name || 'team member'}` : 'New project message'}</h3>
      {replyTo && <button type="button" onClick={() => { setReplyTo(null); requestId.current = null }} className="mt-2 text-xs text-slate-400 hover:text-white">Cancel reply</button>}
      <label className="mt-3 block text-xs text-slate-400">Message<textarea required rows={4} maxLength={8000} value={message} onChange={event => { setMessage(event.target.value); requestId.current = null }} className="mt-1 w-full rounded-xl border border-white/10 bg-[#111622] px-3 py-2 text-sm text-white" /></label>
      <button type="submit" disabled={saving || !message.trim()} className="mt-3 rounded-lg bg-violet-500 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40">{saving ? 'Posting…' : 'Post message'}</button>
    </form>}
    <div id="project-task-proposals"><_ProjectTaskProposalPanel organizationId={organizationId} projectId={projectId} tasks={tasks} sourceCommentId={sourceCommentId} scopeRevision={scopeRevision} requestSignal={requestSignal} onAccessError={onAccessError} onApplied={onApplied} /></div>
    <div id="project-handoffs"><_ProjectHandoffPanel organizationId={organizationId} projectId={projectId} workstreams={workstreams} sourceCommentId={sourceCommentId} scopeRevision={scopeRevision} requestSignal={requestSignal} onAccessError={onAccessError} /></div>
  </section>
}
