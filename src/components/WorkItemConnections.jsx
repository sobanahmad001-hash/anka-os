import { Link } from 'react-router-dom'

import {
  artifactSurfacePath,
  artifactTypeLabel,
  relationTypeLabel,
  splitArtifactRelations,
} from '../data/artifactRelations.js'

export default function WorkItemConnections({ parent, subtasks, blockedBy, blocks, linkedArtifact, artifactRelations, relationsLoading, relationsError, onOpen }) {
  const groupedRelations = splitArtifactRelations(linkedArtifact?.id, artifactRelations)
  const linkedRelations = [
    ...groupedRelations.outgoing.map(relation => ({ ...relation, direction: 'Outgoing' })),
    ...groupedRelations.incoming.map(relation => ({ ...relation, direction: 'Incoming' })),
  ]

  return <section className="mt-6 border-t border-white/[0.07] pt-6" aria-labelledby="connection-picture-heading">
    <div><p className="text-[10px] font-semibold uppercase tracking-[0.15em] text-cyan-300">Relationship picture</p><h3 id="connection-picture-heading" className="mt-1 font-semibold text-white">Everything connected to this work item</h3><p className="mt-1 text-xs leading-5 text-slate-500">Read-only consolidation of the existing parent, subtask, dependency, and artifact relation records.</p></div>
    <div className="mt-4 grid gap-3 sm:grid-cols-2">
      <ConnectionCard title="Parent">{parent ? <WorkLink item={parent} onOpen={onOpen} /> : <Empty text="Top-level work item" />}</ConnectionCard>
      <ConnectionCard title="Subtasks" count={subtasks.length}>{subtasks.length ? subtasks.map(item => <WorkLink key={item.id} item={item} onOpen={onOpen} />) : <Empty text="No subtasks" />}</ConnectionCard>
      <ConnectionCard title="Blocked by" count={blockedBy.length}>{blockedBy.length ? blockedBy.map(item => <WorkLink key={item.id} item={item} onOpen={onOpen} />) : <Empty text="No blocking dependencies" />}</ConnectionCard>
      <ConnectionCard title="Blocks" count={blocks.length}>{blocks.length ? blocks.map(item => <WorkLink key={item.id} item={item} onOpen={onOpen} />) : <Empty text="Does not block other work" />}</ConnectionCard>
      <div className="sm:col-span-2"><ConnectionCard title="Linked artifact and its relations" count={linkedRelations.length}>
        {linkedArtifact ? <>
          <Link to={artifactSurfacePath(linkedArtifact)} className="flex items-start justify-between gap-3 rounded-lg border border-cyan-500/15 bg-cyan-500/[0.04] p-3 hover:border-cyan-400/30"><span><span className="block text-sm font-semibold text-white">{linkedArtifact.title}</span><span className="mt-1 block text-[11px] text-slate-500">{artifactTypeLabel(linkedArtifact.artifact_type)} · Open artifact record</span></span><span className="text-cyan-300">→</span></Link>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">{linkedRelations.map(relation => <Link key={`${relation.direction}-${relation.id}`} to={artifactSurfacePath(relation.relatedArtifact)} className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-3 hover:border-cyan-500/20"><span className="block truncate text-xs font-semibold text-slate-200">{relation.relatedArtifact.title}</span><span className="mt-1 block text-[10px] text-slate-600">{relation.direction} · {relationTypeLabel(relation.relation_type)} · {artifactTypeLabel(relation.relatedArtifact.artifact_type)}</span></Link>)}</div>
          {relationsLoading && <p className="mt-3 text-xs text-slate-600">Loading visible artifact relations…</p>}
          {!relationsLoading && !relationsError && !linkedRelations.length && <p className="mt-3 text-xs text-slate-600">This artifact has no other visible relations.</p>}
          {relationsError && <p className="mt-3 text-xs text-red-300">Artifact relations could not be loaded.</p>}
        </> : <Empty text="No visible linked artifact" />}
      </ConnectionCard></div>
    </div>
  </section>
}

function ConnectionCard({ title, count, children }) {
  return <section className="rounded-xl border border-white/[0.07] bg-black/10 p-4"><div className="flex items-center justify-between gap-3"><h4 className="text-sm font-semibold text-slate-200">{title}</h4>{Number.isInteger(count) && <span className="rounded-full bg-white/[0.05] px-2 py-0.5 text-[10px] font-semibold text-slate-500">{count}</span>}</div><div className="mt-3 space-y-2">{children}</div></section>
}

function WorkLink({ item, onOpen }) {
  return <button type="button" onClick={() => onOpen(item)} className="flex w-full items-center gap-2 rounded-lg border border-white/[0.06] bg-white/[0.025] p-2.5 text-left hover:border-violet-500/25"><span aria-label={item.status === 'done' ? 'Complete' : 'Open'} className={`h-2 w-2 shrink-0 rounded-full ${item.status === 'done' ? 'bg-emerald-400' : item.status === 'blocked' ? 'bg-red-400' : 'bg-slate-500'}`} /><span className="min-w-0 flex-1 truncate text-xs text-slate-300">{item.title}</span><span className="text-[10px] text-slate-600">{String(item.status || '').replaceAll('_', ' ')}</span></button>
}

function Empty({ text }) {
  return <p className="py-2 text-xs text-slate-600">{text}</p>
}
