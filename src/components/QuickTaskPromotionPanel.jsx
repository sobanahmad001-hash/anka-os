import { useEffect, useMemo, useState } from 'react'

import { quickTasks } from '../data/quickTasksRepository.js'

const INPUT = 'w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2.5 text-sm text-white outline-none focus:border-violet-500/60 disabled:opacity-50'
const DEPARTMENTS = ['content', 'design', 'development', 'marketing']
const ARTIFACT_TYPES = Object.freeze({
  content: ['discovery', 'vision', 'audience', 'website_architecture', 'keyword_strategy', 'content', 'campaign_messaging', 'scripts'],
  design: ['design_system'],
  development: ['technical_brief', 'launch_checklist'],
  marketing: ['channel_strategy', 'campaign_brief', 'measurement_plan'],
})
const EMPTY = Object.freeze({ clients: [], engagements: [], artifacts: [], members: [] })
const label = value => String(value || '').replaceAll('_', ' ').replace(/\b\w/g, letter => letter.toUpperCase())
const memberLabel = member => member.profile?.full_name || member.profile?.email || member.user_id

function initialMapping(task, revision) {
  const checklist = Array.isArray(revision?.content?.checklist)
    ? revision.content.checklist.map(item => typeof item === 'string' ? item : item?.text).filter(Boolean)
    : []
  return {
    name: task.title, title: task.title, description: String(revision?.content?.notes || ''),
    clientId: '', ownerId: '', departmentId: '', priority: 'medium', startDate: '', dueDate: '',
    scopeStatement: '', exclusions: '', engagementId: '', workItemType: 'task', assigneeId: '',
    assigneeConfirmed: false, artifactDepartmentId: 'development', artifactType: 'technical_brief',
    artifactId: '', artifactContent: JSON.stringify({ notes: String(revision?.content?.notes || ''), checklist }, null, 2),
    changeSummary: 'Promoted from Quick Tasks',
  }
}

function destinationPreview(target, mapping, options) {
  if (target === 'project') return {
    record: 'projects', name: mapping.name, description: mapping.description,
    client_id: mapping.clientId || null, engagement_type: mapping.clientId ? 'project' : 'internal',
    status: 'planning', portal_visible: false,
  }
  if (target === 'work_item') return {
    record: 'work_items', engagement_id: mapping.engagementId || null, title: mapping.title,
    description: mapping.description, work_item_type: mapping.workItemType,
    priority: mapping.priority, status: 'not_started', assignee_id: mapping.assigneeId || null,
    created_via: 'quick_task_promotion',
  }
  return {
    record: mapping.artifactId ? 'artifact_versions' : 'artifacts + artifact_versions',
    engagement_id: mapping.engagementId || null, department_id: mapping.artifactDepartmentId,
    artifact_type: mapping.artifactType, artifact_id: mapping.artifactId || null,
    title: mapping.title, data_classification: 'internal', ai_use_allowed: false,
    target: options.artifacts.find(item => item.id === mapping.artifactId)?.title || null,
  }
}

function Field({ label: title, children }) {
  return <label className="block text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">{title}{children}</label>
}

