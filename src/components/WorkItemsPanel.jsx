import { useCallback, useEffect, useMemo, useState } from 'react'

import { OPERATING_DEPARTMENTS } from '../data/operatingSpineRepository.js'
import {
  artifactRoute,
  EMPTY_WORK_ITEM,
  filterAndSortWorkItems,
  groupWorkItemsForBoard,
  planWorkItemBoardMove,
  workItemSaveInput,
  WORK_ITEM_BOARD_COLUMNS,
  WORK_ITEM_PRIORITIES,
  WORK_ITEM_STATUSES,
  WORK_ITEM_TYPES,
} from '../data/workItems.js'
import { workItems } from '../data/workItemsRepository.js'

const INPUT = 'w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2.5 text-sm text-white outline-none focus:border-violet-500/60'
const LABEL = 'mb-1.5 block text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500'
const labelize = value => String(value || '').replaceAll('_', ' ').replace(/\b\w/g, letter => letter.toUpperCase())

function ownerLabel(owners, id) {
  return owners.find(owner => owner.id === id)?.label || (id ? 'Unknown member' : 'Unassigned')
}

function sortIndicator(sort, key) {
  return sort.key === key ? (sort.direction === 'asc' ? ' ↑' : ' ↓') : ''
}

export default function WorkItemsPanel({ workspace, owners, onRefresh }) {
  const [items, setItems] = useState([])
  const [view, setView] = useState('list')
  const [filters, setFilters] = useState({ status: '', assignee: '', department: '', priority: '', due: '' })
  const [sort, setSort] = useState({ key: 'position', direction: 'asc' })
  const [editor, setEditor] = useState(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [moving, setMoving] = useState(false)
  const [draggedItemId, setDraggedItemId] = useState('')
  const [error, setError] = useState('')

  const loadItems = useCallback(async () => {
    setLoading(true); setError('')
    try { setItems(await workItems.list(workspace.engagement.id) || []) }
    catch (loadError) { setError(loadError.message) }
    finally { setLoading(false) }
  }, [workspace.engagement.id])

  useEffect(() => { loadItems() }, [loadItems])

  const visibleItems = useMemo(() => filterAndSortWorkItems(items, filters, sort), [items, filters, sort])
  const boardColumns = useMemo(() => groupWorkItemsForBoard(visibleItems), [visibleItems])
  const versionsByArtifact = useMemo(() => {
    const result = new Map()
    for (const version of workspace.workItemArtifactVersions || []) {
      result.set(version.artifact_id, [...(result.get(version.artifact_id) || []), version])
    }
    return result
  }, [workspace.workItemArtifactVersions])

  function toggleSort(key) {
    setSort(current => ({ key, direction: current.key === key && current.direction === 'asc' ? 'desc' : 'asc' }))
  }

  function openNew() {
    setEditor({ ...EMPTY_WORK_ITEM, engagement_id: workspace.engagement.id })
  }

  async function save(event) {
    event.preventDefault()
    setSaving(true); setError('')
    try {
      await workItems.save(workItemSaveInput(editor, workspace.engagement.id))
      setEditor(null)
      await Promise.all([loadItems(), onRefresh?.()])
    } catch (saveError) { setError(saveError.message) }
    finally { setSaving(false) }
  }

  async function remove() {
    if (!editor?.id) return
    setSaving(true); setError('')
    try {
      await workItems.remove(editor.id)
      setEditor(null)
      await Promise.all([loadItems(), onRefresh?.()])
    } catch (removeError) { setError(removeError.message) }
    finally { setSaving(false) }
  }

  async function moveWorkItem(workItemId, targetStatus, beforeWorkItemId = null) {
    const changes = planWorkItemBoardMove(visibleItems, workItemId, targetStatus, beforeWorkItemId)
    if (!changes.length) return
    setMoving(true); setError('')
    try {
      for (const item of changes) {
        await workItems.save(workItemSaveInput(item, workspace.engagement.id))
      }
      await Promise.all([loadItems(), onRefresh?.()])
    } catch (moveError) { setError(moveError.message) }
    finally { setMoving(false); setDraggedItemId('') }
  }

  function moveWithinColumn(item, direction) {
    const column = boardColumns[item.status]
    const index = column.findIndex(candidate => candidate.id === item.id)
    if (direction === 'up' && index > 0) moveWorkItem(item.id, item.status, column[index - 1].id)
    if (direction === 'down' && index < column.length - 1) moveWorkItem(item.id, item.status, column[index + 2]?.id || null)
  }

  const linkedArtifact = editor && (workspace.workItemArtifacts || []).find(item => item.id === editor.linked_artifact_id)
  const artifactVersions = editor?.linked_artifact_id ? versionsByArtifact.get(editor.linked_artifact_id) || [] : []

  return <section className="mt-7 space-y-5">
    <div className="flex flex-wrap items-start justify-between gap-4"><div><h2 className="text-xl font-semibold">Work</h2><p className="mt-1 text-sm text-slate-500">One shared engagement work queue, available as a list or board.</p></div><div className="flex items-center gap-3"><div aria-label="Work view" className="flex rounded-xl border border-white/10 bg-black/20 p-1"><button type="button" aria-pressed={view === 'list'} onClick={() => setView('list')} className={`rounded-lg px-3 py-2 text-xs font-semibold ${view === 'list' ? 'bg-white/10 text-white' : 'text-slate-500 hover:text-white'}`}>List</button><button type="button" aria-pressed={view === 'board'} onClick={() => setView('board')} className={`rounded-lg px-3 py-2 text-xs font-semibold ${view === 'board' ? 'bg-white/10 text-white' : 'text-slate-500 hover:text-white'}`}>Board</button></div><button onClick={openNew} className="rounded-xl bg-violet-500 px-4 py-2.5 text-sm font-semibold">New work item</button></div></div>
    {error && <div className="rounded-xl border border-red-900/60 bg-red-950/40 px-4 py-3 text-sm text-red-300">{error}</div>}
    <div className="grid gap-3 rounded-2xl border border-white/[0.07] bg-[#0e111a]/80 p-4 sm:grid-cols-2 xl:grid-cols-5">
      <Filter label="Status" value={filters.status} onChange={status => setFilters({ ...filters, status })} options={WORK_ITEM_STATUSES} />
      <Filter label="Assignee" value={filters.assignee} onChange={assignee => setFilters({ ...filters, assignee })} options={owners.map(owner => ({ value: owner.id, label: owner.label }))} />
      <Filter label="Department" value={filters.department} onChange={department => setFilters({ ...filters, department })} options={OPERATING_DEPARTMENTS.map(item => ({ value: item.id, label: item.name }))} />
      <Filter label="Priority" value={filters.priority} onChange={priority => setFilters({ ...filters, priority })} options={WORK_ITEM_PRIORITIES} />
      <Filter label="Due date" value={filters.due} onChange={due => setFilters({ ...filters, due })} options={[{ value: 'overdue', label: 'Overdue' }, { value: 'next_7_days', label: 'Next 7 days' }, { value: 'no_due_date', label: 'No due date' }]} />
    </div>
    {view === 'list' ? <div className="overflow-x-auto rounded-2xl border border-white/[0.07] bg-[#0e111a]/80">
      <table className="w-full min-w-[980px] text-left text-sm"><thead className="bg-black/20 text-[10px] uppercase tracking-[0.12em] text-slate-500"><tr>
        {[['title', 'Work item'], ['status', 'Status'], ['priority', 'Priority'], ['assignee_id', 'Assignee'], ['department_id', 'Department'], ['due_date', 'Due']].map(([key, label]) => <th key={key} className="px-4 py-3"><button onClick={() => toggleSort(key)} className="font-semibold hover:text-white">{label}{sortIndicator(sort, key)}</button></th>)}
      </tr></thead><tbody>{visibleItems.map(item => <tr key={item.id} onClick={() => setEditor({ ...item })} className="cursor-pointer border-t border-white/[0.06] hover:bg-white/[0.025]"><td className="px-4 py-3"><p className="font-medium text-white">{item.title}</p><p className="mt-1 line-clamp-1 text-xs text-slate-600">{labelize(item.work_item_type)}{item.description ? ` · ${item.description}` : ''}</p></td><td className="px-4 py-3"><Status value={item.status} /></td><td className="px-4 py-3 text-slate-300">{labelize(item.priority)}</td><td className="px-4 py-3 text-slate-400">{ownerLabel(owners, item.assignee_id)}</td><td className="px-4 py-3 text-slate-400">{labelize(item.department_id) || 'Shared'}</td><td className="px-4 py-3 text-slate-400">{item.due_date || 'Not set'}</td></tr>)}</tbody></table>
      {!loading && !visibleItems.length && <div className="py-16 text-center text-sm text-slate-500">No work items match this view.</div>}
      {loading && <div className="py-16 text-center text-sm text-slate-500">Loading work items…</div>}
    </div> : <WorkItemsBoard columns={boardColumns} owners={owners} artifacts={workspace.workItemArtifacts || []} loading={loading} moving={moving} draggedItemId={draggedItemId} onDragStart={setDraggedItemId} onMove={moveWorkItem} onMoveWithinColumn={moveWithinColumn} onOpen={item => setEditor({ ...item })} />}
    {editor && <div className="fixed inset-0 z-50 flex justify-end bg-black/75"><form onSubmit={save} className="h-full w-full max-w-2xl overflow-y-auto border-l border-white/10 bg-[#111520] p-6"><div className="flex items-start justify-between gap-4"><div><p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-violet-400">Work item detail</p><h2 className="mt-1 text-xl font-semibold">{editor.id ? 'Edit work item' : 'Create work item'}</h2></div><button type="button" onClick={() => setEditor(null)} className="text-sm text-slate-500 hover:text-white">Close</button></div>
      <div className="mt-6 grid gap-4 sm:grid-cols-2"><div className="sm:col-span-2"><Field label="Title"><input required className={INPUT} value={editor.title} onChange={e => setEditor({ ...editor, title: e.target.value })} /></Field></div><div className="sm:col-span-2"><Field label="Description"><textarea rows="4" className={INPUT} value={editor.description} onChange={e => setEditor({ ...editor, description: e.target.value })} /></Field></div>
      <Field label="Type"><Select value={editor.work_item_type} onChange={work_item_type => setEditor({ ...editor, work_item_type })} options={WORK_ITEM_TYPES} /></Field><Field label="Priority"><Select value={editor.priority} onChange={priority => setEditor({ ...editor, priority })} options={WORK_ITEM_PRIORITIES} /></Field><Field label="Status"><Select value={editor.status} onChange={status => setEditor({ ...editor, status })} options={WORK_ITEM_STATUSES} /></Field><Field label="Department"><Select allowEmpty emptyLabel="Shared / no department" value={editor.department_id || ''} onChange={department_id => setEditor({ ...editor, department_id })} options={OPERATING_DEPARTMENTS.map(item => ({ value: item.id, label: item.name }))} /></Field>
      <Field label="Assignee"><Select allowEmpty emptyLabel="Unassigned" value={editor.assignee_id || ''} onChange={assignee_id => setEditor({ ...editor, assignee_id })} options={owners.map(owner => ({ value: owner.id, label: owner.label }))} /></Field><Field label="Position"><input type="number" min="0" className={INPUT} value={editor.position} onChange={e => setEditor({ ...editor, position: e.target.value })} /></Field><Field label="Start date"><input type="date" className={INPUT} value={editor.start_date || ''} onChange={e => setEditor({ ...editor, start_date: e.target.value })} /></Field><Field label="Due date"><input type="date" min={editor.start_date || undefined} className={INPUT} value={editor.due_date || ''} onChange={e => setEditor({ ...editor, due_date: e.target.value })} /></Field>
      <div className="sm:col-span-2 border-t border-white/[0.07] pt-5"><p className="text-sm font-semibold">Optional references</p><p className="mt-1 text-xs text-slate-500">References are storage-only in W1. They never change artifact or stage status.</p></div><Field label="Linked artifact"><Select allowEmpty emptyLabel="No linked artifact" value={editor.linked_artifact_id || ''} onChange={linked_artifact_id => setEditor({ ...editor, linked_artifact_id, linked_artifact_version_id: '' })} options={(workspace.workItemArtifacts || []).map(artifact => ({ value: artifact.id, label: `${artifact.title} · ${labelize(artifact.artifact_type)}` }))} /></Field><Field label="Artifact version"><Select allowEmpty emptyLabel="No specific version" value={editor.linked_artifact_version_id || ''} onChange={linked_artifact_version_id => setEditor({ ...editor, linked_artifact_version_id })} options={artifactVersions.map(version => ({ value: version.id, label: `Version ${version.version_number}` }))} /></Field><div className="sm:col-span-2"><Field label="Linked journey stage"><Select allowEmpty emptyLabel="No linked stage" value={editor.linked_engagement_stage_instance_id || ''} onChange={linked_engagement_stage_instance_id => setEditor({ ...editor, linked_engagement_stage_instance_id })} options={workspace.stages.map(stage => ({ value: stage.id, label: `${stage.name} · ${labelize(stage.accountable_department_id)}` }))} /></Field></div></div>
      {linkedArtifact && <a href={artifactRoute(linkedArtifact.artifact_type)} className="mt-5 block rounded-xl border border-violet-500/20 bg-violet-500/5 p-4 text-sm text-violet-300 hover:border-violet-400"><span className="font-semibold">{linkedArtifact.title}</span><span className="ml-2 text-xs text-slate-500">Open its department workspace →</span></a>}
      <div className="mt-7 flex items-center justify-between gap-3">{editor.id ? <button type="button" disabled={saving} onClick={remove} className="rounded-xl border border-red-800/60 px-4 py-2.5 text-sm font-semibold text-red-300 disabled:opacity-50">Remove from work list</button> : <span />}<button disabled={saving || !editor.title.trim()} className="rounded-xl bg-violet-500 px-5 py-2.5 text-sm font-semibold disabled:opacity-40">{saving ? 'Saving…' : 'Save work item'}</button></div>
    </form></div>}
  </section>
}

function WorkItemsBoard({ columns, owners, artifacts, loading, moving, draggedItemId, onDragStart, onMove, onMoveWithinColumn, onOpen }) {
  if (loading) return <div className="rounded-2xl border border-white/[0.07] bg-[#0e111a]/80 py-16 text-center text-sm text-slate-500">Loading work items…</div>
  return <div className="overflow-x-auto pb-2"><div className="grid min-w-[1180px] grid-cols-4 gap-4">
    {WORK_ITEM_BOARD_COLUMNS.map(column => <section key={column.value} aria-labelledby={`work-column-${column.value}`} onDragOver={event => event.preventDefault()} onDrop={() => draggedItemId && onMove(draggedItemId, column.value)} className="min-h-[420px] rounded-2xl border border-white/[0.07] bg-[#0e111a]/80 p-3">
      <header className="flex items-center justify-between px-1 py-2"><h3 id={`work-column-${column.value}`} className="text-sm font-semibold text-slate-200">{column.label}</h3><span className="rounded-full bg-white/[0.06] px-2 py-0.5 text-[11px] font-semibold text-slate-500">{columns[column.value].length}</span></header>
      <div className="mt-2 space-y-3">{columns[column.value].map((item, index) => <WorkItemCard key={item.id} item={item} index={index} columnLength={columns[column.value].length} owners={owners} artifact={artifacts.find(candidate => candidate.id === item.linked_artifact_id)} moving={moving} onDragStart={onDragStart} onMove={onMove} onMoveWithinColumn={onMoveWithinColumn} onOpen={onOpen} />)}</div>
      {!columns[column.value].length && <div className="mt-2 rounded-xl border border-dashed border-white/[0.08] px-3 py-12 text-center text-xs text-slate-600">Drop work here</div>}
    </section>)}
  </div></div>
}

function WorkItemCard({ item, index, columnLength, owners, artifact, moving, onDragStart, onMove, onMoveWithinColumn, onOpen }) {
  const priorityPalette = item.priority === 'urgent' ? 'bg-red-400' : item.priority === 'high' ? 'bg-amber-400' : item.priority === 'medium' ? 'bg-blue-400' : 'bg-slate-500'
  return <article draggable={!moving} onDragStart={event => { event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', item.id); onDragStart(item.id) }} onDragEnd={() => onDragStart('')} onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); event.stopPropagation(); const draggedId = event.dataTransfer.getData('text/plain'); if (draggedId && draggedId !== item.id) onMove(draggedId, item.status, item.id) }} className="rounded-xl border border-white/[0.08] bg-[#151a27] p-4 shadow-lg shadow-black/10 transition hover:border-violet-500/25">
    <div className="flex items-start gap-3"><span aria-label={`${labelize(item.priority)} priority`} title={`${labelize(item.priority)} priority`} className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full ${priorityPalette}`} /><button type="button" onClick={() => onOpen(item)} className="min-w-0 flex-1 text-left text-sm font-semibold leading-5 text-white hover:text-violet-300">{item.title}</button><span aria-hidden="true" className="cursor-grab text-slate-600">⋮⋮</span></div>
    <div className="mt-4 flex items-center justify-between gap-3"><span className="inline-flex min-w-0 items-center gap-2 text-xs text-slate-400"><span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-violet-500/15 text-[9px] font-bold text-violet-300">{ownerInitials(ownerLabel(owners, item.assignee_id))}</span><span className="truncate">{ownerLabel(owners, item.assignee_id)}</span></span>{item.due_date && <time dateTime={item.due_date} className="shrink-0 text-[11px] text-slate-500">Due {item.due_date}</time>}</div>
    {artifact && <a href={artifactRoute(artifact.artifact_type)} onClick={event => event.stopPropagation()} className="mt-3 inline-flex rounded-full bg-violet-500/10 px-2.5 py-1 text-[10px] font-semibold text-violet-300 hover:bg-violet-500/20">Linked artifact · {artifact.title}</a>}
    {!artifact && item.linked_artifact_id && <button type="button" onClick={() => onOpen(item)} className="mt-3 inline-flex rounded-full bg-violet-500/10 px-2.5 py-1 text-[10px] font-semibold text-violet-300">Linked artifact</button>}
    <div className="mt-4 flex items-center gap-2 border-t border-white/[0.06] pt-3"><select aria-label={`Move ${item.title} to status`} disabled={moving} value={item.status} onChange={event => onMove(item.id, event.target.value)} className="min-w-0 flex-1 rounded-lg border border-white/10 bg-black/20 px-2 py-1.5 text-[11px] text-slate-300 outline-none disabled:opacity-40">{WORK_ITEM_BOARD_COLUMNS.map(column => <option key={column.value} value={column.value}>{column.label}</option>)}</select><button type="button" aria-label={`Move ${item.title} up`} title="Move up" disabled={moving || index === 0} onClick={() => onMoveWithinColumn(item, 'up')} className="rounded-lg border border-white/10 px-2 py-1 text-xs text-slate-400 disabled:opacity-25">↑</button><button type="button" aria-label={`Move ${item.title} down`} title="Move down" disabled={moving || index === columnLength - 1} onClick={() => onMoveWithinColumn(item, 'down')} className="rounded-lg border border-white/10 px-2 py-1 text-xs text-slate-400 disabled:opacity-25">↓</button></div>
  </article>
}

function ownerInitials(label) {
  if (label === 'Unassigned') return '—'
  return label.split(/\s+/).slice(0, 2).map(part => part[0]).join('').toUpperCase()
}

function Filter({ label, value, onChange, options }) { return <Field label={label}><Select allowEmpty emptyLabel={`All ${label.toLowerCase()}`} value={value} onChange={onChange} options={options} /></Field> }
function Field({ label, children }) { return <label><span className={LABEL}>{label}</span>{children}</label> }
function Select({ value, onChange, options, allowEmpty = false, emptyLabel = 'Select' }) { return <select className={INPUT} value={value} onChange={e => onChange(e.target.value)}>{allowEmpty && <option value="">{emptyLabel}</option>}{options.map(option => { const item = typeof option === 'string' ? { value: option, label: labelize(option) } : option; return <option key={item.value} value={item.value}>{item.label}</option> })}</select> }
function Status({ value }) { const palette = value === 'blocked' ? 'bg-red-500/10 text-red-300' : value === 'done' ? 'bg-emerald-500/10 text-emerald-300' : value === 'in_progress' ? 'bg-blue-500/10 text-blue-300' : 'bg-slate-500/10 text-slate-300'; return <span className={`inline-flex rounded-full px-2.5 py-1 text-[11px] font-semibold ${palette}`}>{labelize(value)}</span> }
