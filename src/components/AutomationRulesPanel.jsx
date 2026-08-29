import { useCallback, useEffect, useState } from 'react'

import {
  AUTOMATION_ACTION_TYPES,
  AUTOMATION_TRIGGER_TYPES,
  WORK_ITEM_STATUSES,
} from '../data/workItems.js'
import { workItems } from '../data/workItemsRepository.js'

const INPUT = 'w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2.5 text-sm text-white outline-none focus:border-violet-500/60'
const LABEL = 'mb-1.5 block text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500'
const labelize = value => String(value || '').replaceAll('_', ' ').replace(/\b\w/g, letter => letter.toUpperCase())

const EMPTY_RULE = Object.freeze({
  name: '',
  triggerType: 'artifact_approved',
  conditionStatus: '',
  actionType: 'move_status',
  actionTargetStatus: 'done',
})

export default function AutomationRulesPanel({ organizationId }) {
  const [rules, setRules] = useState([])
  const [draft, setDraft] = useState({ ...EMPTY_RULE })
  const [creating, setCreating] = useState(false)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setError('')
    try { setRules(await workItems.listAutomationRules(organizationId) || []) }
    catch (loadError) { setError(loadError.message) }
  }, [organizationId])

  useEffect(() => { load() }, [load])

  async function createRule(event) {
    event.preventDefault()
    setBusy('create'); setError('')
    try {
      const created = await workItems.createAutomationRule({ ...draft, organizationId })
      setRules(current => [...current, created])
      setDraft({ ...EMPTY_RULE })
      setCreating(false)
    } catch (createError) { setError(createError.message) }
    finally { setBusy('') }
  }

  async function toggle(rule) {
    if (rule.trigger_type === 'due_date_arrived' && !rule.enabled) return
    setBusy(rule.id); setError('')
    try {
      const updated = await workItems.toggleAutomationRule(rule.id, !rule.enabled)
      setRules(current => current.map(item => item.id === updated.id ? updated : item))
    } catch (toggleError) { setError(toggleError.message) }
    finally { setBusy('') }
  }

  return <section className="rounded-2xl border border-white/[0.07] bg-[#0e111a]/80 p-5">
    <div className="flex flex-wrap items-start justify-between gap-4"><div><h3 className="font-semibold">Automation rules</h3><p className="mt-1 max-w-2xl text-xs leading-5 text-slate-500">A fixed rule library for existing work-item and approval events. Rules never lock manual movement.</p></div><button type="button" onClick={() => setCreating(value => !value)} className="rounded-xl border border-violet-500/30 px-4 py-2 text-xs font-semibold text-violet-300">{creating ? 'Cancel' : 'New rule'}</button></div>
    <div className="mt-4 rounded-xl border border-amber-500/20 bg-amber-500/5 px-4 py-3 text-xs leading-5 text-amber-200"><span className="font-semibold">Due date trigger:</span> visible in the closed library, but scheduled execution is deferred in W5. Due-date rules are created disabled.</div>
    {error && <div className="mt-4 rounded-xl border border-red-900/60 bg-red-950/40 px-4 py-3 text-sm text-red-300">{error}</div>}
    {creating && <form onSubmit={createRule} className="mt-5 grid gap-4 rounded-xl border border-white/[0.07] bg-black/10 p-4 md:grid-cols-2">
      <Field label="Rule name"><input required maxLength="120" className={INPUT} value={draft.name} onChange={event => setDraft({ ...draft, name: event.target.value })} /></Field>
      <Field label="Trigger"><Select value={draft.triggerType} options={AUTOMATION_TRIGGER_TYPES} onChange={triggerType => setDraft({ ...draft, triggerType })} /></Field>
      {draft.triggerType === 'due_date_arrived' && <Field label="Due-date condition"><input className={INPUT} placeholder="e.g. status is not done" value={draft.conditionStatus} onChange={event => setDraft({ ...draft, conditionStatus: event.target.value })} /></Field>}
      <Field label="Action"><Select value={draft.actionType} options={AUTOMATION_ACTION_TYPES} onChange={actionType => setDraft({ ...draft, actionType })} /></Field>
      {draft.actionType === 'move_status' && <Field label="Target status"><Select value={draft.actionTargetStatus} options={WORK_ITEM_STATUSES} onChange={actionTargetStatus => setDraft({ ...draft, actionTargetStatus })} /></Field>}
      {draft.actionType === 'notify_assignee' && <p className="self-end rounded-xl bg-violet-500/5 px-3 py-2.5 text-xs leading-5 text-violet-200">Adds an in-app badge to the assigned work item. No email or push delivery is created.</p>}
      <div className="md:col-span-2 flex justify-end"><button disabled={busy === 'create' || !draft.name.trim()} className="rounded-xl bg-violet-500 px-4 py-2.5 text-sm font-semibold disabled:opacity-40">{busy === 'create' ? 'Creating…' : 'Create rule'}</button></div>
    </form>}
    <div className="mt-5 space-y-3">{rules.map(rule => <article key={rule.id} className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-white/[0.07] bg-white/[0.025] p-4"><div><div className="flex flex-wrap items-center gap-2"><p className="text-sm font-semibold text-white">{rule.name}</p>{rule.trigger_type === 'due_date_arrived' && <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold text-amber-300">Scheduler deferred</span>}</div><p className="mt-1 text-xs text-slate-500">When {labelize(rule.trigger_type)} → {labelize(rule.action_type)}{rule.action_target_status ? ` · ${labelize(rule.action_target_status)}` : ''}</p></div><button type="button" role="switch" aria-checked={rule.enabled} disabled={busy === rule.id || (rule.trigger_type === 'due_date_arrived' && !rule.enabled)} onClick={() => toggle(rule)} className={`rounded-full px-3 py-1.5 text-xs font-semibold disabled:opacity-40 ${rule.enabled ? 'bg-emerald-500/15 text-emerald-300' : 'bg-slate-500/10 text-slate-400'}`}>{rule.enabled ? 'Enabled' : 'Disabled'}</button></article>)}{!rules.length && <p className="py-10 text-center text-sm text-slate-500">No automation rules yet.</p>}</div>
  </section>
}

function Field({ label, children }) { return <label><span className={LABEL}>{label}</span>{children}</label> }
function Select({ value, onChange, options }) { return <select className={INPUT} value={value} onChange={event => onChange(event.target.value)}>{options.map(option => <option key={option} value={option}>{labelize(option)}</option>)}</select> }
