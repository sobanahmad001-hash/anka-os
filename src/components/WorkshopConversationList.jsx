import { useEffect, useMemo, useRef, useState } from 'react'
import { departmentChat } from '../data/departmentChatRepository.js'
import { readWorkshopConversationPage, matchesWorkshopConversation } from '../data/workshopConversationList.js'

export default function WorkshopConversationList(props) {
  if (props.engagements) return <ProjectConversationGroups {...props} />
  return <ExactConversationList {...props} />
}

function ProjectConversationGroups({ engagements, workstreams, activeEngagementId, ...props }) {
  const [expanded, setExpanded] = useState(() => activeEngagementId ? { [activeEngagementId]: true } : {})
  useEffect(() => { if (activeEngagementId) setExpanded(state => ({ ...state, [activeEngagementId]: true })) }, [activeEngagementId])
  const projects = [...new Set(engagements.map(row => row.project_id))]
  return <aside aria-label="Workshop saved conversations" className="space-y-3">
    <h3 className="font-semibold">Saved conversations</h3>
    <section aria-label="Private history"><h4>Private · Only you</h4><ExactConversationList {...props} engagement={null} /></section>
    {projects.map(projectId => <section key={projectId} aria-label={`Project ${workstreams.find(row => row.project_id === projectId)?.projects?.name || projectId}`}>
      <h4>{workstreams.find(row => row.project_id === projectId)?.projects?.name || 'Project'}</h4>
      {engagements.filter(row => row.project_id === projectId).map(engagement => <div key={engagement.id}>
        <button type="button" aria-expanded={Boolean(expanded[engagement.id])} onClick={() => setExpanded(state => ({ ...state, [engagement.id]: !state[engagement.id] }))}>{engagement.name}</button>
        {expanded[engagement.id] && <ExactConversationList {...props} engagement={engagement} engagementOnly />}
      </div>)}
    </section>)}
  </aside>
}

function ExactConversationList(props) {
  const identity = JSON.stringify([props.organizationId, props.actorId, props.scopeRevision, props.departmentId, props.engagement?.project_id, props.engagement?.id])
  return <ScopedWorkshopConversationList key={identity} {...props} />
}

function ScopedWorkshopConversationList({ organizationId, actorId, scopeRevision: _scopeRevision, departmentId, engagement, engagementOnly = false, signal, onOpen, refreshKey = 0, compact = false, navigationBusy = false }) {
  const [query, setQuery] = useState('')
  const serverQuery = engagementOnly ? query : ''
  const scope = useMemo(() => ({ organizationId, actorId, departmentId, engagement, signal, query: serverQuery }), [organizationId, actorId, departmentId, engagement, signal, serverQuery])
  const [pages, setPages] = useState({})
  const [reload, setReload] = useState(0)
  const generation = useRef(0)
  const inFlight = useRef(new Set())
  useEffect(() => {
    const revision = ++generation.current
    let current = true
    setPages({}); inFlight.current = new Set()
    for (const kind of [...(!engagementOnly ? ['private'] : []), ...(engagement ? ['engagement'] : [])]) {
      inFlight.current.add(kind)
      setPages(state => ({ ...state, [kind]: { items: [], busy: true } }))
      readWorkshopConversationPage(departmentChat, scope, kind).then(page => {
        if (current && !signal?.aborted && revision === generation.current) setPages(state => ({ ...state, [kind]: page }))
      }).catch(reason => {
        if (current && !signal?.aborted && revision === generation.current) setPages(state => ({ ...state, [kind]: { items: [], error: reason.message } }))
      }).finally(() => { if (current && revision === generation.current) inFlight.current.delete(kind) })
    }
    return () => { current = false; generation.current++ }
  }, [scope, engagement, engagementOnly, signal, reload, refreshKey])
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
  const visible = items.filter(item => matchesWorkshopConversation(item, scope)).filter(item => engagementOnly || String(item.row.title || '').toLowerCase().includes(query.toLowerCase()))
  return <aside aria-label="Workshop saved conversations" className="min-w-0 space-y-3 rounded-xl border border-[var(--anka-line)] bg-[var(--anka-surface)] p-4">
    {!compact && <h3 className="font-semibold">Saved conversations</h3>}
    {!compact && <p className="text-xs text-[var(--anka-muted)]">{engagementOnly ? engagement.name : engagement ? `Private exploration + ${engagement.name}` : 'Private exploration · Only you'}. Histories stay separate.</p>}
    <input aria-label={engagementOnly ? "Search engagement conversations" : "Search loaded conversation titles"} placeholder={engagementOnly ? "Search this engagement" : "Search loaded titles"} value={query} onChange={event => setQuery(event.target.value)} className="w-full rounded-lg border border-[var(--anka-line)] bg-[var(--anka-canvas)] p-2 text-sm" />
    {!compact && <p className="text-xs text-[var(--anka-muted)]">{items.length} loaded · {visible.length} {engagementOnly ? 'matching conversations' : 'matching loaded titles'}. Not a total across projects.</p>}
    <button type="button" onClick={() => setReload(value => value + 1)} className="text-sm text-[var(--anka-violet)]" aria-label="Refresh saved conversations">{compact ? 'Refresh' : 'Refresh saved conversations'}</button>
    {Object.entries(pages).map(([kind, page]) => <div key={kind}>
      <p className="text-xs text-[var(--anka-muted)]">{kind}: {page.items.length} loaded</p>
      {page.busy && <p role="status" className="text-xs">Loading {kind} conversations…</p>}
      {page.error && <p role="alert" className="text-xs text-[var(--anka-warning)]">{kind}: {page.error}. Refresh to retry.</p>}
      {page.next != null && <button type="button" disabled={page.busy} onClick={() => more(kind)} className="text-xs text-[var(--anka-violet)]">Load more {kind} conversations</button>}
    </div>)}
    <ul className="space-y-2">{visible.map(item => <li key={item.key}><button type="button" disabled={navigationBusy} onClick={() => { if (matchesWorkshopConversation(item, scope)) onOpen(item) }} className="w-full rounded-lg border border-[var(--anka-line)] p-3 text-left text-sm">
      <span className="block break-words font-medium">{item.row.title || 'Untitled conversation'}</span>
      <span className="mt-1 block text-xs text-[var(--anka-muted)]">{item.kind === 'private' ? 'Private exploration · Only you' : `${engagement.name} · ${item.row.access_role === 'recipient' ? 'Shared with you' : 'Yours · sharing managed in conversation'}`} · {item.row.state || 'active'}</span>
    </button></li>)}</ul>
    {!visible.length && !Object.values(pages).some(page => page.busy) && <p className="text-xs text-[var(--anka-muted)]">No matching loaded conversations.</p>}
  </aside>
}
