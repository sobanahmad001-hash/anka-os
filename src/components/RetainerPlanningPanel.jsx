import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { recurringPlans } from '../data/recurringPlansRepository'
import {
  applyRetainerMonthPreview,
  buildRetainerPlanning,
  canConfirmRetainerPeriod,
  createRetainerPlanningRequestGuard,
  retainerPlanningContextKey,
  retainerPlanningLoadState,
  retainerPlanningReason,
} from '../data/retainerPlanning'

const currentMonth = () => new Date().toISOString().slice(0, 7)
const label = (value) => value ? value.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase()) : 'Unknown'
const date = (value) => value
  ? new Date(`${value.slice(0, 10)}T00:00:00Z`).toLocaleDateString(undefined, { timeZone: 'UTC' })
  : 'Open'

export default function RetainerPlanningPanel({ project, engagement, services }) {
  const { user } = useAuth()
  const [month, setMonth] = useState(currentMonth)
  const [snapshotEnvelope, setSnapshotEnvelope] = useState(null)
  const [previews, setPreviews] = useState({})
  const [pastReasons, setPastReasons] = useState({})
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(null)
  const [error, setError] = useState('')
  const requestGuard = useRef(createRetainerPlanningRequestGuard())
  const mounted = useRef(true)
  const contextKey = retainerPlanningContextKey({
    organizationId: project.organization_id,
    projectId: project.id,
    engagementId: engagement.id,
    actorId: user?.id,
    month,
  })
  const activeContext = useRef(contextKey)
  activeContext.current = contextKey

  const load = useCallback(async () => {
    const token = requestGuard.current.begin('load', contextKey)
    setLoading(true)
    setError('')
    try {
      const plans = await recurringPlans.list(engagement.id)
      const memberships = await recurringPlans.listTeamMemberships(project.organization_id)
      const details = await Promise.all(plans.map(async (plan) => {
        const [versions, approvals, occurrences, attempts, workItems] = await Promise.all([
          recurringPlans.listVersions(plan.id),
          recurringPlans.listApprovals(plan.id),
          recurringPlans.listOccurrences(plan.id),
          recurringPlans.listGenerationAttempts(plan.id),
          recurringPlans.listGeneratedWork(plan.id),
        ])
        const templateItems = (await Promise.all(
          versions.map((version) => recurringPlans.listTemplateItems(version.id)),
        )).flat()
        return { versions, approvals, occurrences, attempts, workItems, templateItems }
      }))
      if (!mounted.current || !requestGuard.current.isCurrent(token, activeContext.current)) return false
      setSnapshotEnvelope({ contextKey, value: {
        plans,
        memberships,
        services,
        versions: details.flatMap((item) => item.versions),
        approvals: details.flatMap((item) => item.approvals),
        occurrences: details.flatMap((item) => item.occurrences),
        attempts: details.flatMap((item) => item.attempts),
        workItems: details.flatMap((item) => item.workItems),
        templateItems: details.flatMap((item) => item.templateItems),
      } })
      return true
    } catch (cause) {
      if (mounted.current && requestGuard.current.isCurrent(token, activeContext.current)) {
        setError(cause.message || 'Unable to load retainer planning.')
      }
      return false
    } finally {
      if (mounted.current && requestGuard.current.isCurrent(token, activeContext.current)) setLoading(false)
    }
  }, [contextKey, engagement.id, project.organization_id, services])

  useEffect(() => { load() }, [load])
  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])
  useEffect(() => {
    setPreviews({})
    setPastReasons({})
    setBusy(null)
    setError('')
    requestGuard.current.invalidate('preview')
    requestGuard.current.invalidate('confirm')
  }, [contextKey])

  const snapshot = useMemo(() => snapshotEnvelope?.contextKey === contextKey
    ? { ...snapshotEnvelope.value, services }
    : null, [snapshotEnvelope, contextKey, services])
  const model = useMemo(() => snapshot ? buildRetainerPlanning(snapshot, {
    organizationId: project.organization_id,
    engagementId: engagement.id,
    month,
    actorId: user?.id,
  }) : null, [snapshot, project.organization_id, engagement.id, month, user?.id])
  const modelRef = useRef(model)
  modelRef.current = model
  const panelState = retainerPlanningLoadState({
    loading,
    hasCurrentSnapshot: Boolean(snapshot),
    hasPriorSnapshot: Boolean(snapshotEnvelope),
    hasModel: Boolean(model),
    error,
  })

  async function previewMonth(plan) {
    const token = requestGuard.current.begin('preview', contextKey)
    setBusy({ contextKey, key: `preview-${plan.id}` })
    setError('')
    try {
      const preview = await recurringPlans.previewMonth(
        plan.id, `${month}-01`, pastReasons[plan.id] || '',
      )
      const currentPlan = modelRef.current?.plans.find((item) => item.id === plan.id)
      if (mounted.current && requestGuard.current.isCurrent(token, activeContext.current)
          && currentPlan?.canManagePeriods) {
        setPreviews((current) => ({
          ...current,
          [plan.id]: { contextKey, value: preview },
        }))
      }
    } catch (cause) {
      if (mounted.current && requestGuard.current.isCurrent(token, activeContext.current)) {
        setError(cause.message || 'Unable to preview this plan month.')
      }
    } finally {
      if (mounted.current && requestGuard.current.isCurrent(token, activeContext.current)) setBusy(null)
    }
  }

  async function confirmPeriod(plan, period) {
    const visiblePreview = previews[plan.id]
    const currentPlan = modelRef.current?.plans.find((item) => item.id === plan.id)
    if (!canConfirmRetainerPeriod(currentPlan, visiblePreview, contextKey, month, period.period_start)) {
      setError('This preview is no longer current. Preview the displayed month again.')
      return
    }
    if (!window.confirm(`Generate only the period beginning ${period.period_start}?`)) return
    const token = requestGuard.current.begin('confirm', contextKey)
    const ownerStillCurrent = modelRef.current?.plans.find((item) => item.id === plan.id)?.canManagePeriods
    if (!ownerStillCurrent || !requestGuard.current.isCurrent(token, activeContext.current)) return
    setBusy({ contextKey, key: `confirm-${plan.id}-${period.period_start}` })
    setError('')
    try {
      await recurringPlans.confirmPeriod(
        plan.id,
        period.period_start,
        crypto.randomUUID(),
        pastReasons[plan.id] || '',
      )
      if (!mounted.current || !requestGuard.current.isCurrent(token, activeContext.current)) return
      const loaded = await load()
      if (!loaded || !requestGuard.current.isCurrent(token, activeContext.current)) return
      const previewToken = requestGuard.current.begin('preview', contextKey)
      const preview = await recurringPlans.previewMonth(
        plan.id, `${month}-01`, pastReasons[plan.id] || '',
      )
      if (mounted.current && requestGuard.current.isCurrent(previewToken, activeContext.current)
          && requestGuard.current.isCurrent(token, activeContext.current)) {
        setPreviews((current) => ({
          ...current,
          [plan.id]: { contextKey, value: preview },
        }))
      }
    } catch (cause) {
      if (mounted.current && requestGuard.current.isCurrent(token, activeContext.current)) {
        setError(cause.message || 'Unable to confirm this one period.')
      }
    } finally {
      if (mounted.current && requestGuard.current.isCurrent(token, activeContext.current)) setBusy(null)
    }
  }

  if (panelState.status === 'loading') return <State>Loading retainer planning…</State>
  if (panelState.status !== 'ready') {
    return <State error={error} action={load}>Retainer planning is unavailable.</State>
  }

  return (
    <section aria-label="Retainer planning" className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-4 rounded-2xl border border-white/[0.07] bg-white/[0.025] p-5">
        <div>
          <h2 className="font-semibold">Monthly retainer planning</h2>
          <p className="mt-1 text-xs leading-5 text-slate-500">Periods belong to this plan-local month when their period start falls inside it. Each plan keeps its approved IANA timezone.</p>
        </div>
        <label className="text-xs text-slate-400">Planning month
          <input type="month" value={month} onChange={(event) => {
            if (event.target.value) setMonth(event.target.value)
          }}
            className="mt-1 block rounded-xl border border-white/10 bg-slate-950 px-3 py-2 text-sm text-white" />
        </label>
      </div>

      {error && <div role="alert" className="rounded-xl border border-rose-500/25 bg-rose-500/10 p-4 text-sm text-rose-200">{error}</div>}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <Metric title="Plans" value={model.summary.plans} />
        <Metric title="Active" value={model.summary.activePlans} />
        <Metric title="Generated periods" value={model.summary.generatedPeriods} />
        <Metric title="Applicable template items" value={model.summary.applicableTemplateItems} />
        <Metric title="Unassigned" value={model.summary.unassignedItems} attention={model.summary.unassignedItems > 0} />
      </div>

      {!model.plans.length && <State>No recurring plans are recorded for this retainer engagement.</State>}
      {model.plans.map((basePlan) => {
        const previewEnvelope = previews[basePlan.id]
        const plan = previewEnvelope?.contextKey === contextKey && basePlan.canManagePeriods
          ? applyRetainerMonthPreview(basePlan, previewEnvelope.value, { planId: basePlan.id, month })
          : basePlan
        return <PlanCard key={plan.id} plan={plan} month={month}
          reason={pastReasons[plan.id] || ''}
          setReason={(value) => setPastReasons((current) => ({ ...current, [plan.id]: value }))}
          preview={() => previewMonth(plan)}
          confirm={(period) => confirmPeriod(plan, period)}
          busy={busy?.contextKey === contextKey ? busy.key : ''} />
      })}
    </section>
  )
}

