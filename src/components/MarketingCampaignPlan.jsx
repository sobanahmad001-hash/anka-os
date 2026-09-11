import { useEffect, useMemo, useRef, useState } from 'react'
import {
  acceptCampaignPlanSave, campaignPlanContextKey, campaignPlanDraft,
  campaignPlanSourceOptions, latestCampaignPlanVersion, validateCampaignPlanDraft,
} from '../data/marketingCampaignPlan.js'

const emptyDraft = { title: '', objective: '', channels: [], starts_on: '', ends_on: '', audience: '', landing_page_url: '', approved_message_version_id: '', measurement_plan_version_id: '', creative_requirements: [], change_summary: '' }
const lines = value => String(value || '').split('\n').map(item => item.trim()).filter(Boolean)

export default function MarketingCampaignPlan({ organizationId, engagement, campaign, repository }) {
  const [snapshot, setSnapshot] = useState({ versions: [], requirements: [], artifacts: [], sourceVersions: [], approvals: [] })
  const [draft, setDraft] = useState(emptyDraft)
  const [viewingId, setViewingId] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const contextKey = campaignPlanContextKey(organizationId, engagement?.id, campaign?.id)
  const activeKey = useRef(contextKey)
  activeKey.current = contextKey
  const latest = latestCampaignPlanVersion(snapshot.versions, campaign?.id)
  const viewing = snapshot.versions.find(item => item.id === viewingId) || latest
  const requirements = snapshot.requirements.filter(item => item.plan_version_id === viewing?.id)
  const sources = useMemo(() => campaignPlanSourceOptions({ artifacts: snapshot.artifacts, versions: snapshot.sourceVersions, approvals: snapshot.approvals }), [snapshot])

  useEffect(() => {
    let live = true
    setNotice('')
    setSnapshot({ versions: [], requirements: [], artifacts: [], sourceVersions: [], approvals: [] })
    if (!organizationId || !engagement?.id || !campaign?.id || !repository) return () => { live = false }
    repository.load(engagement.id, campaign.id).then(next => {
      if (!live || activeKey.current !== contextKey) return
      setSnapshot(next)
      const current = latestCampaignPlanVersion(next.versions, campaign.id)
      setViewingId(current?.id || '')
      setDraft(current ? campaignPlanDraft(current, next.requirements) : { ...emptyDraft, title: campaign.name || '', objective: campaign.objective || '', channels: campaign.planned_channels || [], starts_on: campaign.starts_on || '', ends_on: campaign.ends_on || '' })
    }).catch(error => live && setNotice(error.message))
    return () => { live = false }
  }, [organizationId, engagement?.id, campaign?.id, repository, contextKey])

  const update = (field, value) => setDraft(current => ({ ...current, [field]: value }))
  const addRequirement = () => update('creative_requirements', [...draft.creative_requirements, { format: '', intended_placement: '', message_version_id: '', due_date: '' }])
  const updateRequirement = (index, field, value) => update('creative_requirements', draft.creative_requirements.map((item, position) => position === index ? { ...item, [field]: value } : item))
  const removeRequirement = index => update('creative_requirements', draft.creative_requirements.filter((_, position) => position !== index))

  async function save(event) {
    event.preventDefault()
    const requestedKey = contextKey
    setBusy(true)
    setNotice('')
    try {
      const plan = validateCampaignPlanDraft(draft)
      const saved = await repository.saveDraft({
        engagement_id: engagement.id, campaign_id: campaign.id,
        expected_latest_version_id: latest?.id || null, source_plan_version_id: null,
        plan,
      })
      if (!acceptCampaignPlanSave(saved, requestedKey, activeKey.current)) return
      const next = await repository.load(engagement.id, campaign.id)
      if (activeKey.current !== requestedKey) return
      setSnapshot(next)
      setViewingId(saved.id)
      setDraft(campaignPlanDraft(saved, next.requirements))
      setNotice(`Saved unapproved plan version ${saved.version_number}.`)
    } catch (error) {
      if (activeKey.current === requestedKey) setNotice(error.message)
    } finally {
      if (activeKey.current === requestedKey) setBusy(false)
    }
  }

  if (!campaign || !engagement) return <section className="panel"><p>Select an official campaign context to edit a plan.</p></section>
  return <section className="panel marketing-campaign-plan" aria-labelledby="campaign-plan-title">
    <header>
      <p className="eyebrow">Campaign plan · manual draft</p>
      <h2 id="campaign-plan-title">{campaign.name}</h2>
      <p>{engagement.name} · This editor saves unapproved planning versions only. It cannot publish, spend, activate providers, or create downstream work.</p>
    </header>

    <form onSubmit={save}>
      <label>Title<input value={draft.title} maxLength="180" required onChange={event => update('title', event.target.value)} /></label>
      <label>Objective<textarea value={draft.objective} maxLength="4000" required onChange={event => update('objective', event.target.value)} /></label>
      <label>Channels<textarea value={draft.channels.join('\n')} required placeholder="One channel per line" onChange={event => update('channels', lines(event.target.value))} /></label>
      <div className="field-grid">
        <label>Starts on<input type="date" value={draft.starts_on} onChange={event => update('starts_on', event.target.value)} /></label>
        <label>Ends on<input type="date" value={draft.ends_on} onChange={event => update('ends_on', event.target.value)} /></label>
      </div>
      <label>Audience<textarea value={draft.audience} maxLength="4000" onChange={event => update('audience', event.target.value)} /></label>
      <label>Landing page link<input type="url" value={draft.landing_page_url} maxLength="2000" onChange={event => update('landing_page_url', event.target.value)} /></label>
      <label>Approved message version<select value={draft.approved_message_version_id} onChange={event => update('approved_message_version_id', event.target.value)}>
        <option value="">No approved message pinned</option>
        {sources.approvedMessages.map(item => <option key={item.id} value={item.id}>{item.title} · v{item.versionNumber}</option>)}
      </select></label>
      <label>Measurement source version<select value={draft.measurement_plan_version_id} onChange={event => update('measurement_plan_version_id', event.target.value)}>
        <option value="">No measurement source pinned</option>
        {sources.measurementPlans.map(item => <option key={item.id} value={item.id}>{item.title} · v{item.versionNumber}</option>)}
      </select></label>

      <fieldset><legend>Creative requirements</legend>
        {draft.creative_requirements.map((item, index) => <div className="panel-subtle" key={index}>
          <label>Format<input required value={item.format} onChange={event => updateRequirement(index, 'format', event.target.value)} /></label>
          <label>Intended placement<input required value={item.intended_placement} onChange={event => updateRequirement(index, 'intended_placement', event.target.value)} /></label>
          <label>Approved message version<select value={item.message_version_id} onChange={event => updateRequirement(index, 'message_version_id', event.target.value)}>
            <option value="">Use no pinned message</option>
            {sources.approvedMessages.map(source => <option key={source.id} value={source.id}>{source.title} · v{source.versionNumber}</option>)}
          </select></label>
          <label>Due date<input type="date" value={item.due_date} onChange={event => updateRequirement(index, 'due_date', event.target.value)} /></label>
          <button type="button" className="ghost" onClick={() => removeRequirement(index)}>Remove</button>
        </div>)}
        <button type="button" className="ghost" onClick={addRequirement}>Add creative requirement</button>
      </fieldset>
      <label>Version note<input value={draft.change_summary} maxLength="1000" onChange={event => update('change_summary', event.target.value)} /></label>
      <button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save unapproved version'}</button>
      {notice && <p role="status">{notice}</p>}
    </form>

    <aside aria-label="Exact saved source and version history">
      <h3>Saved source preview</h3>
      {viewing ? <><p><strong>Version {viewing.version_number}</strong> · {viewing.lifecycle_status} · {viewing.created_at}</p>
        <p><strong>{viewing.title}</strong><br />{viewing.objective}</p>
        <p>Channels: {viewing.channels.join(', ')}<br />Dates: {viewing.starts_on || 'Not set'} — {viewing.ends_on || 'Not set'}<br />Audience: {viewing.audience || 'Not set'}</p>
        <p>Landing page: {viewing.landing_page_url || 'None pinned'}</p>
        <p>Message source: {viewing.approved_message_version_id || 'None pinned'}<br />Measurement source: {viewing.measurement_plan_version_id || 'None pinned'}</p>
        <p>Creative requirements: {requirements.length}</p>
        <ol>{requirements.map(item => <li key={item.id}>{item.format} · {item.intended_placement} · message {item.message_version_id || 'not pinned'} · due {item.due_date || 'not set'}</li>)}</ol>
      </> : <p>No saved plan version yet.</p>}
      <h3>History</h3>
      <ol>{snapshot.versions.map(version => <li key={version.id}><button type="button" className="link-button" onClick={() => setViewingId(version.id)}>Version {version.version_number} · {version.lifecycle_status}</button></li>)}</ol>
    </aside>
  </section>
}
