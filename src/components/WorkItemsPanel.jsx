import { useCallback, useEffect, useMemo, useState } from 'react'

import { OPERATING_DEPARTMENTS } from '../data/operatingSpineRepository.js'
import {
  artifactRoute,
  EMPTY_WORK_ITEM,
  filterAndSortWorkItems,
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
  const [filters, setFilters] = useState({ status: '', assignee: '', department: '', priority: '', due: '' })
  const [sort, setSort] = useState({ key: 'position', direction: 'asc' })
  const [editor, setEditor] = useState(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const loadItems = useCallback(async () => {
    setLoading(true); setError('')
    try { setItems(await workItems.list(workspace.engagement.id) || []) }
    catch (loadError) { setError(loadError.message) }
    finally { setLoading(false) }
  }, [workspace.engagement.id])

  useEffect(() => { loadItems() }, [loadItems])

  const visibleItems = useMemo(() => filterAndSortWorkItems(items, filters, sort), [items, filters, sort])
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
      await workItems.save({
        workItemId: editor.id || null,
        engagementId: workspace.engagement.id,
        title: editor.title,
        description: editor.description,
        workItemType: editor.work_item_type,
        priority: editor.priority,
        status: editor.status,
        assigneeId: editor.assignee_id || null,
        departmentId: editor.department_id || null,
        linkedArtifactId: editor.linked_artifact_id || null,
        linkedArtifactVersionId: editor.linked_artifact_version_id || null,
        linkedEngagementStageInstanceId: editor.linked_engagement_stage_instance_id || null,
        startDate: editor.start_date || null,
        dueDate: editor.due_date || null,
        position: Number(editor.position || 0),
      })
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

  const linkedArtifact = editor && (workspace.workItemArtifacts || []).find(item => item.id === editor.linked_artifact_id)
  const artifactVersions = editor?.linked_artifact_id ? versionsByArtifact.get(editor.linked_artifact_id) || [] : []

  return <section className="mt-7 space-y-5">
    <div className="flex flex-wrap items-start justify-between gap-4"><div><h2 className="text-xl font-semibold">Work</h2><p className="mt-1 text-sm text-slate-500">One shared engagement list across Content, Design, Marketing, and Development.</p></div><button onClick={openNew} className="rounded-xl bg-violet-500 px-4 py-2.5 text-sm font-semibold">New work item</button></div>
    {error && <div className="rounded-xl border border-red-900/60 bg-red-950/40 px-4 py-3 text-sm text-red-300">{error}</div>}
    <div className="grid gap-3 rounded-2xl border border-white/[0.07] bg-[#0e111a]/80 p-4 sm:grid-cols-2 xl:grid-cols-5">
      <Filter label="Status" value={filters.status} onChange={status => setFilters({ ...filters, status })} options={WORK_ITEM_STATUSES} />
      <Filter label="Assignee" value={filters.assignee} onChange={assignee => setFilters({ ...filters, assignee })} options={owners.map(owner => ({ value: owner.id, label: owner.label }))} />
      <Filter label="Department" value={filters.department} onChange={department => setFilters({ ...filters, department })} options={OPERATING_DEPARTMENTS.map(item => ({ value: item.id, label: item.name }))} />
      <Filter label="Priority" value={filters.priority} onChange={priority => setFilters({ ...filters, priority })} options={WORK_ITEM_PRIORITIES} />
      <Filter label="Due date" value={filters.due} onChange={due => setFilters({ ...filters, due })} options={[{ value: 'overdue', label: 'Overdue' }, { value: 'next_7_days', label: 'Next 7 days' }, { value: 'no_due_date', label: 'No due date' }]} />
    </div>
    <div className="overflow-x-auto rounded-2xl border border-white/[0.07] bg-[#0e111a]/80">
      <table className="w-full min-w-[980px] text-left text-sm"><thead className="bg-black/20 text-[10px] uppercase tracking-[0.12em] text-slate-500"><tr>
        {[['title', 'Work item'], ['status', 'Status'], ['priority', 'Priority'], ['assignee_id', 'Assignee'], ['department_id', 'Department'], ['due_date', 'Due']].map(([key, label]) => <th key={key} className="px-4 py-3"><button onClick={() => toggleSort(key)} className="font-semibold hover:text-white">{label}{sortIndicator(sort, key)}</button></th>)}
      </tr></thead><tbody>{visibleItems.map(item => <tr key={item.id} onClick={() => setEditor({ ...item })} className="cursor-pointer border-t border-white/[0.06] hover:bg-white/[0.025]"><td className="px-4 py-3"><p className="font-medium text-white">{item.title}</p><p className="mt-1 line-clamp-1 text-xs text-slate-600">{labelize(item.work_item_type)}{item.description ? ` · ${item.description}` : ''}</p></td><td className="px-4 py-3"><Status value={item.status} /></td><td className="px-4 py-3 text-slate-300">{labelize(item.priority)}</td><td className="px-4 py-3 text-slate-400">{ownerLabel(owners, item.assignee_id)}</td><td className="px-4 py-3 text-slate-400">{labelize(item.department_id) || 'Shared'}</td><td className="px-4 py-3 text-slate-400">{item.due_date || 'Not set'}</td></tr>)}</tbody></table>
      {!loading && !visibleItems.length && <div className="py-16 text-center text-sm text-slate-500">No work items match this view.</div>}
      {loading && <div className="py-16 text-center text-sm text-slate-500">Loading work items…</div>}
    </div>
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

function Filter({ label, value, onChange, options }) { return <Field label={label}><Select allowEmpty emptyLabel={`All ${label.toLowerCase()}`} value={value} onChange={onChange} options={options} /></Field> }
function Field({ label, children }) { return <label><span className={LABEL}>{label}</span>{children}</label> }
function Select({ value, onChange, options, allowEmpty = false, emptyLabel = 'Select' }) { return <select className={INPUT} value={value} onChange={e => onChange(e.target.value)}>{allowEmpty && <option value="">{emptyLabel}</option>}{options.map(option => { const item = typeof option === 'string' ? { value: option, label: labelize(option) } : option; return <option key={item.value} value={item.value}>{item.label}</option> })}</select> }
function Status({ value }) { const palette = value === 'blocked' ? 'bg-red-500/10 text-red-300' : value === 'done' ? 'bg-emerald-500/10 text-emerald-300' : value === 'in_progress' ? 'bg-blue-500/10 text-blue-300' : 'bg-slate-500/10 text-slate-300'; return <span className={`inline-flex rounded-full px-2.5 py-1 text-[11px] font-semibold ${palette}`}>{labelize(value)}</span> }
