import { useMemo, useState } from 'react'
import { buildPlanningWorkspace, PLANNING_VIEWS, PROJECT_TASK_STATUSES, WORK_ITEM_STATUSES } from '../data/planningModel.js'
import { planningRepository } from '../data/planningRepository.js'

const label = value => String(value || '').replaceAll('_', ' ').replace(/\b\w/g, letter => letter.toUpperCase())
const dateLabel = value => value || 'No date'
const tabs = { list: 'List', board: 'Board', calendar: 'Calendar', workload: 'Workload' }
const INPUT = 'rounded-lg border border-white/10 bg-black/20 px-2.5 py-2 text-xs text-white outline-none focus:border-violet-400'

export default function ProjectPlanningPanel({ workspace, organizationId, membership, onRefresh }) {
  const plan = useMemo(() => buildPlanningWorkspace(workspace), [workspace])
  const [view, setView] = useState('list')
  const [saving, setSaving] = useState('')
  const [error, setError] = useState('')
  const canManageTimezones = ['system_owner', 'operations_admin'].includes(membership?.role)

  async function mutate(key, action) {
    setSaving(key); setError('')
    try { await action(); await onRefresh() }
    catch (cause) {
      if (cause.status === 409) await onRefresh()
      setError(cause.status === 409 ? 'This record changed elsewhere. Your edits remain visible; review the refreshed record before deliberately reapplying them.' : cause.message)
    }
    finally { setSaving('') }
  }

  return <div className="space-y-5">
    <section className="rounded-2xl border border-white/[0.07] bg-white/[0.025] p-5">
      <div className="flex flex-wrap items-start justify-between gap-4"><div><h2 className="font-semibold">Planning & work management</h2><p className="mt-1 text-xs text-slate-500">One planning surface, two canonical record types. Their statuses and actions never translate into each other.</p></div><div className="flex gap-1">{PLANNING_VIEWS.map(item => <button type="button" key={item} aria-pressed={view === item} onClick={() => setView(item)} className={`rounded-lg px-3 py-2 text-xs ${view === item ? 'bg-violet-500 text-white' : 'border border-white/10 text-slate-400'}`}>{tabs[item]}</button>)}</div></div>
      <div className="mt-4 flex flex-wrap gap-2 text-xs"><Pill>Timezone: {plan.timezone}</Pill><Pill>Project Tasks: {plan.projectTasks.length}</Pill><Pill>Engagement Work Items: {plan.engagementWorkItems.length}</Pill></div>
      {error && <p role="alert" className="mt-4 rounded-xl border border-amber-500/20 bg-amber-500/10 p-3 text-sm text-amber-100">{error}</p>}
    </section>

    {view === 'list' && <ListView plan={plan} workspace={workspace} saving={saving} mutate={mutate} organizationId={organizationId} />}
    {view === 'board' && <BoardView plan={plan} saving={saving} mutate={mutate} organizationId={organizationId} />}
    {view === 'calendar' && <CalendarView plan={plan} />}
    {view === 'workload' && <WorkloadView plan={plan} workspace={workspace} />}

    <TimezoneSettings workspace={workspace} plan={plan} canManage={canManageTimezones} saving={saving} mutate={mutate} organizationId={organizationId} />
  </div>
}

function ListView({ plan, workspace, saving, mutate, organizationId }) {
  return <div className="grid gap-5 xl:grid-cols-2">
    <Section title="Project Tasks" note="Due date, creation time, then ID. Manual reordering is intentionally unavailable.">
      <Rows rows={plan.projectTasks} saving={saving} renderAction={record => <RecordEditor record={record} workspace={workspace} disabled={saving === record.key} save={changes => mutate(record.key, () => planningRepository.updateProjectTask(organizationId, record.source, changes))} />} />
    </Section>
    <Section title="Engagement Work Items" note="Native position order is retained; handoffs and dependencies remain attached to the work item.">
      <Rows rows={plan.engagementWorkItems} saving={saving} renderAction={record => <RecordEditor record={record} workspace={workspace} disabled={saving === record.key} save={changes => mutate(record.key, () => planningRepository.updateWorkItem(organizationId, record.source, changes))} />} />
    </Section>
  </div>
}

