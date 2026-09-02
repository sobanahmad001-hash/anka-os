import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAuth } from '../context/AuthContext.jsx'
import { proofing } from '../data/proofingRepository.js'

const THEMES = {
  amber: { border: 'border-amber-500/30', text: 'text-amber-300', button: 'bg-amber-600 hover:bg-amber-500' },
  emerald: { border: 'border-emerald-500/30', text: 'text-emerald-300', button: 'bg-emerald-600 hover:bg-emerald-500' },
  violet: { border: 'border-violet-500/30', text: 'text-violet-300', button: 'bg-violet-600 hover:bg-violet-500' },
}

function positionLabel(position) {
  if (position?.region) return position.region.replace(/^page:/, 'Page: ')
  if (Number.isFinite(position?.x) && Number.isFinite(position?.y)) {
    return `Visual point ${Math.round(position.x * 100)}%, ${Math.round(position.y * 100)}%`
  }
  return 'General comment'
}

function personLabel(profile, id) {
  return profile?.full_name || profile?.email || `Team member ${String(id || '').slice(0, 8)}`
}

export default function VersionProofingPanel({
  targetKind, versions, department, theme = 'amber', regionsByVersion = {},
  initialVersionId = '', visualAnchor = null, visualAnchorVersionId = '', onClearVisualAnchor = null,
}) {
  const { user, profile } = useAuth()
  const normalizedVersions = Array.isArray(versions) ? versions : []
  const isContentRequest = targetKind === 'content_request'
  const ordered = useMemo(() => [...normalizedVersions].sort((a, b) => (isContentRequest ? 0 : (b.version_number - a.version_number))), [isContentRequest, normalizedVersions])
  const [versionId, setVersionId] = useState(initialVersionId || ordered[0]?.id || '')
  const [comments, setComments] = useState([])
  const [body, setBody] = useState('')
  const [region, setRegion] = useState('')
  const [unresolvedOnly, setUnresolvedOnly] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const colors = THEMES[theme] || THEMES.amber
  const selected = ordered.find(item => item.id === versionId) || ordered[0] || null
  const regions = regionsByVersion?.[selected?.id] || []
  const activeVisualAnchor = isContentRequest || selected?.id === visualAnchorVersionId ? visualAnchor : null

  useEffect(() => {
    if (initialVersionId) setVersionId(initialVersionId)
  }, [initialVersionId])

  const load = useCallback(async id => {
    if (!id) return setComments([])
    setLoading(true); setError('')
    try { setComments(await proofing.list(targetKind, id)) }
    catch (reason) { setError(reason.message) }
    finally { setLoading(false) }
  }, [targetKind])

  useEffect(() => { if (selected?.id) load(selected.id) }, [selected?.id, load])

  async function submit(event) {
    event.preventDefault()
    if (!selected) return
    setLoading(true); setError('')
    try {
      const position = activeVisualAnchor || (region ? { region } : null)
      await proofing.add(targetKind, selected.id, body, position)
      setBody(''); setRegion(''); onClearVisualAnchor?.()
      await load(selected.id)
    } catch (reason) { setError(reason.message); setLoading(false) }
  }

  async function resolve(commentId) {
    setLoading(true); setError('')
    try { await proofing.resolve(commentId); await load(selected.id) }
    catch (reason) { setError(reason.message); setLoading(false) }
  }

  function canResolve(comment) {
    if (comment.author_id === user?.id) return true
    if (['admin', 'executive'].includes(profile?.role)) return true
    return profile?.role === 'department_head' && profile?.department === department
  }

  const visible = unresolvedOnly ? comments.filter(item => !item.resolved) : comments
  const unresolved = comments.filter(item => !item.resolved).length
  if (!ordered.length) return null

  return <section className={`mt-6 rounded-2xl border ${colors.border} bg-slate-950/50 p-5`}>
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div><p className={`text-xs font-semibold uppercase tracking-[0.14em] ${colors.text}`}>Exact-version proofing</p><h3 className="mt-1 font-semibold text-white">{isContentRequest ? 'Request comments' : 'Comments and resolution'}</h3><p className="mt-1 text-xs leading-5 text-slate-500">{isContentRequest ? 'Feedback stays on this exact request until it is replaced by a new one.' : 'Feedback stays on this exact immutable version and never moves to a later revision.'}</p></div>
      {!isContentRequest && <label className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Version
        <select value={selected?.id || ''} onChange={event => { setVersionId(event.target.value); setRegion(''); onClearVisualAnchor?.() }} className="ml-2 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs normal-case text-white">
          {ordered.map(item => <option key={item.id} value={item.id}>Version {item.version_number}</option>)}
        </select>
      </label>}
    </div>

    <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-y border-slate-800 py-3 text-xs text-slate-400"><span>{comments.length} comment{comments.length === 1 ? '' : 's'} · {unresolved} unresolved</span><label className="flex items-center gap-2"><input type="checkbox" checked={unresolvedOnly} onChange={event => setUnresolvedOnly(event.target.checked)} />Unresolved only</label></div>
    {error && <div className="mt-4 rounded-xl border border-red-900/50 bg-red-950/30 px-3 py-2 text-sm text-red-300">{error}</div>}
    <div className="mt-4 space-y-3">
      {loading && !comments.length ? <p className="py-5 text-center text-sm text-slate-500">Loading proofing thread…</p> : visible.map(comment => <article key={comment.id} className={`rounded-xl border p-4 ${comment.resolved ? 'border-slate-800 bg-slate-900/30 opacity-75' : 'border-slate-700 bg-slate-900/70'}`}>
        <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-sm font-semibold text-white">{personLabel(comment.author, comment.author_id)}</p><p className="mt-1 text-[11px] text-slate-500">{new Date(comment.created_at).toLocaleString()} · {positionLabel(comment.comment_position)}</p></div><span className={`rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase ${comment.resolved ? 'bg-emerald-950 text-emerald-300' : 'bg-amber-950 text-amber-300'}`}>{comment.resolved ? 'Resolved' : 'Open'}</span></div>
        <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-slate-300">{comment.body}</p>
        {comment.resolved ? <p className="mt-3 text-xs text-slate-500">Resolved by {personLabel(comment.resolver, comment.resolved_by)} · {new Date(comment.resolved_at).toLocaleString()}</p> : canResolve(comment) && <button type="button" disabled={loading} onClick={() => resolve(comment.id)} className="mt-3 rounded-lg border border-slate-700 px-3 py-1.5 text-xs font-semibold text-slate-300 hover:border-emerald-500 hover:text-white">Mark resolved</button>}
      </article>)}
      {!visible.length && !loading && <p className="rounded-xl border border-dashed border-slate-800 py-6 text-center text-sm text-slate-600">{unresolvedOnly ? 'No unresolved comments.' : 'No comments on this target yet.'}</p>}
    </div>

    <form onSubmit={submit} className="mt-5 border-t border-slate-800 pt-5">
      {!!regions.length && <div><p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Optional page anchor</p><div className="mt-2 flex flex-wrap gap-2"><button type="button" onClick={() => setRegion('')} className={`rounded-lg border px-3 py-1.5 text-xs ${!region ? `${colors.border} ${colors.text}` : 'border-slate-800 text-slate-500'}`}>General</button>{regions.map(item => <button key={item.value} type="button" onClick={() => setRegion(item.value)} className={`rounded-lg border px-3 py-1.5 text-xs ${region === item.value ? `${colors.border} ${colors.text}` : 'border-slate-800 text-slate-500'}`}>{item.label}</button>)}</div></div>}
      {activeVisualAnchor && <div className={`mb-3 rounded-xl border ${colors.border} px-3 py-2 text-xs ${colors.text}`}>Anchored to visual point {Math.round(activeVisualAnchor.x * 100)}%, {Math.round(activeVisualAnchor.y * 100)}%. <button type="button" className="underline" onClick={onClearVisualAnchor}>Use general comment</button></div>}
      <textarea required rows="3" value={body} onChange={event => setBody(event.target.value)} placeholder="Add immutable feedback for this exact target…" className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3.5 py-3 text-sm text-white outline-none focus:border-slate-500" />
      <div className="mt-3 flex items-center justify-between gap-3"><p className="text-[11px] leading-5 text-slate-600">Comments cannot be edited or deleted. Add a correction as a new comment.</p><button disabled={loading || !body.trim()} className={`rounded-xl px-4 py-2 text-sm font-semibold text-white disabled:opacity-50 ${colors.button}`}>{loading ? 'Saving…' : 'Add comment'}</button></div>
    </form>
  </section>
}