function PlanCard({ plan, month, reason, setReason, preview, confirm, busy }) {
  const versions = plan.monthVersions
  const exceptions = [...new Set([...(plan.exceptions || []), ...(plan.previewExceptions || [])])]
  return (
    <article className="rounded-2xl border border-white/[0.07] bg-white/[0.025] p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap gap-2 text-[11px]"><Pill>{label(plan.status)}</Pill>{versions.map((version) => <Pill key={version.id}>v{version.version_number} · {label(version.frequency)} · {version.timezone}</Pill>)}</div>
          <h3 className="mt-3 text-lg font-semibold">{versions.length === 1 ? versions[0].title : 'Recurring plan'}</h3>
          <p className="mt-1 text-sm text-slate-400">{versions.length ? `${versions.length} approved version${versions.length === 1 ? '' : 's'} applies to ${month}.` : `No approved version applies to ${month}.`}</p>
        </div>
        <button type="button" onClick={preview} disabled={!plan.canManagePeriods || busy}
          className="rounded-xl border border-violet-500/25 bg-violet-500/10 px-4 py-2 text-sm font-medium text-violet-200 disabled:cursor-not-allowed disabled:opacity-40">
          {busy === `preview-${plan.id}` ? 'Previewing…' : `Preview ${month}`}
        </button>
      </div>

      <div className="mt-5 grid gap-4 xl:grid-cols-3">
        <Block title="Coverage">
          <div className="grid grid-cols-3 gap-2"><Mini label="Assigned" value={plan.coverage.assigned} /><Mini label="Unassigned" value={plan.coverage.unassigned} /><Mini label="Inactive" value={plan.coverage.inactiveAssigned} /></div>
          <p className="mt-3 text-xs text-slate-500">Counts describe applicable template definitions, not multiplied monthly workload. {plan.coverage.generated} generated canonical item{plan.coverage.generated === 1 ? '' : 's'} in this month.</p>
        </Block>
        <Block title="Review facts">
          <p className="text-sm text-slate-300">{plan.approvals.length ? `${plan.approvals.length} immutable approval record${plan.approvals.length === 1 ? '' : 's'}` : 'No approved version.'}</p>
          {plan.approvals[0] && <p className="mt-2 text-xs text-slate-500">Latest {new Date(plan.approvals[0].approved_at).toLocaleString()}{plan.approvals[0].approval_note ? ` · ${plan.approvals[0].approval_note}` : ''}</p>}
          {plan.hasUnapprovedNewerVersion && <p className="mt-2 text-xs text-amber-300">A newer unapproved version exists.</p>}
        </Block>
        <Block title="Computed exceptions">
          {!exceptions.length && <p className="text-sm text-slate-500">No current warning.</p>}
          <ul className="space-y-2 text-xs text-amber-200">{exceptions.map((code) => <li key={code}>• {retainerPlanningReason(code)}</li>)}</ul>
        </Block>
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-2">
        <Block title="Applicable approved templates">
          {!plan.templateGroups.length && <p className="text-sm text-slate-500">No approved template applies to this month.</p>}
          <div className="space-y-4">{plan.templateGroups.map(({ version, templates }) => <div key={version.id}>
            <p className="text-xs font-medium text-violet-200">v{version.version_number} · {date(version.effective_start)} to {date(version.effective_end)} · {version.timezone}</p>
            <p className="mt-1 text-xs text-slate-500">{version.title}{version.scope ? ` · ${version.scope}` : ''}</p>
            <div className="mt-2 space-y-2">{templates.map((item) => <div key={item.id} className="flex flex-wrap justify-between gap-2 text-xs"><span className="text-slate-300">{item.title}</span><span className="text-slate-500">{item.default_assignee_id ? 'Assigned' : 'Unassigned'} · day +{item.start_offset_days} to +{item.due_offset_days}</span></div>)}</div>
          </div>)}</div>
        </Block>
        <Block title="Generated activity">
          {!plan.occurrences.length && <p className="text-sm text-slate-500">No generated periods in this month.</p>}
          <div className="space-y-2">{plan.occurrences.map((occurrence) => {
            const work = plan.generatedWork.filter((item) => item.recurring_occurrence_id === occurrence.id)
            return <div key={occurrence.id} className="rounded-lg bg-white/[0.03] p-3 text-xs"><p className="text-slate-300">{date(occurrence.period_start)} → {date(occurrence.period_end)}</p><p className="mt-1 text-slate-500">{work.length} canonical item{work.length === 1 ? '' : 's'} · {work.filter((item) => item.assignee_id).length} assigned</p></div>
          })}</div>
        </Block>
      </div>

      {!plan.canManagePeriods && <p className="mt-4 rounded-xl border border-white/[0.07] bg-black/10 p-3 text-xs text-slate-500">Planning facts are readable. Only the current Service Owner can preview or confirm periods.</p>}
      {plan.canManagePeriods && <label className="mt-4 block text-xs text-slate-400">Past-period reason, when required
        <textarea value={reason} onChange={(event) => setReason(event.target.value)} maxLength={2000} rows={2}
          className="mt-1 w-full rounded-xl border border-white/10 bg-slate-950 px-3 py-2 text-sm text-white" />
      </label>}

      {plan.periods && <div className="mt-5 space-y-3">
        {!plan.periods.length && <p className="text-sm text-slate-500">No canonical period starts in this month.</p>}
        {plan.periods.map((period) => <div key={period.period_start} className="rounded-xl border border-white/[0.07] bg-black/10 p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div><p className="font-medium">{date(period.period_start)} → {date(period.period_end)}</p><p className="mt-1 text-xs text-slate-500">Half-open window · {period.timezone} · v{period.version_number}</p></div>
            <button type="button" onClick={() => confirm(period)} disabled={!plan.canManagePeriods || !period.eligible || busy}
              className="rounded-lg border border-emerald-500/25 bg-emerald-500/10 px-3 py-2 text-xs font-medium text-emerald-200 disabled:cursor-not-allowed disabled:opacity-40">
              {busy === `confirm-${plan.id}-${period.period_start}` ? 'Confirming…' : 'Confirm one period'}
            </button>
          </div>
          <div className="mt-3 space-y-2">{(period.template_items || []).map((item) => <div key={item.template_key} className="flex flex-wrap justify-between gap-2 text-xs"><span className="text-slate-300">{item.title}</span><span className="text-slate-500">{date(item.start_date)}–{date(item.due_date)} · {item.assignee_id ? 'Assigned' : 'Unassigned'}</span></div>)}</div>
        </div>)}
      </div>}
    </article>
  )
}

