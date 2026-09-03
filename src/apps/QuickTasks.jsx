import { useCallback, useEffect, useMemo, useState } from 'react'

import { daysUntilExpiry, quickTaskContent } from '../data/quickTasks.js'
import { quickTasks } from '../data/quickTasksRepository.js'

const inputClass = 'w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2.5 text-sm text-white outline-none focus:border-violet-500/60'

export default function QuickTasks({ organizationId }) {
  const [items, setItems] = useState([])
  const [selectedId, setSelectedId] = useState('')
  const [draft, setDraft] = useState({ title: '', notes: '' })
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const selected = useMemo(() => items.find(item => item.id === selectedId) || null, [items, selectedId])

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
    try {
      const revision = await quickTasks.revision(item.current_revision_id)
      setDraft({ title: item.title, notes: String(revision?.content?.notes || '') })
    } catch (reason) { setError(reason.message) }
  }

  function newTask() {
    setSelectedId('')
    setDraft({ title: '', notes: '' })
    setError('')
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
    if (!selected) return
    setSaving(true); setError('')
    try {
      await quickTasks.fork({ quickTaskId: selected.id, revisionId: selected.current_revision_id, title: `${selected.title} (fork)` })
      newTask(); await load()
    } catch (reason) { setError(reason.message) }
    finally { setSaving(false) }
  }

  return <main className="mx-auto max-w-7xl p-6 lg:p-8">
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div><p className="text-xs font-semibold uppercase tracking-[0.18em] text-violet-400">Private working memory</p><h1 className="mt-2 text-3xl font-semibold text-white">Quick Tasks</h1><p className="mt-2 max-w-2xl text-sm text-slate-400">Only you can read task content. Active notes expire after 30 days without an edit; promotion is intentionally unavailable in this release.</p></div>
      <button type="button" onClick={newTask} className="rounded-xl bg-violet-500 px-4 py-2.5 text-sm font-semibold text-white">New Quick Task</button>
    </div>
    {error && <div className="mt-5 rounded-xl border border-red-900/60 bg-red-950/40 px-4 py-3 text-sm text-red-300">{error}</div>}
    <div className="mt-7 grid gap-5 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.4fr)]">
      <section className="rounded-2xl border border-white/[0.07] bg-[#0e111a]/80 p-4">
        <h2 className="px-2 text-sm font-semibold text-white">Your notes</h2>
        <div className="mt-3 space-y-2">{items.map(item => <button key={item.id} type="button" onClick={() => open(item)} className={`w-full rounded-xl border p-3 text-left ${item.id === selectedId ? 'border-violet-500/50 bg-violet-500/10' : 'border-white/[0.06] bg-black/10 hover:bg-white/[0.03]'}`}><p className="font-medium text-white">{item.title}</p><p className="mt-1 text-xs text-slate-500">Revision {item.current_revision_number} · {daysUntilExpiry(item.expires_at)} days until expiry</p></button>)}</div>
        {!loading && !items.length && <p className="px-2 py-12 text-center text-sm text-slate-500">No Quick Tasks yet.</p>}
        {loading && <p className="px-2 py-12 text-center text-sm text-slate-500">Loading…</p>}
      </section>
      <form onSubmit={save} className="rounded-2xl border border-white/[0.07] bg-[#0e111a]/80 p-5">
        <div className="flex items-center justify-between gap-3"><h2 className="font-semibold text-white">{selected ? 'Edit Quick Task' : 'Capture a thought'}</h2>{selected && <button type="button" onClick={fork} disabled={saving} className="rounded-lg border border-white/10 px-3 py-2 text-xs font-semibold text-slate-300 hover:text-white">Fork revision</button>}</div>
        <label className="mt-5 block text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Title<input required maxLength="240" className={`${inputClass} mt-2`} value={draft.title} onChange={event => setDraft({ ...draft, title: event.target.value })} /></label>
        <label className="mt-4 block text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Notes<textarea rows="16" className={`${inputClass} mt-2 resize-y`} value={draft.notes} onChange={event => setDraft({ ...draft, notes: event.target.value })} /></label>
        <div className="mt-5 flex justify-end"><button disabled={saving || !organizationId} className="rounded-xl bg-violet-500 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50">{saving ? 'Saving…' : selected ? 'Append revision' : 'Create Quick Task'}</button></div>
      </form>
    </div>
  </main>
}
