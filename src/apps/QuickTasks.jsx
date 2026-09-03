import { useCallback, useEffect, useMemo, useState } from 'react'

import { daysUntilExpiry, quickTaskContent } from '../data/quickTasks.js'
import { quickTasks } from '../data/quickTasksRepository.js'

const inputClass = 'w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2.5 text-sm text-white outline-none focus:border-violet-500/60 disabled:cursor-not-allowed disabled:opacity-60'
const departments = ['content', 'design', 'development', 'marketing']
const recoverableStates = new Set(['expired', 'discarded'])

function taskTiming(item) {
  if (item.purged_at) return 'Purged tombstone'
  if (item.state === 'active') return daysUntilExpiry(item.expires_at) + ' days until expiry'
  if (item.state === 'preserved') return 'Preserved · no automatic expiry'
  if (recoverableStates.has(item.state)) return 'Recoverable until ' + new Date(item.recoverable_until).toLocaleDateString()
  return item.state
}

export default function QuickTasks({ organizationId }) {
  const [items, setItems] = useState([])
  const [selectedId, setSelectedId] = useState('')
  const [draft, setDraft] = useState({ title: '', notes: '' })
  const [messages, setMessages] = useState([])
  const [chatPrompt, setChatPrompt] = useState('')
  const [chatDepartment, setChatDepartment] = useState('content')
  const [promptSafeForAi, setPromptSafeForAi] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [chatting, setChatting] = useState(false)
  const [error, setError] = useState('')

  const selected = useMemo(() => items.find(item => item.id === selectedId) || null, [items, selectedId])
  const isPurged = Boolean(selected?.purged_at)
  const isActive = selected?.state === 'active' && !isPurged
  const recoveryOpen = Boolean(
    selected && recoverableStates.has(selected.state) && !isPurged
    && selected.recoverable_until && new Date(selected.recoverable_until).getTime() > Date.now()
  )
  const recoveryElapsed = Boolean(
    selected && recoverableStates.has(selected.state) && !isPurged
    && selected.recoverable_until && new Date(selected.recoverable_until).getTime() <= Date.now()
  )
  const expiryDue = Boolean(
    isActive && selected.expires_at && new Date(selected.expires_at).getTime() <= Date.now()
  )
  const canFork = Boolean(
    selected && !isPurged && (
      selected.state === 'active' || selected.state === 'preserved'
      || (selected.state === 'expired' && recoveryOpen)
    )
  )

  const load = useCallback(async () => {
    if (!organizationId) { setItems([]); setLoading(false); return }
    setLoading(true); setError('')
    try { setItems(await quickTasks.list(organizationId) || []) }
    catch (reason) { setError(reason.message) }
    finally { setLoading(false) }
  }, [organizationId])

  useEffect(() => { load() }, [load])

  async function open(item) {
    setSelectedId(item.id); setError('')
    if (item.purged_at || !item.current_revision_id) {
      setDraft({ title: '[purged]', notes: '' }); setMessages([])
      return
    }
    try {
      const [revision, transcript] = await Promise.all([
        quickTasks.revision(item.current_revision_id), quickTasks.messages(item.id),
      ])
      setDraft({ title: item.title, notes: String(revision?.content?.notes || '') })
      setMessages(transcript || [])
    } catch (reason) { setError(reason.message) }
  }

  function newTask() {
    setSelectedId(''); setDraft({ title: '', notes: '' }); setMessages([])
    setChatPrompt(''); setPromptSafeForAi(false); setError('')
  }

  async function save(event) {
    event.preventDefault(); setSaving(true); setError('')
    try {
      const content = quickTaskContent({ notes: draft.notes })
      if (selected) await quickTasks.append({ quickTaskId: selected.id, expectedRevisionId: selected.current_revision_id, title: draft.title, content })
      else await quickTasks.create({ organizationId, title: draft.title, content })
      newTask(); await load()
    } catch (reason) { setError(reason.message) }
    finally { setSaving(false) }
  }

  async function fork() {
    if (!selected || !canFork) return
    setSaving(true); setError('')
    try {
      await quickTasks.fork({ quickTaskId: selected.id, revisionId: selected.current_revision_id, title: selected.title + ' (fork)' })
      newTask(); await load()
    } catch (reason) { setError(reason.message) }
    finally { setSaving(false) }
  }

  async function changeLifecycle(action) {
    if (!selected) return
    setSaving(true); setError('')
    try {
      await quickTasks.lifecycle(action, selected.id)
      newTask(); await load()
    } catch (reason) { setError(reason.message) }
    finally { setSaving(false) }
  }

  async function chat(event) {
    event.preventDefault()
    if (!selected || !isActive) return
    setChatting(true); setError('')
    try {
      const result = await quickTasks.chat({
        quickTaskId: selected.id, expectedRevisionId: selected.current_revision_id,
        departmentId: chatDepartment, prompt: chatPrompt, promptSafeForAi,
      })
      setDraft({ title: result.task.title, notes: String(result.revision?.content?.notes || '') })
      setChatPrompt(''); setPromptSafeForAi(false)
      await load()
      setMessages(await quickTasks.messages(selected.id) || [])
    } catch (reason) { setError(reason.message) }
    finally { setChatting(false) }
  }

  return <main className="mx-auto max-w-7xl p-6 lg:p-8">
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div><p className="text-xs font-semibold uppercase tracking-[0.18em] text-violet-400">Private working memory</p><h1 className="mt-2 text-3xl font-semibold text-white">Quick Tasks</h1><p className="mt-2 max-w-2xl text-sm text-slate-400">Only you can read task content and its sandbox chat. Active notes expire after 30 days without a substantive owner edit; preserved notes do not expire; promotion is intentionally unavailable in this release.</p></div>
      <button type="button" onClick={newTask} className="rounded-xl bg-violet-500 px-4 py-2.5 text-sm font-semibold text-white">New Quick Task</button>
    </div>
    {error && <div className="mt-5 rounded-xl border border-red-900/60 bg-red-950/40 px-4 py-3 text-sm text-red-300">{error}</div>}
    <div className="mt-7 grid gap-5 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.4fr)]">
      <section className="rounded-2xl border border-white/[0.07] bg-[#0e111a]/80 p-4">
        <h2 className="px-2 text-sm font-semibold text-white">Your notes</h2>
        <div className="mt-3 space-y-2">{items.map(item => <button key={item.id} type="button" onClick={() => open(item)} className={'w-full rounded-xl border p-3 text-left ' + (item.id === selectedId ? 'border-violet-500/50 bg-violet-500/10' : 'border-white/[0.06] bg-black/10 hover:bg-white/[0.03]')}><div className="flex items-start justify-between gap-3"><p className="font-medium text-white">{item.title}</p><span className="rounded-full border border-white/10 px-2 py-0.5 text-[10px] uppercase tracking-wide text-slate-400">{item.state}</span></div><p className="mt-1 text-xs text-slate-500">Revision {item.current_revision_number} · {taskTiming(item)}</p></button>)}</div>
        {!loading && !items.length && <p className="px-2 py-12 text-center text-sm text-slate-500">No Quick Tasks yet.</p>}
        {loading && <p className="px-2 py-12 text-center text-sm text-slate-500">Loading…</p>}
      </section>
      <div className="space-y-5">
        {selected && <section className="rounded-2xl border border-white/[0.07] bg-[#0e111a]/80 p-5">
          <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="font-semibold text-white">Retention</h2><p className="mt-1 text-xs text-slate-500">{taskTiming(selected)}. Expiry and purge batches are bounded; scheduling is not enabled in this release.</p></div><span className="rounded-full border border-violet-500/30 bg-violet-500/10 px-2.5 py-1 text-xs font-semibold capitalize text-violet-200">{selected.state}</span></div>
          <div className="mt-4 flex flex-wrap gap-2">
            {isActive && <button type="button" disabled={saving} onClick={() => changeLifecycle('preserve')} className="rounded-lg border border-white/10 px-3 py-2 text-xs font-semibold text-slate-300 hover:text-white">Preserve</button>}
            {selected.state === 'preserved' && <button type="button" disabled={saving} onClick={() => changeLifecycle('unpreserve')} className="rounded-lg border border-white/10 px-3 py-2 text-xs font-semibold text-slate-300 hover:text-white">Resume expiry</button>}
            {(isActive || selected.state === 'preserved' || (selected.state === 'expired' && recoveryOpen)) && <button type="button" disabled={saving} onClick={() => changeLifecycle('discard')} className="rounded-lg border border-amber-500/30 px-3 py-2 text-xs font-semibold text-amber-200">Discard</button>}
            {recoveryOpen && <button type="button" disabled={saving} onClick={() => changeLifecycle('restore')} className="rounded-lg border border-emerald-500/30 px-3 py-2 text-xs font-semibold text-emerald-200">Restore</button>}
            {recoveryOpen && <button type="button" disabled={saving} onClick={() => changeLifecycle('preserve')} className="rounded-lg border border-white/10 px-3 py-2 text-xs font-semibold text-slate-300 hover:text-white">Restore preserved</button>}
            {expiryDue && <button type="button" disabled={saving} onClick={() => changeLifecycle('expire')} className="rounded-lg border border-amber-500/30 px-3 py-2 text-xs font-semibold text-amber-200">Expire due task</button>}
            {recoveryElapsed && <button type="button" disabled={saving} onClick={() => changeLifecycle('purge')} className="rounded-lg border border-red-500/30 px-3 py-2 text-xs font-semibold text-red-200">Purge payload</button>}
          </div>
          {isPurged && <p className="mt-4 text-sm text-slate-400">The recovery window elapsed. Content, revisions, messages, and linked AI input/output were removed; only metadata and the final checksum remain.</p>}
        </section>}
        <form onSubmit={save} className="rounded-2xl border border-white/[0.07] bg-[#0e111a]/80 p-5">
          <div className="flex items-center justify-between gap-3"><h2 className="font-semibold text-white">{selected ? 'Quick Task details' : 'Capture a thought'}</h2>{canFork && <button type="button" onClick={fork} disabled={saving} className="rounded-lg border border-white/10 px-3 py-2 text-xs font-semibold text-slate-300 hover:text-white">Fork revision</button>}</div>
          <label className="mt-5 block text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Title<input required maxLength="240" disabled={Boolean(selected && !isActive)} className={inputClass + ' mt-2'} value={draft.title} onChange={event => setDraft({ ...draft, title: event.target.value })} /></label>
          <label className="mt-4 block text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Notes<textarea rows="12" disabled={Boolean(selected && !isActive)} className={inputClass + ' mt-2 resize-y'} value={draft.notes} onChange={event => setDraft({ ...draft, notes: event.target.value })} /></label>
          {(!selected || isActive) && <div className="mt-5 flex justify-end"><button disabled={saving || !organizationId} className="rounded-xl bg-violet-500 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50">{saving ? 'Saving…' : selected ? 'Append revision' : 'Create Quick Task'}</button></div>}
        </form>
        {selected && !isPurged && <section className="rounded-2xl border border-white/[0.07] bg-[#0e111a]/80 p-5">
          <div><h2 className="font-semibold text-white">Sandbox chat</h2><p className="mt-1 text-xs text-slate-500">Uses your department’s verified model. It cannot load canonical context or perform business actions.</p></div>
          <div className="mt-4 max-h-72 space-y-3 overflow-y-auto">{messages.map(message => <div key={message.id} className={'rounded-xl border px-3 py-2.5 text-sm ' + (message.role === 'user' ? 'border-violet-500/20 bg-violet-500/10 text-violet-100' : 'border-white/[0.06] bg-black/20 text-slate-300')}><p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">{message.role}</p><p className="whitespace-pre-wrap">{message.body}</p></div>)}</div>
          {!messages.length && <p className="mt-4 text-sm text-slate-500">No sandbox messages yet.</p>}
          {isActive ? <form onSubmit={chat} className="mt-5 space-y-3">
            <label className="block text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Department<select className={inputClass + ' mt-2 capitalize'} value={chatDepartment} onChange={event => setChatDepartment(event.target.value)}>{departments.map(department => <option key={department} value={department}>{department}</option>)}</select></label>
            <label className="block text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Prompt<textarea required maxLength="8000" rows="4" className={inputClass + ' mt-2 resize-y'} value={chatPrompt} onChange={event => setChatPrompt(event.target.value)} /></label>
            <label className="flex items-start gap-2 text-xs text-slate-400"><input type="checkbox" className="mt-0.5" checked={promptSafeForAi} onChange={event => setPromptSafeForAi(event.target.checked)} /><span>I confirm this prompt is safe to send to the configured model.</span></label>
            <div className="flex justify-end"><button disabled={chatting || !promptSafeForAi || !chatPrompt.trim()} className="rounded-xl bg-violet-500 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50">{chatting ? 'Thinking…' : 'Create sandbox revision'}</button></div>
          </form> : <p className="mt-5 text-xs text-slate-500">Restore or resume this task before starting another sandbox chat.</p>}
        </section>}
      </div>
    </div>
  </main>
}