export default function QuickTaskPromotionPanel({ task, revision, organizationId, onPromoted }) {
  const [options, setOptions] = useState(EMPTY)
  const [target, setTarget] = useState('project')
  const [mapping, setMapping] = useState(() => initialMapping(task, revision))
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID())
  const [confirmed, setConfirmed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [result, setResult] = useState(null)

  useEffect(() => {
    let active = true
    setLoading(true); setError(''); setResult(null); setConfirmed(false)
    setMapping(initialMapping(task, revision)); setIdempotencyKey(crypto.randomUUID())
    quickTasks.promotionOptions(organizationId)
      .then(value => { if (active) setOptions(value) })
      .catch(reason => { if (active) setError(reason.message) })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [organizationId, task, revision])

  const artifactTypes = ARTIFACT_TYPES[mapping.artifactDepartmentId] || []
  const eligibleEngagements = useMemo(() => target === 'artifact'
    ? options.engagements.filter(item => item.active_departments.includes(mapping.artifactDepartmentId))
    : options.engagements, [mapping.artifactDepartmentId, options.engagements, target])
  const artifacts = options.artifacts.filter(item => item.engagement_id === mapping.engagementId && item.artifact_type === mapping.artifactType)
  const preview = destinationPreview(target, mapping, options)
  const update = (key, value) => setMapping(current => ({ ...current, [key]: value }))

  async function promote(event) {
    event.preventDefault(); setBusy(true); setError('')
    try {
      let destination
      if (target === 'project') destination = {
        name: mapping.name, description: mapping.description, clientId: mapping.clientId,
        ownerId: mapping.ownerId, departmentId: mapping.departmentId, priority: mapping.priority,
        startDate: mapping.startDate, dueDate: mapping.dueDate,
        scopeStatement: mapping.scopeStatement, exclusions: mapping.exclusions,
      }
      else if (target === 'work_item') destination = {
        engagementId: mapping.engagementId, title: mapping.title, description: mapping.description,
        workItemType: mapping.workItemType, priority: mapping.priority,
        departmentId: mapping.departmentId, assigneeId: mapping.assigneeId,
        assigneeConfirmed: mapping.assigneeConfirmed, startDate: mapping.startDate, dueDate: mapping.dueDate,
      }
      else destination = {
        engagementId: mapping.engagementId, departmentId: mapping.artifactDepartmentId,
        artifactType: mapping.artifactType, artifactId: mapping.artifactId,
        title: mapping.title, content: JSON.parse(mapping.artifactContent),
        changeSummary: mapping.changeSummary,
      }
      const value = await quickTasks.promote({
        quickTaskId: task.id, expectedRevisionId: revision.id,
        expectedContentSha256: revision.content_sha256, targetKind: target,
        mapping: destination, idempotencyKey, humanConfirmed: confirmed,
      })
      setResult(value); await onPromoted(value)
    } catch (reason) { setError(reason.message) }
    finally { setBusy(false) }
  }

  return <section className="rounded-2xl border border-emerald-500/20 bg-emerald-950/10 p-5">
    <div><p className="text-xs font-semibold uppercase tracking-[0.14em] text-emerald-300">Deliberate promotion</p><h2 className="mt-1 font-semibold text-white">Copy this exact revision into one canonical record</h2><p className="mt-1 text-xs text-slate-400">Promotion is terminal for this Quick Task. The source and checksum remain as provenance; no approval, release, projection, workflow, or execution is created.</p></div>
    {error && <p className="mt-4 rounded-xl border border-red-900/60 bg-red-950/40 px-3 py-2 text-sm text-red-300">{error}</p>}
    {result ? <p className="mt-4 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-200">Promotion complete · {label(result.target_kind)} destination created.</p> : <form onSubmit={promote} className="mt-5 space-y-5">
      <Field label="Canonical destination"><select className={INPUT + ' mt-2'} value={target} onChange={event => { setTarget(event.target.value); setConfirmed(false) }}><option value="project">Project</option><option value="work_item">Work item</option><option value="artifact">Artifact</option></select></Field>
      {target === 'project' && <div className="grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2"><Field label="Project name"><input required maxLength="240" className={INPUT + ' mt-2'} value={mapping.name} onChange={event => update('name', event.target.value)} /></Field></div>
        <div className="sm:col-span-2"><Field label="Description"><textarea rows="4" className={INPUT + ' mt-2'} value={mapping.description} onChange={event => update('description', event.target.value)} /></Field></div>
        <Field label="Optional client"><select className={INPUT + ' mt-2'} value={mapping.clientId} onChange={event => update('clientId', event.target.value)}><option value="">No client · internal project</option>{options.clients.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></Field>
        <Field label="Owner"><select className={INPUT + ' mt-2'} value={mapping.ownerId} onChange={event => update('ownerId', event.target.value)}><option value="">Me (promoter)</option>{options.members.map(item => <option key={item.user_id} value={item.user_id}>{memberLabel(item)}</option>)}</select></Field>
        <Field label="Department"><select className={INPUT + ' mt-2'} value={mapping.departmentId} onChange={event => update('departmentId', event.target.value)}><option value="">Shared</option>{DEPARTMENTS.map(item => <option key={item} value={item}>{label(item)}</option>)}</select></Field>
        <Field label="Priority"><select className={INPUT + ' mt-2'} value={mapping.priority} onChange={event => update('priority', event.target.value)}>{['low', 'medium', 'high', 'urgent'].map(item => <option key={item} value={item}>{label(item)}</option>)}</select></Field>
      </div>}
      {target === 'work_item' && <div className="grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2"><Field label="Engagement"><select required className={INPUT + ' mt-2'} value={mapping.engagementId} onChange={event => update('engagementId', event.target.value)}><option value="">Select engagement</option>{eligibleEngagements.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></Field></div>
        <div className="sm:col-span-2"><Field label="Title"><input required maxLength="240" className={INPUT + ' mt-2'} value={mapping.title} onChange={event => update('title', event.target.value)} /></Field></div>
        <div className="sm:col-span-2"><Field label="Description"><textarea rows="4" className={INPUT + ' mt-2'} value={mapping.description} onChange={event => update('description', event.target.value)} /></Field></div>
        <Field label="Type"><select className={INPUT + ' mt-2'} value={mapping.workItemType} onChange={event => update('workItemType', event.target.value)}>{['task', 'bug', 'request'].map(item => <option key={item} value={item}>{label(item)}</option>)}</select></Field>
        <Field label="Department"><select className={INPUT + ' mt-2'} value={mapping.departmentId} onChange={event => update('departmentId', event.target.value)}><option value="">Shared</option>{DEPARTMENTS.map(item => <option key={item} value={item}>{label(item)}</option>)}</select></Field>
        <Field label="Assignee"><select className={INPUT + ' mt-2'} value={mapping.assigneeId} onChange={event => setMapping(current => ({ ...current, assigneeId: event.target.value, assigneeConfirmed: false }))}><option value="">Unassigned</option>{options.members.map(item => <option key={item.user_id} value={item.user_id}>{memberLabel(item)}</option>)}</select></Field>
        {mapping.assigneeId && <label className="flex items-start gap-2 self-end text-xs text-slate-300"><input type="checkbox" checked={mapping.assigneeConfirmed} onChange={event => update('assigneeConfirmed', event.target.checked)} /><span>I explicitly confirm this assignee.</span></label>}
      </div>}
      {target === 'artifact' && <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Department"><select className={INPUT + ' mt-2'} value={mapping.artifactDepartmentId} onChange={event => { const department = event.target.value; setMapping(current => ({ ...current, artifactDepartmentId: department, artifactType: ARTIFACT_TYPES[department][0], engagementId: '', artifactId: '' })) }}>{DEPARTMENTS.map(item => <option key={item} value={item}>{label(item)}</option>)}</select></Field>
        <Field label="Artifact type"><select className={INPUT + ' mt-2'} value={mapping.artifactType} onChange={event => setMapping(current => ({ ...current, artifactType: event.target.value, artifactId: '' }))}>{artifactTypes.map(item => <option key={item} value={item}>{label(item)}</option>)}</select></Field>
        <div className="sm:col-span-2"><Field label="Eligible engagement"><select required className={INPUT + ' mt-2'} value={mapping.engagementId} onChange={event => setMapping(current => ({ ...current, engagementId: event.target.value, artifactId: '' }))}><option value="">Select engagement with an active {label(mapping.artifactDepartmentId)} service</option>{eligibleEngagements.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></Field></div>
        <div className="sm:col-span-2"><Field label="Existing artifact (optional)"><select className={INPUT + ' mt-2'} value={mapping.artifactId} onChange={event => update('artifactId', event.target.value)}><option value="">Create a new artifact identity</option>{artifacts.map(item => <option key={item.id} value={item.id}>{item.title}</option>)}</select></Field></div>
        {!mapping.artifactId && <div className="sm:col-span-2"><Field label="Artifact title"><input required maxLength="240" className={INPUT + ' mt-2'} value={mapping.title} onChange={event => update('title', event.target.value)} /></Field></div>}
        <div className="sm:col-span-2"><Field label="Validated destination content (JSON)"><textarea required rows="12" className={INPUT + ' mt-2 font-mono text-xs'} value={mapping.artifactContent} onChange={event => update('artifactContent', event.target.value)} /></Field></div>
        <div className="sm:col-span-2"><Field label="Change summary"><input maxLength="1000" className={INPUT + ' mt-2'} value={mapping.changeSummary} onChange={event => update('changeSummary', event.target.value)} /></Field></div>
      </div>}
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-xl border border-white/[0.07] bg-black/20 p-4"><p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Source · exact revision {task.current_revision_number}</p><pre className="mt-3 max-h-64 overflow-auto whitespace-pre-wrap text-xs text-slate-300">{JSON.stringify({ title: task.title, revision_id: revision.id, content_sha256: revision.content_sha256, content: revision.content }, null, 2)}</pre></div>
        <div className="rounded-xl border border-emerald-500/20 bg-black/20 p-4"><p className="text-xs font-semibold uppercase tracking-wider text-emerald-400">Destination mapping diff</p><pre className="mt-3 max-h-64 overflow-auto whitespace-pre-wrap text-xs text-slate-300">{JSON.stringify(preview, null, 2)}</pre></div>
      </div>
      <label className="flex items-start gap-2 text-sm text-slate-300"><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} /><span>I reviewed this exact revision and destination mapping. Create one canonical copy and make this Quick Task terminal.</span></label>
      <div className="flex justify-end"><button disabled={busy || loading || !confirmed || (mapping.assigneeId && !mapping.assigneeConfirmed)} className="rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-40">{busy ? 'Promoting…' : loading ? 'Loading destinations…' : 'Confirm promotion'}</button></div>
    </form>}
  </section>
}