function RecordEditor({ record, workspace, disabled, save }) {
  const isTask = record.recordKind === 'project_task'
  const [status, setStatus] = useState(record.status)
  const [assigneeId, setAssigneeId] = useState(record.assigneeId || '')
  const [departmentId, setDepartmentId] = useState(record.departmentId || '')
  const [startDate, setStartDate] = useState(record.startDate || '')
  const [dueDate, setDueDate] = useState(record.dueDate || '')
  const departments = [...new Map((workspace.workstreams || []).map(item => [item.department_id, item])).values()]
  const changes = isTask
    ? { status, assignedTo: assigneeId || null, dueDate: dueDate || null }
    : { assigneeId: assigneeId || null, departmentId: departmentId || null, startDate: startDate || null, dueDate: dueDate || null }
  return <div className="mt-3 grid gap-2 border-t border-white/[0.06] pt-3 sm:grid-cols-2">
    {isTask && <label className="text-[10px] text-slate-500">Status<select className={`${INPUT} mt-1 w-full`} value={status} disabled={disabled} onChange={event => setStatus(event.target.value)}>{PROJECT_TASK_STATUSES.map(value => <option key={value} value={value}>{label(value)}</option>)}</select></label>}
    {!isTask && <label className="text-[10px] text-slate-500">Handoff department<select className={`${INPUT} mt-1 w-full`} value={departmentId} disabled={disabled} onChange={event => setDepartmentId(event.target.value)}><option value="">Unassigned</option>{departments.map(item => <option key={item.department_id} value={item.department_id}>{label(item.department_id)}</option>)}</select></label>}
    <label className="text-[10px] text-slate-500">Assignee<select className={`${INPUT} mt-1 w-full`} value={assigneeId} disabled={disabled} onChange={event => setAssigneeId(event.target.value)}><option value="">Unassigned</option>{(workspace.teamMembers || []).map(member => <option key={member.id} value={member.id}>{member.name}</option>)}</select></label>
    {!isTask && <label className="text-[10px] text-slate-500">Start date<input type="date" className={`${INPUT} mt-1 w-full`} value={startDate} disabled={disabled} onChange={event => setStartDate(event.target.value)} /></label>}
    <label className="text-[10px] text-slate-500">Due date<input type="date" className={`${INPUT} mt-1 w-full`} value={dueDate} disabled={disabled} onChange={event => setDueDate(event.target.value)} /></label>
    <button type="button" disabled={disabled} onClick={() => save(changes)} className="self-end rounded-lg border border-violet-500/25 px-3 py-2 text-xs text-violet-200 disabled:opacity-40">Save {isTask ? 'Project Task' : 'Work Item'}</button>
  </div>
}

function BoardView({ plan, saving, mutate, organizationId }) {
  return <div className="space-y-5">
    <Section title="Project Task lifecycle" note="Eight native states; Project Tasks are not draggable.">{<Columns statuses={PROJECT_TASK_STATUSES} groups={plan.board.projectTasks} />}</Section>
    <Section title="Engagement Work Item lifecycle" note="Four native states. Moving a card atomically updates this engagement’s target-column order.">
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">{WORK_ITEM_STATUSES.map(status => <div key={status} className="rounded-xl border border-white/[0.06] bg-black/10 p-3"><p className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">{label(status)}</p>{plan.board.engagementWorkItems[status].map(record => <div key={record.key} className="mb-2 rounded-lg border border-white/[0.06] bg-white/[0.025] p-3"><p className="text-sm">{record.title}</p><select aria-label={`Move ${record.title}`} className={`${INPUT} mt-2 w-full`} value={record.status} disabled={saving === record.key} onChange={event => mutate(record.key, () => planningRepository.moveWorkItem(organizationId, record.source, event.target.value))}>{WORK_ITEM_STATUSES.map(next => <option key={next} value={next}>{label(next)}</option>)}</select></div>)}</div>)}</div>
    </Section>
  </div>
}

function CalendarView({ plan }) {
  return <Section title="Due-date calendar" note={`Date-only values are shown exactly as stored; no browser-timezone shift is applied. Effective timezone: ${plan.timezone}.`}><div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{plan.calendar.map(([day, rows]) => <div key={day} className="rounded-xl border border-white/[0.06] bg-black/10 p-3"><p className="text-xs font-semibold text-violet-300">{day === 'undated' ? 'Unscheduled' : day}</p><Rows rows={rows} compact /></div>)}</div></Section>
}

