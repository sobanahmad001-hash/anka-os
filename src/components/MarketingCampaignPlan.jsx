import { useEffect, useMemo, useRef, useState } from 'react'
import {
  acceptCampaignPlanSave, campaignPlanContextKey, campaignPlanDraft,
  campaignPlanSourceOptions, latestCampaignPlanVersion, validateCampaignPlanDraft,
} from '../data/marketingCampaignPlan.js'

const INPUT = 'mt-2 w-full rounded-xl border border-slate-700 bg-slate-950 px-3.5 py-2.5 text-sm text-white outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 disabled:cursor-not-allowed disabled:opacity-60'
const BUTTON = 'rounded-xl border border-slate-700 px-4 py-2 text-sm font-semibold text-slate-200 transition hover:border-emerald-500 hover:text-white disabled:cursor-not-allowed disabled:opacity-50'
const PRIMARY = 'rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50'
const EMPTY_SNAPSHOT = Object.freeze({ versions: [], requirements: [], artifacts: [], sourceVersions: [], approvals: [] })
const emptyDraft = () => ({ title: '', objective: '', channels: [], starts_on: '', ends_on: '', audience: '', landing_page_url: '', approved_message_version_id: '', measurement_plan_version_id: '', creative_requirements: [], change_summary: '' })
const lines = value => String(value || '').split('\n').map(item => item.trim()).filter(Boolean)
const Label = ({ children, title }) => <label className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-400">{title}{children}</label>
const ignoreAccessError = () => {}

