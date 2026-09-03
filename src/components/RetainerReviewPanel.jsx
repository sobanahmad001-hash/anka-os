import { useEffect, useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useOrganization } from '../context/OrganizationContext'
import { supabase } from '../lib/supabase'
import { createRetainerReviewRepository } from '../data/retainerReviewRepository'
import { buildRetainerReview, createReviewLoader, reviewContextKey } from '../data/retainerReview'

const repository = createRetainerReviewRepository(supabase)
const label = value => value?.replaceAll('_', ' ') || 'Not set'
const recordId = id => `ret5-record-${id}`
const box = 'rounded-xl border border-white/10 bg-white/[0.025] p-4'

export default function RetainerReviewPanel({ project, engagement }) {
  const { user } = useAuth()
  const organization = useOrganization()
  const { projectId } = useParams()
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7))
  const [attempt, setAttempt] = useState(0)
  const [state, setState] = useState(null)
  const loader = useMemo(() => createReviewLoader(scope => repository.get(scope), setState), [])
  const allowed = Boolean(user?.id && !organization.loading && organization.activeMembership
    && organization.activeOrganizationId === project.organization_id && projectId === project.id
    && engagement.project_id === project.id && engagement.organization_id === project.organization_id)
  const scope = useMemo(() => ({ organizationId: organization.activeOrganizationId, projectId: project.id,
    engagementId: engagement.id, actorId: user?.id, revision: organization.scopeRevision, month,
  }), [organization.activeOrganizationId, organization.scopeRevision, project.id, engagement.id, user?.id, month])
  const key = reviewContextKey(scope)
  useEffect(() => {
    if (!allowed) { loader.cancel(); return undefined }
    const controller = new AbortController()
    loader.load({ ...scope, signal: controller.signal })
    return () => { controller.abort(); loader.cancel() }
  }, [loader, allowed, scope, attempt])
  const current = allowed && state?.key === key ? state : null
  useEffect(() => {
    if (current?.status === 'error') organization.handleOrganizationAccessError(current.error)
  }, [current, organization.handleOrganizationAccessError])
  const result = useMemo(() => {
    if (current?.status !== 'ready') return {}
    try { return { model: buildRetainerReview(current.snapshot, scope, new Date(current.fetchedAt)) } }
    catch (error) { return { error } }
  }, [current, scope])
  const error = current?.error || result.error
  const model = result.model
  return <section aria-label="Retainer review" className="space-y-4">
    <div className={box}>
      <h2 className="font-semibold">Retainer review</h2>
      <p className="mt-2 text-sm text-slate-400">Current work status for periods starting in the selected plan-local month. This is not a historical month-end snapshot.</p>
      <div className="mt-3 flex flex-wrap items-end gap-3">
        <label className="text-sm">Reporting month<input className="ml-2 rounded bg-slate-900 p-2" type="month" value={month} onChange={event => { if (event.target.value) setMonth(event.target.value) }} /></label>
        <button type="button" onClick={() => setAttempt(value => value + 1)} disabled={!allowed || current?.status === 'loading'} className="rounded border border-white/20 px-3 py-2 text-sm disabled:opacity-40">Refresh</button>
      </div>
    </div>
    {!allowed ? <p role="status">Select the organization containing this retainer. Review is unavailable for the current workspace context.</p>
      : error ? <div role="alert" className={box}><p>{error.message || 'Unable to load review.'}</p><button type="button" className="mt-3 underline" onClick={() => setAttempt(value => value + 1)}>Retry</button></div>
        : !model ? <p role="status">Loading retainer review…</p> : <>
          <p className="text-xs text-slate-400">Refreshed {new Date(model.asOf).toLocaleString()}. Changes made afterward appear on refresh. Counts use current visible records and may change while work is updated.</p>
          <div className="grid gap-3 sm:grid-cols-4">{[['Currently completed', model.summary.completed], ['Earlier-period work still open now', model.summary.carryover], ['Work with blockers', model.summary.blockers], ['Upcoming period starts', model.summary.upcoming]].map(([title, value]) => <div key={title} className={box}><p className="text-sm text-slate-400">{title}</p><p className="mt-2 text-xl">{value}</p></div>)}</div>
          {!model.cards.length && <p>No recurring plans recorded for this retainer.</p>}
          {model.cards.map(card => <article key={card.id} className={`${box} space-y-4`}>
            <h3 className="font-semibold">{card.relevantVersions[0]?.title || 'Recurring plan'} · {label(card.status)}</h3>
            <p className="text-xs text-slate-400">{card.relevantVersions.length ? card.relevantVersions.map(version => `v${version.version_number} · ${version.timezone} · ${version.effective_start} to ${version.effective_end || 'open'}`).join(' / ') : 'No approved version applies to this month.'}</p>
            <RecordList title="Currently completed" note="Work from this month’s periods that is done now—not work completed during that month." rows={card.completed} />
            <RecordList title="Earlier-period work still open now" note="Carryover is derived from current status. Original period and dates remain unchanged." rows={card.carryover} />
            <div><h4 className="font-medium">Upcoming commitments</h4><p className="text-xs text-slate-400">Canonical starts from today through month-end, using each applicable version’s timezone. This review does not establish permission or eligibility to generate work.</p>
              {!card.upcoming.length && <p className="mt-2 text-sm text-slate-500">No remaining canonical starts in this month.</p>}
              <ul className="mt-2 space-y-2">{card.upcoming.map(period => <li key={period.period_start} className="rounded bg-white/[0.03] p-3 text-sm">
                <p>{period.period_start} · v{period.version.version_number} · {period.version.timezone}</p>
                <p>{period.occurrence ? `Generated · recorded version ${period.recordedVersion?.version_number || 'unavailable'}` : 'Ungenerated commitment'} · {period.active ? 'Active plan context' : 'Inactive / not executable'}</p>
                <ul className="ml-4 mt-1 list-disc text-slate-400">{period.templates.map(item => <li key={item.id}>{item.title}</li>)}</ul>
                {period.occurrence && <div className="mt-2">{card.selectedWork.filter(item => item.recurring_occurrence_id === period.occurrence.id).map(item => <p key={item.id}><RecordLink item={item} /></p>)}</div>}
              </li>)}</ul>
            </div>
            <div><h4 className="font-medium">Blockers</h4><p className="text-xs text-slate-400">Selected-month open work and carryover with blocked status or visible unfinished prerequisites.</p>
              {!card.blockers.length && <p className="mt-2 text-sm text-slate-500">No visible current blockers.</p>}
              {card.blockers.map(row => <div key={row.work.id} className="mt-2 text-sm"><RecordLink item={row.work} />{row.work.status === 'blocked' && <span> · marked blocked</span>}{row.dependencies.map(item => <p key={item.id} className="ml-3">Waiting on <RecordLink item={item} /></p>)}</div>)}
            </div>
          </article>)}
          <div className={box}><h3 className="font-semibold">Canonical work records</h3><p className="text-xs text-slate-400">Read-only records linked from this review.</p>
            {model.records.map(item => <article tabIndex={-1} id={recordId(item.id)} key={item.id} className="mt-4 scroll-mt-4 rounded border border-white/10 p-3 text-sm">
              <h4>{item.title}</h4><p>Status: {label(item.status)} · Period start: {item.period_start || 'Dependency outside recurring periods'}</p>
              <p>Start: {item.start_date || 'Not set'} · Due: {item.due_date || 'Not set'} · {item.assignee_id ? 'Assigned' : 'Unassigned'}</p>
              {item.description && <p className="mt-2 whitespace-pre-wrap text-slate-400">{item.description}</p>}
            </article>)}
          </div>
        </>}
  </section>
}
function RecordLink({ item }) { return <a href={`#${recordId(item.id)}`} className="text-violet-300 underline">{item.title}</a> }
function RecordList({ title, note, rows }) {
  return <div><h4 className="font-medium">{title}</h4><p className="text-xs text-slate-400">{note}</p><ul className="mt-2 space-y-1 text-sm">{rows.map(item => <li key={item.id}><RecordLink item={item} /> · {item.period_start}</li>)}</ul>{!rows.length && <p className="mt-2 text-sm text-slate-500">None.</p>}</div>
}