function WorkloadView({ plan, workspace }) {
  const names = new Map((workspace.teamMembers || []).map(member => [member.id, member.name]))
  return <Section title="Workload" note="Current open records, counted separately by canonical type."><div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{plan.workload.map(row => <div key={row.assigneeId} className="rounded-xl border border-white/[0.06] bg-black/10 p-4"><p className="font-medium">{names.get(row.assigneeId) || (row.assigneeId === 'unassigned' ? 'Unassigned' : 'Unknown member')}</p><p className="mt-2 text-xs text-slate-500">{row.projectTasks} Project Tasks · {row.engagementWorkItems} Engagement Work Items</p><p className="mt-1 text-xs text-amber-300">{row.blocked} blocked · {row.due} scheduled</p></div>)}</div></Section>
}

function TimezoneSettings({ workspace, plan, canManage, saving, mutate, organizationId }) {
  const [projectTimezone, setProjectTimezone] = useState(workspace.project.planning_timezone || '')
  const [clientTimezone, setClientTimezone] = useState(workspace.context.client?.default_timezone || '')
  return <Section title="Planning timezone" note="Project override → client default → UTC. Internal projects use project override → UTC. Retainer recurrence keeps its immutable plan-version timezone.">
    <div className="grid gap-3 md:grid-cols-2"><label className="text-xs text-slate-400">Project override<input className={`${INPUT} mt-2 w-full`} value={projectTimezone} disabled={!canManage || saving === 'project-timezone'} onChange={event => setProjectTimezone(event.target.value)} placeholder="Europe/London" /></label>{workspace.context.client && <label className="text-xs text-slate-400">Client default<input className={`${INPUT} mt-2 w-full`} value={clientTimezone} disabled={!canManage || saving === 'client-timezone'} onChange={event => setClientTimezone(event.target.value)} placeholder="Asia/Karachi" /></label>}</div>
    <div className="mt-3 flex flex-wrap gap-2"><button type="button" disabled={!canManage || saving} onClick={() => mutate('project-timezone', () => planningRepository.setTimezone(organizationId, 'project', workspace.project.id, projectTimezone))} className="rounded-lg border border-violet-500/25 px-3 py-2 text-xs text-violet-200 disabled:opacity-40">Save project timezone</button>{workspace.context.client && <button type="button" disabled={!canManage || saving} onClick={() => mutate('client-timezone', () => planningRepository.setTimezone(organizationId, 'client', workspace.context.client.id, clientTimezone))} className="rounded-lg border border-violet-500/25 px-3 py-2 text-xs text-violet-200 disabled:opacity-40">Save client default</button>}<Pill>Effective: {plan.timezone}</Pill></div>
    {!canManage && <p className="mt-3 text-xs text-slate-600">Only System Owners and Operations Admins can change planning timezones.</p>}
  </Section>
}

function Rows({ rows, renderAction, compact = false, saving }) {
  if (!rows.length) return <p className="text-sm text-slate-500">No records.</p>
  return <div className="space-y-2">{rows.map(record => <div key={record.key} className="rounded-xl border border-white/[0.06] bg-black/10 p-3"><div><p className="text-sm font-medium">{record.title}</p><p className="mt-1 text-[11px] text-slate-500">{record.recordKind === 'project_task' ? 'Project Task' : 'Engagement Work Item'} · {label(record.status)}{!compact ? ` · Due ${dateLabel(record.dueDate)}` : ''}</p>{record.dependencies.length > 0 && <p className="mt-1 text-[11px] text-amber-300">{record.dependencies.length} recorded dependenc{record.dependencies.length === 1 ? 'y' : 'ies'}</p>}</div>{renderAction?.(record, saving)}</div>)}</div>
}

function Columns({ statuses, groups }) { return <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">{statuses.map(status => <div key={status} className="rounded-xl border border-white/[0.06] bg-black/10 p-3"><p className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">{label(status)}</p><Rows rows={groups[status]} compact /></div>)}</div> }
function Section({ title, note, children }) { return <section className="rounded-2xl border border-white/[0.07] bg-white/[0.025] p-5"><h3 className="font-semibold">{title}</h3><p className="mt-1 text-xs leading-5 text-slate-500">{note}</p><div className="mt-4">{children}</div></section> }
function Pill({ children }) { return <span className="rounded-full border border-violet-500/20 bg-violet-500/10 px-2.5 py-1 text-violet-200">{children}</span> }
