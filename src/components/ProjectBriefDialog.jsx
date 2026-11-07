import { useEffect, useRef, useState } from 'react'
import _WorkspaceDialog from './WorkspaceDialog.jsx'
import { supabase } from '../lib/supabase.js'
import { createProjectBriefRepository } from '../data/projectBriefRepository.js'
import { projectDraftRepository } from '../data/projectDraftRepository.js'
import { canManageProjectServices } from '../data/projectServiceProposalQueue.js'

const repository = createProjectBriefRepository(supabase)
const permission = scope => canManageProjectServices({ ...scope, hasOwnManagerBinding: projectDraftRepository.hasOwnManagerBinding })

export default function ProjectBriefDialog({ scope, membership, onClose, onRead, repo = repository, canEdit = permission }) {
  const { organizationId, projectId, actorId, signal } = scope
  const key = JSON.stringify(['project-brief', organizationId, projectId, actorId])
  const [base, setBase] = useState(null), [draft, setDraft] = useState('')
  const [review, setReview] = useState(null), [pending, setPending] = useState(null)
  const [allowed, setAllowed] = useState(false), [busy, setBusy] = useState(true), [message, setMessage] = useState('')
  const life = useRef(0), flight = useRef(false), live = useRef(null)
  live.current = { review, draft, pending, onRead, allowed }
  const active = token => token === life.current && !signal?.aborted
  useEffect(() => {
    const token = ++life.current
    const current = () => life.current === token && !signal?.aborted
    flight.current = false; setBusy(true); setAllowed(false); setReview(null); setBase(null); setPending(null); setDraft('')
    async function load() {
      const prior = JSON.parse(sessionStorage.getItem(key))

      const row = await repo.read({ organizationId, projectId, actorId, signal })
      if (!current()) return
      setBase(row); live.current.onRead(row)
      if (prior) { setPending(prior); setDraft(prior.draft) }
      if (!prior) setDraft(row.description)
      else setMessage('Previous save needs comparison with the current brief.')
      const manage = await canEdit({ organizationId, projectId, actorId, signal, membership })
      if (current()) setAllowed(manage)
    }
    load().catch(e => { if (current()) setMessage(e.message) }).finally(() => { if (current()) setBusy(false) })
    return () => { life.current = token + 1 }
  }, [organizationId, projectId, actorId, signal, membership, key, repo, canEdit])

  async function check(token, attempt) {
    const row = await repo.read(scope)
    if (!active(token)) return
    setBase(row); live.current.onRead(row)
    if (row.description === attempt.draft) {
      sessionStorage.removeItem(key); setPending(null); setDraft(row.description)
      setMessage('The current saved brief matches your reviewed text.')
    } else {
      setMessage('The current saved brief differs. Compare it with your draft before reviewing a new save.')
      setPending({ ...attempt, compared: true })
    }
  }
  async function submit(readOnly) {
    const token = life.current
    if (flight.current || !active(token) || busy) return
    const attempt = readOnly ? live.current.pending : review
    if (!attempt || (!readOnly && (attempt !== live.current.review || live.current.pending || !live.current.allowed))) return
    flight.current = true; setBusy(true)
    try {
      if (readOnly) { await check(token, attempt); return }
      sessionStorage.setItem(key, JSON.stringify(attempt))
      setPending(attempt); live.current.pending = attempt; setReview(null)
      try {
        const row = await repo.save(scope, attempt.base, attempt.draft)
        if (!active(token)) return
        sessionStorage.removeItem(key); setPending(null); setBase(row); setDraft(row.description); live.current.onRead(row); setMessage('Business brief saved.')
      } catch (e) {
        if (!active(token)) return
        setMessage(e.message); await check(token, attempt)
      }
    } catch (e) { if (active(token)) setMessage(e.message) }
    finally { if (active(token)) { flight.current = false; setBusy(false) } }
  }
  const dirty = Boolean(base && draft !== base.description)
  return <_WorkspaceDialog title="Business brief" busy={busy || (dirty && !pending)} busyMessage={busy ? 'Checking project access and the saved brief…' : 'Review or discard your edits before closing.'} onClose={onClose}>
    {base && <><h3>Current saved brief</h3><p className="whitespace-pre-wrap">{base.description || 'No business brief recorded.'}</p></>}
    {(allowed || pending) && <label className="block">Your proposed brief<textarea className="w-full" value={draft} disabled={busy || Boolean(pending) || !allowed} onChange={e => {setDraft(e.target.value);setReview(null);setMessage('')}}/></label>}
    {base && !busy && !allowed && <p>Read-only project access.</p>}
    {allowed && dirty && !pending && <><button type="button" disabled={busy} onClick={() => setReview({base,draft})}>Review brief changes</button><button type="button" disabled={busy} onClick={() => {setDraft(base.description);setReview(null)}}>Discard edits</button></>}
    {review && <section><h3>Reviewed replacement</h3><p className="whitespace-pre-wrap">{review.draft || 'Clear the business brief'}</p><button type="button" disabled={busy} onClick={() => submit(false)}>Save reviewed brief</button></section>}
    {pending && <><button type="button" disabled={busy} onClick={() => submit(true)}>Check current saved brief</button>{pending.compared && allowed && <button type="button" disabled={busy} onClick={() => {sessionStorage.removeItem(key);setPending(null);setReview(null)}}>Keep draft and review against current brief</button>}</>}
    {message && <p role="status">{message}</p>}
  </_WorkspaceDialog>
}