function Block({ title, children }) {
  return <div className="rounded-xl border border-white/[0.07] bg-black/10 p-4"><h4 className="text-sm font-medium">{title}</h4><div className="mt-3">{children}</div></div>
}

function Metric({ title, value, attention = false }) {
  return <div className={`rounded-2xl border p-4 ${attention ? 'border-amber-500/20 bg-amber-500/[0.05]' : 'border-white/[0.07] bg-white/[0.025]'}`}><p className="text-xs text-slate-500">{title}</p><p className="mt-2 text-xl font-semibold">{value}</p></div>
}

function Mini({ label: title, value }) {
  return <div className="rounded-lg bg-white/[0.03] p-2 text-center"><p className="text-lg font-semibold">{value}</p><p className="text-[10px] text-slate-500">{title}</p></div>
}

function Pill({ children }) {
  return <span className="rounded-full border border-violet-500/20 bg-violet-500/10 px-2 py-1 text-violet-200">{children}</span>
}

function State({ children, error = '', action = null }) {
  return <div className={`rounded-2xl border border-dashed p-8 text-center text-sm ${error ? 'border-rose-500/20 text-rose-300' : 'border-white/10 text-slate-500'}`}>
    <p>{error || children}</p>
    {action && <button type="button" onClick={action}
      className="mt-4 rounded-xl border border-white/10 bg-white/[0.04] px-4 py-2 text-xs font-medium text-white">
      Retry
    </button>}
  </div>
}