export default function MarketingCampaignPlan({ organizationId, engagement, campaign, repository, canEdit = false, onAccessError = ignoreAccessError }) {
  const [snapshot, setSnapshot] = useState(EMPTY_SNAPSHOT)
  const [draft, setDraft] = useState(emptyDraft)
  const [viewingId, setViewingId] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const contextKey = campaignPlanContextKey(organizationId, engagement?.id, campaign?.id)
  const activeKey = useRef(contextKey)
  activeKey.current = contextKey
  const latest = latestCampaignPlanVersion(snapshot.versions, campaign?.id)
  const viewing = snapshot.versions.find(item => item.id === viewingId) || latest
  const requirements = snapshot.requirements.filter(item => item.plan_version_id === viewing?.id)
  const sources = useMemo(() => campaignPlanSourceOptions({ artifacts: snapshot.artifacts, versions: snapshot.sourceVersions, approvals: snapshot.approvals }), [snapshot])
  const staleMessage = Boolean(draft.approved_message_version_id) && !sources.approvedMessages.some(item => item.id === draft.approved_message_version_id)
  const staleMeasurement = Boolean(draft.measurement_plan_version_id) && !sources.measurementPlans.some(item => item.id === draft.measurement_plan_version_id)
  const staleCreativeMessage = draft.creative_requirements.some(requirement =>
    Boolean(requirement.message_version_id) && !sources.approvedMessages.some(item => item.id === requirement.message_version_id))
  const sourceStale = staleMessage || staleMeasurement || staleCreativeMessage

  useEffect(() => {
    let live = true
    setLoading(true); setBusy(false); setError(''); setMessage('')
    setSnapshot(EMPTY_SNAPSHOT); setViewingId(''); setDraft(emptyDraft())
    if (!organizationId || !engagement?.id || !campaign?.id || !repository) {
      setLoading(false)
      return () => { live = false }
    }
    repository.load(engagement.id, campaign.id).then(next => {
      if (!live || activeKey.current !== contextKey) return
      setSnapshot(next)
      const current = latestCampaignPlanVersion(next.versions, campaign.id)
      setViewingId(current?.id || '')
      setDraft(current ? campaignPlanDraft(current, next.requirements) : {
        ...emptyDraft(), title: campaign.name || '', objective: campaign.objective || '',
        channels: campaign.planned_channels || [], starts_on: campaign.starts_on || '', ends_on: campaign.ends_on || '',
      })
    }).catch(loadError => {
      if (!live || activeKey.current !== contextKey || loadError?.name === 'AbortError') return
      onAccessError(loadError, { membershipMismatch: loadError?.membershipMismatch === true })
      setError(loadError.message)
    }).finally(() => {
      if (live && activeKey.current === contextKey) setLoading(false)
    })
    return () => { live = false }
  }, [
    organizationId, engagement?.id, campaign?.id, campaign?.name, campaign?.objective,
    campaign?.planned_channels, campaign?.starts_on, campaign?.ends_on,
    repository, contextKey, onAccessError,
  ])

  const update = (field, value) => setDraft(current => ({ ...current, [field]: value }))
  const addRequirement = () => update('creative_requirements', [...draft.creative_requirements, { format: '', intended_placement: '', message_version_id: '', due_date: '' }])
  const updateRequirement = (index, field, value) => update('creative_requirements', draft.creative_requirements.map((item, position) => position === index ? { ...item, [field]: value } : item))
  const removeRequirement = index => update('creative_requirements', draft.creative_requirements.filter((_, position) => position !== index))

  async function save(event) {
    event.preventDefault()
    if (!canEdit || sourceStale) return
    const requestedKey = contextKey
    setBusy(true); setError(''); setMessage('')
    try {
      const plan = validateCampaignPlanDraft(draft)
      const saved = await repository.saveDraft({
        engagement_id: engagement.id, campaign_id: campaign.id,
        expected_latest_version_id: latest?.id || null, source_plan_version_id: null, plan,
      })
      if (!acceptCampaignPlanSave(saved, requestedKey, activeKey.current)) return
      const next = await repository.load(engagement.id, campaign.id)
      if (activeKey.current !== requestedKey) return
      setSnapshot(next); setViewingId(saved.id); setDraft(campaignPlanDraft(saved, next.requirements))
      setMessage(`Saved unapproved plan version ${saved.version_number}.`)
    } catch (saveError) {
      if (activeKey.current !== requestedKey || saveError?.name === 'AbortError') return
      onAccessError(saveError, { membershipMismatch: saveError?.membershipMismatch === true })
      setError(saveError.message)
    } finally {
      if (activeKey.current === requestedKey) setBusy(false)
    }
  }

  if (!campaign || !engagement) return <section className="rounded-2xl border border-dashed border-slate-700 p-8 text-center text-sm text-slate-500">Select an official campaign context to edit a plan.</section>
  return <section className="marketing-campaign-plan rounded-2xl border border-slate-800 bg-slate-900/70 p-6" aria-labelledby="campaign-plan-title">
    <header className="flex flex-wrap items-start justify-between gap-4">
      <div><p className="text-xs font-semibold uppercase tracking-[0.14em] text-emerald-400">Campaign plan · manual draft</p>
        <h2 id="campaign-plan-title" className="mt-1 text-xl font-semibold">{campaign.name}</h2>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-400">{engagement.name} · Saves are unapproved immutable planning versions only.</p></div>
      <span className="rounded-full bg-slate-950 px-3 py-1.5 text-xs text-slate-400">{canEdit ? 'Draft authoring available' : 'Read only'}</span>
    </header>
    <p className="mt-4 rounded-xl border border-amber-800/60 bg-amber-950/25 px-4 py-3 text-xs leading-5 text-amber-200">No action here can publish, spend, activate a provider, approve a version, or create downstream work.</p>

    {loading ? <p className="py-12 text-center text-sm text-slate-500">Loading campaign plan…</p> : <>
      {error && <div role="alert" className="mt-5 rounded-xl border border-red-900/60 bg-red-950/50 px-4 py-3 text-sm text-red-300">{error}</div>}
      <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
      <form onSubmit={save} className="grid gap-4 md:grid-cols-2">
        <Label title="Title"><input aria-label="Plan title" className={INPUT} value={draft.title} maxLength="180" required disabled={!canEdit || busy} onInput={event => update('title', event.target.value)} /></Label>
        <Label title="Channels"><textarea aria-label="Plan channels" className={INPUT} value={draft.channels.join('\n')} required disabled={!canEdit || busy} placeholder="One channel per line" onInput={event => update('channels', lines(event.target.value))} /></Label>
        <div className="md:col-span-2"><Label title="Objective"><textarea aria-label="Plan objective" className={INPUT} value={draft.objective} maxLength="4000" required disabled={!canEdit || busy} onInput={event => update('objective', event.target.value)} /></Label></div>
        <Label title="Starts on"><input aria-label="Plan starts on" className={INPUT} type="date" value={draft.starts_on} disabled={!canEdit || busy} onInput={event => update('starts_on', event.target.value)} /></Label>
        <Label title="Ends on"><input aria-label="Plan ends on" className={INPUT} type="date" value={draft.ends_on} disabled={!canEdit || busy} onInput={event => update('ends_on', event.target.value)} /></Label>
        <div className="md:col-span-2"><Label title="Audience"><textarea aria-label="Plan audience" className={INPUT} value={draft.audience} maxLength="4000" disabled={!canEdit || busy} onInput={event => update('audience', event.target.value)} /></Label></div>
        <div className="md:col-span-2"><Label title="Landing page link"><input aria-label="Plan landing page" className={INPUT} type="url" value={draft.landing_page_url} maxLength="2000" disabled={!canEdit || busy} onInput={event => update('landing_page_url', event.target.value)} /></Label></div>
        <Label title="Approved message version"><select aria-label="Approved message version" className={INPUT} value={draft.approved_message_version_id} disabled={!canEdit || busy} onChange={event => update('approved_message_version_id', event.target.value)}>
          <option value="">No approved message pinned</option>{sources.approvedMessages.map(item => <option key={item.id} value={item.id}>{item.title} · v{item.versionNumber}</option>)}
        </select></Label>
        <Label title="Measurement source version"><select aria-label="Measurement source version" className={INPUT} value={draft.measurement_plan_version_id} disabled={!canEdit || busy} onChange={event => update('measurement_plan_version_id', event.target.value)}>
          <option value="">No measurement source pinned</option>{sources.measurementPlans.map(item => <option key={item.id} value={item.id}>{item.title} · v{item.versionNumber}</option>)}
        </select></Label>
        {sourceStale && <div role="alert" className="md:col-span-2 rounded-xl border border-amber-800/60 bg-amber-950/25 px-4 py-3 text-sm text-amber-200">A previously selected source is no longer readable or eligible. Reload or clear the source before saving.</div>}

        <fieldset className="md:col-span-2 rounded-xl border border-slate-800 p-4"><legend className="px-2 text-xs font-semibold uppercase tracking-[0.12em] text-slate-400">Creative requirements</legend>
          <div className="space-y-4">{draft.creative_requirements.map((item, index) => <div className="grid gap-3 rounded-xl bg-slate-950/70 p-4 md:grid-cols-2" key={index}>
            <Label title="Format"><input aria-label={`Creative format ${index + 1}`} className={INPUT} required value={item.format} disabled={!canEdit || busy} onInput={event => updateRequirement(index, 'format', event.target.value)} /></Label>
            <Label title="Intended placement"><input aria-label={`Creative placement ${index + 1}`} className={INPUT} required value={item.intended_placement} disabled={!canEdit || busy} onInput={event => updateRequirement(index, 'intended_placement', event.target.value)} /></Label>
            <Label title="Approved message version"><select aria-label={`Creative message version ${index + 1}`} className={INPUT} value={item.message_version_id} disabled={!canEdit || busy} onChange={event => updateRequirement(index, 'message_version_id', event.target.value)}>
              <option value="">Use no pinned message</option>{sources.approvedMessages.map(source => <option key={source.id} value={source.id}>{source.title} · v{source.versionNumber}</option>)}
            </select></Label>
            <Label title="Due date"><input aria-label={`Creative due date ${index + 1}`} className={INPUT} type="date" value={item.due_date} disabled={!canEdit || busy} onInput={event => updateRequirement(index, 'due_date', event.target.value)} /></Label>
            <button type="button" className={BUTTON} disabled={!canEdit || busy} onClick={() => removeRequirement(index)}>Remove requirement</button>
          </div>)}</div>
          <button type="button" className={BUTTON + ' mt-4'} disabled={!canEdit || busy} onClick={addRequirement}>Add creative requirement</button>
        </fieldset>
        <div className="md:col-span-2"><Label title="Version note"><input aria-label="Plan version note" className={INPUT} value={draft.change_summary} maxLength="1000" disabled={!canEdit || busy} onInput={event => update('change_summary', event.target.value)} /></Label></div>
        <div className="md:col-span-2 flex flex-wrap items-center justify-between gap-4 border-t border-slate-800 pt-5">
          <p className="text-xs text-slate-500">{latest ? `Editing from latest saved version ${latest.version_number}.` : 'No plan version has been saved yet.'}</p>
          <button type="submit" className={PRIMARY} disabled={!canEdit || busy || sourceStale}>{busy ? 'Saving…' : 'Save unapproved version'}</button>
        </div>
        {message && <p role="status" className="md:col-span-2 rounded-xl border border-emerald-900/60 bg-emerald-950/40 px-4 py-3 text-sm text-emerald-300">{message}</p>}
      </form>

      <aside aria-label="Exact saved source and version history" className="rounded-xl border border-slate-800 bg-slate-950/60 p-5">
        <h3 className="font-semibold">Saved source preview</h3>
        {viewing ? <div className="mt-3 space-y-3 text-xs leading-5 text-slate-400"><p><strong className="text-white">Version {viewing.version_number}</strong> · {viewing.lifecycle_status} · {viewing.created_at}</p>
          <p><strong className="text-white">{viewing.title}</strong><br />{viewing.objective}</p>
          <p>Channels: {viewing.channels.join(', ')}<br />Dates: {viewing.starts_on || 'Not set'} — {viewing.ends_on || 'Not set'}<br />Audience: {viewing.audience || 'Not set'}</p>
          <p>Landing page: {viewing.landing_page_url || 'None pinned'}</p>
          <p>Message source: {viewing.approved_message_version_id || 'None pinned'}<br />Measurement source: {viewing.measurement_plan_version_id || 'None pinned'}</p>
          <p>Creative requirements: {requirements.length}</p>
          <ol className="list-decimal space-y-1 pl-4">{requirements.map(item => <li key={item.id}>{item.format} · {item.intended_placement} · message {item.message_version_id || 'not pinned'} · due {item.due_date || 'not set'}</li>)}</ol>
        </div> : <p className="mt-3 text-xs text-slate-500">No saved plan version yet.</p>}
        <h3 className="mt-6 font-semibold">History</h3>
        <ol className="mt-3 space-y-2">{snapshot.versions.map(version => <li key={version.id}><button type="button" className="text-left text-xs text-emerald-300 hover:text-emerald-200" onClick={() => setViewingId(version.id)}>Version {version.version_number} · {version.lifecycle_status}</button></li>)}</ol>
      </aside>
      </div>
    </>}
  </section>
}
