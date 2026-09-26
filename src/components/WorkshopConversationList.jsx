import { useEffect, useMemo, useRef, useState } from 'react'
import { departmentChat } from '../data/departmentChatRepository.js'
import { readWorkshopConversationPage } from '../data/workshopConversationList.js'

export default function WorkshopConversationList(props) {
  const identity = JSON.stringify([props.organizationId, props.actorId, props.scopeRevision, props.departmentId, props.engagement?.project_id, props.engagement?.id])
  return <ScopedWorkshopConversationList key={identity} {...props} />
}

function ScopedWorkshopConversationList({ organizationId, actorId, scopeRevision: _scopeRevision, departmentId, engagement, signal, onOpen, refreshKey = 0 }) {
  const scope = useMemo(() => ({ organizationId, actorId, departmentId, engagement, signal }), [organizationId, actorId, departmentId, engagement, signal])
  const [pages, setPages] = useState({})
  const [query, setQuery] = useState('')
  const [reload, setReload] = useState(0)
  const generation = useRef(0)
  const inFlight = useRef(new Set())
  useEffect(() => {
    const revision = ++generation.current
    let current = true
    setPages({}); inFlight.current = new Set()
    for (const kind of ['private', ...(engagement ? ['engagement'] : [])]) {
      inFlight.current.add(kind)
      setPages(state => ({ ...state, [kind]: { items: [], busy: true } }))
      readWorkshopConversationPage(departmentChat, scope, kind).then(page => {
        if (current && !signal?.aborted && revision === generation.current) setPages(state => ({ ...state, [kind]: page }))
      }).catch(reason => {
        if (current && !signal?.aborted && revision === generation.current) setPages(state => ({ ...state, [kind]: { items: [], error: reason.message } }))
      }).finally(() => { if (current && revision === generation.current) inFlight.current.delete(kind) })
    }
    return () => { current = false; generation.current++ }
  }, [scope, engagement, signal, reload, refreshKey])
  async function more(kind) {
    const page = pages[kind]
    if (inFlight.current.has(kind) || page?.next == null) return
    const revision = generation.current
    inFlight.current.add(kind)
    setPages(state => ({ ...state, [kind]: { ...state[kind], busy: true, error: '' } }))
    try {
      const next = await readWorkshopConversationPage(departmentChat, scope, kind, page.next)
      if (signal?.aborted || revision !== generation.current) return
      setPages(state => ({ ...state, [kind]: { ...next, items: [...state[kind].items, ...next.items.filter(item => !state[kind].items.some(prior => prior.key === item.key))] } }))
    } catch (reason) {
      if (!signal?.aborted && revision === generation.current) setPages(state => ({ ...state, [kind]: { items: [], error: reason.message } }))
    } finally { if (revision === generation.current) inFlight.current.delete(kind) }
  }
  const items = Object.values(pages).flatMap(page => page.items || [])
    .sort((a, b) => String(b.row.last_activity_at || '').localeCompare(String(a.row.last_activity_at || '')) || a.key.localeCompare(b.key))
  const visible = items.filter(item => String(item.row.title || '').toLowerCase().includes(query.toLowerCase()))
  return <aside aria-label="Workshop saved conversations" className="min-w-0 space-y-3 rounded-xl border border-slate-800 bg-slate-900/70 p-4">
    <h3 className="font-semibold">Saved conversations</h3>
    <p className="text-xs text-slate-400">Private exploration{engagement ? ` + ${engagement.name}` : ' only — select an engagement in project context to include its conversations'}. Histories stay separate.</p>
    <input aria-label="Search loaded conversation titles" placeholder="Search loaded titles" value={query} onChange={event => setQuery(event.target.value)} className="w-full rounded-lg border border-slate-700 bg-slate-950 p-2 text-sm" />
    <p className="text-xs text-slate-400">{items.length} loaded · {visible.length} matching loaded titles. Not a total across projects.</p>
    <button type="button" onClick={() => setReload(value => value + 1)} className="text-sm text-violet-300">Refresh saved conversations</button>
    {Object.entries(pages).map(([kind, page]) => <div key={kind}>
      <p className="text-xs text-slate-400">{kind}: {page.items.length} loaded</p>
      {page.busy && <p role="status" className="text-xs">Loading {kind} conversations…</p>}
      {page.error && <p role="alert" className="text-xs text-amber-200">{kind}: {page.error}. Refresh to retry.</p>}
      {page.next != null && <button type="button" disabled={page.busy} onClick={() => more(kind)} className="text-xs text-violet-300">Load more {kind} conversations</button>}
    </div>)}
    <ul className="space-y-2">{visible.map(item => <li key={item.key}><button type="button" onClick={() => onOpen(item)} className="w-full rounded-lg border border-slate-700 p-3 text-left text-sm">
      <span className="block break-words font-medium">{item.row.title || 'Untitled conversation'}</span>
      <span className="mt-1 block text-xs text-slate-400">{item.kind === 'private' ? 'Private exploration · Only you' : `${engagement.name} · ${item.row.access_role === 'recipient' ? 'Shared with you' : 'Yours · sharing managed in conversation'}`} · {item.row.state || 'active'}</span>
    </button></li>)}</ul>
    {!visible.length && !Object.values(pages).some(page => page.busy) && <p className="text-xs text-slate-400">No matching loaded conversations.</p>}
  </aside>
}
