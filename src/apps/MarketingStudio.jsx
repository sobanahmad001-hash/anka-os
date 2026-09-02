import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'

import {
  AD_CAMPAIGN_TYPES,
  AD_MATCH_TYPES,
  AD_STRUCTURE_STATUSES,
  CAMPAIGN_STATUSES,
  MARKETING_ARTIFACT_FORMS,
  blankMarketingArtifact,
  campaignAfterDeletion,
  defaultReportingPeriod,
  latestVersion,
  lines,
} from '../data/marketingStudio.js'
import {
  BACKLINK_COST_TYPES,
  BACKLINK_LINK_TYPES,
  BACKLINK_STATUSES,
  backlinkTargetEditor,
  blankBacklinkTarget,
  filterBacklinkTargets,
} from '../data/backlinkOutreach.js'
import { marketingStudio } from '../data/marketingStudioRepository.js'
import { loadPerformanceDashboard } from '../data/performanceDashboardRepository.js'
import DepartmentChat from '../components/DepartmentChat.jsx' // eslint-disable-line no-unused-vars
import VersionProofingPanel from '../components/VersionProofingPanel.jsx'
import ArtifactRelationsPanel from '../components/ArtifactRelationsPanel.jsx'
import ArtifactApprovalPanel from '../components/ArtifactApprovalPanel.jsx'

const INPUT = 'w-full rounded-xl border border-slate-700 bg-slate-950 px-3.5 py-2.5 text-sm text-white outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20'
const BUTTON = 'rounded-xl border border-slate-700 px-4 py-2 text-sm font-semibold text-slate-200 transition hover:border-emerald-500 hover:text-white disabled:cursor-not-allowed disabled:opacity-50'
const PRIMARY = 'rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50'

function blankCampaign() {
  return { name: '', objective: '', planned_channels: '', starts_on: '', ends_on: '', planned_budget: '', currency_code: 'USD', status: 'draft' }
}

function campaignEditor(campaign) {
  if (!campaign) return blankCampaign()
  return { ...campaign, planned_channels: (campaign.planned_channels || []).join('\n'), planned_budget: campaign.planned_budget ?? '' }
}

function artifactEditor(type, content = null) {
  const blank = blankMarketingArtifact(type)
  return Object.fromEntries(Object.entries(content || blank).map(([key, value]) => [key, Array.isArray(value) ? value.join('\n') : value || '']))
}

function titleize(value) {
  return String(value || '').replaceAll('_', ' ').replace(/\b\w/g, letter => letter.toUpperCase())
}

function Notice({ error, message }) {
  if (error) return <div className="rounded-xl border border-red-900/60 bg-red-950/50 px-4 py-3 text-sm text-red-300">{error}</div>
  if (message) return <div className="rounded-xl border border-emerald-900/60 bg-emerald-950/40 px-4 py-3 text-sm text-emerald-300">{message}</div>
  return null
}

export default function MarketingStudio() {
  const [searchParams] = useSearchParams()
  const requestedEngagementId = searchParams.get('engagement') || ''
  const [engagements, setEngagements] = useState([])
  const [brands, setBrands] = useState([])
  const [backlinkBrandId, setBacklinkBrandId] = useState('')
  const [engagementId, setEngagementId] = useState('')
  const [workspace, setWorkspace] = useState(null)
  const [campaignId, setCampaignId] = useState('')
  const [tab, setTab] = useState('campaigns')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

  async function loadWorkspace(id, preferredCampaignId = '') {
    if (!id) return setWorkspace(null)
    setLoading(true)
    setError('')
    try {
      const result = await marketingStudio.load(id)
      setWorkspace(result)
      const nextCampaign = result.campaigns.find(item => item.id === preferredCampaignId)?.id || result.campaigns[0]?.id || ''
      setCampaignId(nextCampaign)
    } catch (loadError) {
      setError(loadError.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    let active = true
    Promise.all([marketingStudio.listEngagements(), marketingStudio.listBrands()]).then(([rows, brandRows]) => {
      if (!active) return
      setEngagements(rows || [])
      setBrands(brandRows || [])
      setBacklinkBrandId(brandRows?.[0]?.id || '')
      const first = rows?.find(item => item.id === requestedEngagementId)?.id || rows?.[0]?.id || ''
      setEngagementId(first)
      if (first) loadWorkspace(first)
      else setLoading(false)
    }).catch(loadError => { if (active) { setError(loadError.message); setLoading(false) } })
    return () => { active = false }
  }, [])

  const selectedCampaign = workspace?.campaigns.find(item => item.id === campaignId) || null

  async function act(callback, success, preferredCampaign = '') {
    setSaving(true); setError(''); setMessage('')
    try {
      const result = await callback()
      setMessage(success)
      await loadWorkspace(engagementId, preferredCampaign || result?.id || campaignId)
      return result
    } catch (actionError) {
      setError(actionError.message)
      return null
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="h-full overflow-y-auto bg-slate-950 text-white">
      <header className="border-b border-slate-800 bg-[radial-gradient(circle_at_top_left,rgba(16,185,129,0.12),transparent_36%)] px-6 py-6">
        <div className="mx-auto flex max-w-7xl flex-wrap items-end justify-between gap-5">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-emerald-400">Marketing department</p>
            <h1 className="mt-1 text-3xl font-semibold tracking-tight">Marketing Studio</h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-400">Plan campaigns, maintain backlink outreach research, version accountable marketing artifacts, and inspect live read-only performance.</p>
          </div>
          <Link to="/sphere/marketing" className={BUTTON}>Open Marketing work queue</Link>
        </div>
      </header>

      <main className="mx-auto max-w-7xl space-y-6 px-6 py-6">
        <Notice error={error} message={message} />
        <section className="flex flex-wrap items-end gap-4 rounded-2xl border border-slate-800 bg-slate-900/70 p-5">
          <label className="min-w-72 flex-1 text-xs font-semibold uppercase tracking-[0.12em] text-slate-400">Marketing engagement
            <select value={engagementId} onChange={event => { setEngagementId(event.target.value); loadWorkspace(event.target.value) }} className={`${INPUT} mt-2 normal-case tracking-normal`}>
              {engagements.map(item => <option key={item.id} value={item.id}>{item.name} · {item.brands?.name || 'Brand'}</option>)}
            </select>
          </label>
          {workspace?.engagement && <div className="rounded-xl bg-slate-950 px-4 py-3 text-sm text-slate-400"><span className="font-semibold text-white">{workspace.engagement.brands?.name}</span><span className="mx-2 text-slate-700">/</span>{workspace.engagement.agency_clients?.name}</div>}
        </section>

        <nav className="flex gap-2 overflow-x-auto border-b border-slate-800">
          {[['campaigns', 'Campaigns'], ['ad-tracking', 'Ad campaign tracking'], ['backlinks', 'Backlink outreach'], ['artifacts', 'Artifacts'], ['chat', 'Shared Department Chat'], ['analytics', 'Performance dashboard']].map(([id, label]) => (
            <button key={id} onClick={() => setTab(id)} className={`border-b-2 px-4 py-3 text-sm font-semibold ${tab === id ? 'border-emerald-400 text-emerald-300' : 'border-transparent text-slate-500 hover:text-white'}`}>{label}</button>
          ))}
        </nav>

        {loading ? <div className="py-20 text-center text-sm text-slate-500">Loading Marketing Studio…</div> : tab === 'backlinks' ? (
          <BacklinkOutreach brands={brands} brandId={backlinkBrandId} setBrandId={setBacklinkBrandId} />
        ) : !workspace ? (
          <div className="rounded-2xl border border-dashed border-slate-700 px-6 py-16 text-center text-sm text-slate-500">Select an engagement with a Marketing service to begin.</div>
        ) : tab === 'campaigns' ? (
          <Campaigns workspace={workspace} campaignId={campaignId} setCampaignId={setCampaignId} selected={selectedCampaign} saving={saving} act={act} />
        ) : tab === 'ad-tracking' ? (
          <AdCampaignTracking workspace={workspace} saving={saving} act={act} />
        ) : tab === 'artifacts' ? (
          <Artifacts workspace={workspace} campaign={selectedCampaign} saving={saving} act={act} setTab={setTab} onRefresh={() => loadWorkspace(engagementId, campaignId)} />
        ) : tab === 'chat' ? (
          <DepartmentChat departmentId="marketing" engagement={workspace.engagement} artifactTypes={['channel_strategy', 'campaign_brief', 'measurement_plan']} artifactDefinitions={MARKETING_ARTIFACT_FORMS} artifactForType={artifactType => workspace.artifacts.find(item => item.artifact_type === artifactType)} stageForType={() => null} onPropose={marketingStudio.proposeArtifact} onProposeWorkItem={marketingStudio.proposeWorkItem} onCreated={() => loadWorkspace(engagementId, campaignId)} />
        ) : (
          <Analytics engagementId={engagementId} brand={{ id: workspace.engagement.brand_id, name: workspace.engagement.brands?.name || 'Brand', organization_id: workspace.engagement.organization_id }} />
        )}
      </main>
    </div>
  )
}

function Campaigns({ workspace, campaignId, setCampaignId, selected, saving, act }) {
  const [creating, setCreating] = useState(!selected)
  const [form, setForm] = useState(campaignEditor(selected))
  useEffect(() => { setCreating(!selected); setForm(campaignEditor(selected)) }, [selected])

  async function submit(event) {
    event.preventDefault()
    const payload = { ...form, planned_channels: lines(form.planned_channels) }
    const result = await act(
      () => creating ? marketingStudio.createCampaign(workspace.engagement.id, payload) : marketingStudio.updateCampaign(selected.id, payload),
      creating ? 'Campaign created and recorded in the engagement timeline.' : 'Campaign planning record updated.',
    )
    if (result) { setCampaignId(result.id); setCreating(false) }
  }

  return <div className="grid gap-6 lg:grid-cols-[340px_1fr]">
    <section className="space-y-3">
      <button onClick={() => { setCreating(true); setForm(blankCampaign()) }} className={`${PRIMARY} w-full`}>New campaign</button>
      {workspace.campaigns.length === 0 ? <div className="rounded-2xl border border-dashed border-slate-700 p-8 text-center text-sm text-slate-500">No campaigns yet.</div> : workspace.campaigns.map(campaign => (
        <button key={campaign.id} onClick={() => { setCampaignId(campaign.id); setCreating(false) }} className={`w-full rounded-2xl border p-4 text-left transition ${campaignId === campaign.id && !creating ? 'border-emerald-500/60 bg-emerald-950/20' : 'border-slate-800 bg-slate-900/70 hover:border-slate-700'}`}>
          <div className="flex items-start justify-between gap-3"><p className="font-semibold text-white">{campaign.name}</p><span className="rounded-full bg-slate-950 px-2.5 py-1 text-[10px] uppercase text-slate-400">{campaign.status}</span></div>
          <p className="mt-2 line-clamp-2 text-xs leading-5 text-slate-500">{campaign.objective || 'No objective recorded yet.'}</p>
          <p className="mt-3 text-[11px] text-slate-600">{(campaign.planned_channels || []).join(' · ')}</p>
        </button>
      ))}
    </section>

    <form onSubmit={submit} className="rounded-2xl border border-slate-800 bg-slate-900/70 p-6">
      <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs font-semibold uppercase tracking-[0.14em] text-emerald-400">{creating ? 'New planning record' : 'Campaign detail'}</p><h2 className="mt-1 text-xl font-semibold">{creating ? 'Create campaign' : selected?.name}</h2></div>{!creating && <button type="button" onClick={() => { setCreating(true); setForm(blankCampaign()) }} className={BUTTON}>Start another</button>}</div>
      <div className="mt-6 grid gap-4 md:grid-cols-2">
        <Field label="Campaign name"><input required className={INPUT} value={form.name} onChange={event => setForm({ ...form, name: event.target.value })} /></Field>
        <Field label="Status"><select className={INPUT} value={form.status} onChange={event => setForm({ ...form, status: event.target.value })}>{CAMPAIGN_STATUSES.map(status => <option key={status}>{status}</option>)}</select></Field>
        <div className="md:col-span-2"><Field label="Objective"><textarea required className={`${INPUT} min-h-24`} value={form.objective} onChange={event => setForm({ ...form, objective: event.target.value })} /></Field></div>
        <div className="md:col-span-2"><Field label="Planned channels" hint="One channel per line"><textarea required className={`${INPUT} min-h-28`} value={form.planned_channels} onChange={event => setForm({ ...form, planned_channels: event.target.value })} /></Field></div>
        <Field label="Starts"><input type="date" className={INPUT} value={form.starts_on || ''} onChange={event => setForm({ ...form, starts_on: event.target.value })} /></Field>
        <Field label="Ends"><input type="date" className={INPUT} value={form.ends_on || ''} onChange={event => setForm({ ...form, ends_on: event.target.value })} /></Field>
        <Field label="Planned budget" hint="Planning only — cannot spend funds"><input type="number" min="0" step="0.01" className={INPUT} value={form.planned_budget} onChange={event => setForm({ ...form, planned_budget: event.target.value })} /></Field>
        <Field label="Currency"><input maxLength="3" className={`${INPUT} uppercase`} value={form.currency_code} onChange={event => setForm({ ...form, currency_code: event.target.value.toUpperCase() })} /></Field>
      </div>
      <div className="mt-6 flex items-center justify-between gap-4 border-t border-slate-800 pt-5"><p className="text-xs leading-5 text-slate-500">This record coordinates work only. No field or action can alter Google Ads spend.</p><button disabled={saving} className={PRIMARY}>{saving ? 'Saving…' : creating ? 'Create campaign' : 'Save changes'}</button></div>
    </form>
  </div>
}

function BacklinkOutreach({ brands, brandId, setBrandId }) { // eslint-disable-line no-unused-vars
  const [targets, setTargets] = useState([])
  const [selectedId, setSelectedId] = useState('')
  const [creating, setCreating] = useState(true)
  const [form, setForm] = useState(blankBacklinkTarget())
  const [filters, setFilters] = useState({ outreach_status: '', link_type: '', cost_type: '', minimum_relevance: '', minimum_authority: '' })
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const visibleTargets = useMemo(() => filterBacklinkTargets(targets, filters), [targets, filters])

  async function loadTargets(nextBrandId = brandId) {
    if (!nextBrandId) { setTargets([]); return }
    setLoading(true); setError('')
    try { setTargets(await marketingStudio.listBacklinkTargets(nextBrandId)) }
    catch (loadError) { setError(loadError.message) }
    finally { setLoading(false) }
  }

  useEffect(() => {
    setSelectedId(''); setCreating(true); setForm(blankBacklinkTarget()); setMessage('')
    if (!brandId) { setTargets([]); return undefined }
    let active = true
    setLoading(true); setError('')
    marketingStudio.listBacklinkTargets(brandId)
      .then(rows => { if (active) setTargets(rows) })
      .catch(loadError => { if (active) setError(loadError.message) })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [brandId])

  function editTarget(target) {
    setSelectedId(target.id); setCreating(false); setForm(backlinkTargetEditor(target)); setMessage('')
  }

  async function submit(event) {
    event.preventDefault(); setSaving(true); setError(''); setMessage('')
    try {
      const result = creating
        ? await marketingStudio.createBacklinkTarget(brandId, form)
        : await marketingStudio.updateBacklinkTarget(selectedId, form)
      setSelectedId(result.id); setCreating(false); setForm(backlinkTargetEditor(result))
      setMessage(creating ? 'Backlink target added.' : 'Backlink target updated.')
      await loadTargets(brandId)
    } catch (saveError) { setError(saveError.message) }
    finally { setSaving(false) }
  }

  if (!brands.length) return <div className="rounded-2xl border border-dashed border-slate-700 px-6 py-16 text-center text-sm text-slate-500">Create a brand before recording backlink opportunities.</div>

  return <div className="space-y-6">
    <section className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5">
      <div className="flex flex-wrap items-end justify-between gap-4"><div><p className="text-xs font-semibold uppercase tracking-[0.14em] text-emerald-400">Manual research log</p><h2 className="mt-1 text-xl font-semibold">Backlink outreach</h2><p className="mt-2 max-w-3xl text-sm leading-6 text-slate-400">Qualify opportunities and track human outreach. This area does not scrape sites, send messages, or verify backlinks.</p></div><Field label="Brand"><select className={`${INPUT} min-w-64`} value={brandId} onChange={event => setBrandId(event.target.value)}>{brands.map(brand => <option key={brand.id} value={brand.id}>{brand.name}</option>)}</select></Field></div>
      <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Field label="Status"><select className={INPUT} value={filters.outreach_status} onChange={event => setFilters({ ...filters, outreach_status: event.target.value })}><option value="">All statuses</option>{BACKLINK_STATUSES.map(value => <option key={value} value={value}>{titleize(value)}</option>)}</select></Field>
        <Field label="Link type"><select className={INPUT} value={filters.link_type} onChange={event => setFilters({ ...filters, link_type: event.target.value })}><option value="">All link types</option>{BACKLINK_LINK_TYPES.map(value => <option key={value} value={value}>{titleize(value)}</option>)}</select></Field>
        <Field label="Cost type"><select className={INPUT} value={filters.cost_type} onChange={event => setFilters({ ...filters, cost_type: event.target.value })}><option value="">All cost types</option>{BACKLINK_COST_TYPES.map(value => <option key={value} value={value}>{titleize(value)}</option>)}</select></Field>
        <Field label="Minimum relevance"><input type="number" min="0" max="100" step="0.01" className={INPUT} value={filters.minimum_relevance} onChange={event => setFilters({ ...filters, minimum_relevance: event.target.value })} /></Field>
        <Field label="Minimum authority"><input type="number" min="0" max="100" step="0.01" className={INPUT} value={filters.minimum_authority} onChange={event => setFilters({ ...filters, minimum_authority: event.target.value })} /></Field>
      </div>
    </section>

    <Notice error={error} message={message} />
    <div className="grid gap-6 xl:grid-cols-[420px_1fr]">
      <section className="space-y-3">
        <button type="button" onClick={() => { setCreating(true); setSelectedId(''); setForm(blankBacklinkTarget()); setMessage('') }} className={`${PRIMARY} w-full`}>New backlink target</button>
        {loading ? <div className="rounded-2xl border border-slate-800 p-8 text-center text-sm text-slate-500">Loading targets…</div> : visibleTargets.length === 0 ? <div className="rounded-2xl border border-dashed border-slate-700 p-8 text-center text-sm text-slate-500">No targets match these filters.</div> : visibleTargets.map(target => <button type="button" key={target.id} onClick={() => editTarget(target)} className={`w-full rounded-2xl border p-4 text-left ${selectedId === target.id && !creating ? 'border-emerald-500/60 bg-emerald-950/20' : 'border-slate-800 bg-slate-900/70 hover:border-slate-700'}`}>
          <div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="font-semibold text-white">{target.site_name}</p><p className="mt-1 truncate text-xs text-slate-500">{target.site_url || 'URL not recorded'} · {target.industry_category || 'Uncategorised'}</p></div><span className="shrink-0 rounded-full bg-slate-950 px-2.5 py-1 text-[10px] uppercase text-slate-400">{titleize(target.outreach_status)}</span></div>
          <div className="mt-4 grid grid-cols-3 gap-2 text-xs"><Metric label="Relevance" value={target.relevance_score} /><Metric label="Authority" value={target.domain_authority} /><Metric label="Traffic" value={target.estimated_traffic} /></div>
          <p className="mt-3 text-[11px] text-slate-600">{target.link_type ? titleize(target.link_type) : 'Link type unknown'} · {target.cost_type ? titleize(target.cost_type) : 'Cost unknown'}</p>
        </button>)}
      </section>

      <form onSubmit={submit} className="rounded-2xl border border-slate-800 bg-slate-900/70 p-6">
        <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs font-semibold uppercase tracking-[0.14em] text-emerald-400">{creating ? 'Research opportunity' : 'Target detail'}</p><h2 className="mt-1 text-xl font-semibold">{creating ? 'Add backlink target' : form.site_name}</h2></div>{!creating && <span className="rounded-full bg-slate-950 px-3 py-1.5 text-xs text-slate-400">Historical record retained</span>}</div>
        <div className="mt-6 grid gap-4 md:grid-cols-2">
          <Field label="Site name"><input required maxLength="240" className={INPUT} value={form.site_name} onChange={event => setForm({ ...form, site_name: event.target.value })} /></Field>
          <Field label="Site URL" hint="Optional HTTP or HTTPS URL"><input type="url" maxLength="2048" className={INPUT} value={form.site_url} onChange={event => setForm({ ...form, site_url: event.target.value })} /></Field>
          <Field label="Industry category"><input maxLength="160" className={INPUT} value={form.industry_category} onChange={event => setForm({ ...form, industry_category: event.target.value })} /></Field>
          <Field label="Outreach status"><select className={INPUT} value={form.outreach_status} onChange={event => setForm({ ...form, outreach_status: event.target.value })}>{BACKLINK_STATUSES.map(value => <option key={value} value={value}>{titleize(value)}</option>)}</select></Field>
          <Field label="Domain authority" hint="0–100; blank means unknown"><input type="number" min="0" max="100" step="0.01" className={INPUT} value={form.domain_authority} onChange={event => setForm({ ...form, domain_authority: event.target.value })} /></Field>
          <Field label="Relevance score" hint="0–100; blank means unknown"><input type="number" min="0" max="100" step="0.01" className={INPUT} value={form.relevance_score} onChange={event => setForm({ ...form, relevance_score: event.target.value })} /></Field>
          <Field label="Estimated traffic" hint="Blank means unknown"><input type="number" min="0" step="0.01" className={INPUT} value={form.estimated_traffic} onChange={event => setForm({ ...form, estimated_traffic: event.target.value })} /></Field>
          <Field label="Link type"><select className={INPUT} value={form.link_type} onChange={event => setForm({ ...form, link_type: event.target.value })}><option value="">Unknown</option>{BACKLINK_LINK_TYPES.map(value => <option key={value} value={value}>{titleize(value)}</option>)}</select></Field>
          <Field label="Cost type"><select className={INPUT} value={form.cost_type} onChange={event => setForm({ ...form, cost_type: event.target.value })}><option value="">Unknown</option>{BACKLINK_COST_TYPES.map(value => <option key={value} value={value}>{titleize(value)}</option>)}</select></Field>
          <div className="md:col-span-2"><Field label="Notes" hint="Operational context only"><textarea maxLength="20000" className={`${INPUT} min-h-32`} value={form.notes} onChange={event => setForm({ ...form, notes: event.target.value })} /></Field></div>
        </div>
        <div className="mt-6 flex flex-wrap items-center justify-between gap-4 border-t border-slate-800 pt-5"><p className="text-xs leading-5 text-slate-500">Secured and declined targets stay in the log and remain filterable.</p><button disabled={saving || !brandId} className={PRIMARY}>{saving ? 'Saving…' : creating ? 'Add target' : 'Save changes'}</button></div>
      </form>
    </div>
  </div>
}

function blankAdCampaign() {
  return {
    campaign_name: '', campaign_type: 'search', status: 'draft', daily_budget: '', total_budget: '',
    start_date: '', end_date: '', goal: '', location_targeting: '', audience_segment: '',
    provider_connection_id: '', external_account_id: '', external_campaign_id: '',
  }
}

function editAdCampaign(campaign) {
  if (!campaign) return blankAdCampaign()
  return { ...campaign, location_targeting: (campaign.location_targeting || []).join('\n') }
}

function metric(value, kind = 'number') {
  if (value === null || value === undefined) return '—'
  if (kind === 'percent') return `${(Number(value) * 100).toFixed(2)}%`
  if (kind === 'money') return Number(value).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  return Number(value).toLocaleString(undefined, { maximumFractionDigits: 2 })
}

function AdCampaignTracking({ workspace, saving, act }) {
  const [selectedId, setSelectedId] = useState(workspace.adCampaigns[0]?.id || '')
  const [creating, setCreating] = useState(workspace.adCampaigns.length === 0)
  const selected = useMemo(() => workspace.adCampaigns.find(item => item.id === selectedId) || null, [workspace.adCampaigns, selectedId])
  const [form, setForm] = useState(editAdCampaign(selected))
  const [groupId, setGroupId] = useState('')
  const [groupForm, setGroupForm] = useState({ name: '', status: 'draft' })
  const [keywordId, setKeywordId] = useState('')
  const [keywordForm, setKeywordForm] = useState({ keyword: '', match_type: 'phrase', is_negative: false })
  const [snapshotDate, setSnapshotDate] = useState(new Date().toISOString().slice(0, 10))

  const groups = useMemo(() => workspace.adGroups.filter(item => item.ad_campaign_id === selected?.id), [workspace.adGroups, selected?.id])
  const selectedGroup = useMemo(() => groups.find(item => item.id === groupId) || null, [groups, groupId])
  const keywords = useMemo(() => workspace.adKeywords.filter(item => item.ad_group_id === selectedGroup?.id), [workspace.adKeywords, selectedGroup?.id])
  const snapshots = useMemo(() => workspace.adSnapshots.filter(item => item.ad_campaign_id === selected?.id), [workspace.adSnapshots, selected?.id])
  const latest = snapshots.at(-1)

  useEffect(() => {
    if (selectedId && !workspace.adCampaigns.some(item => item.id === selectedId)) {
      setSelectedId(workspace.adCampaigns[0]?.id || '')
    }
  }, [workspace.adCampaigns, selectedId])
  useEffect(() => { if (!creating) setForm(editAdCampaign(selected)) }, [selected, creating])
  useEffect(() => {
    const first = groups[0]
    if (!groups.some(item => item.id === groupId)) {
      setGroupId(first?.id || '')
      setGroupForm(first ? { name: first.name, status: first.status } : { name: '', status: 'draft' })
    }
  }, [groups, groupId])
  useEffect(() => {
    if (selectedGroup) setGroupForm({ name: selectedGroup.name, status: selectedGroup.status })
    setKeywordId(''); setKeywordForm({ keyword: '', match_type: 'phrase', is_negative: false })
  }, [selectedGroup])

  async function saveCampaign(event) {
    event.preventDefault()
    const payload = { ...form, location_targeting: lines(form.location_targeting) }
    const result = await act(
      () => creating
        ? marketingStudio.createAdCampaign(workspace.engagement.id, payload)
        : marketingStudio.updateAdCampaign(workspace.engagement.id, selected.id, payload),
      creating ? 'Google Ads planning campaign created.' : 'Google Ads planning campaign updated.',
    )
    if (result) { setSelectedId(result.id); setCreating(false) }
  }

  function selectConnection(connectionId) {
    const connection = workspace.googleAdsConnections.find(item => item.id === connectionId)
    setForm({ ...form, provider_connection_id: connectionId, external_account_id: connection?.customer_id || '', external_campaign_id: connectionId ? form.external_campaign_id : '' })
  }

  async function removeCampaign() {
    if (!selected || !window.confirm(`Delete the local planning record “${selected.campaign_name}” and its local descendants? Google Ads will not be changed.`)) return
    const nextCampaign = campaignAfterDeletion(workspace.adCampaigns, selected.id)
    const result = await act(() => marketingStudio.deleteAdCampaign(workspace.engagement.id, selected.id), 'Local ad campaign planning record deleted.')
    if (result) {
      setSelectedId(nextCampaign?.id || '')
      setCreating(!nextCampaign)
      setForm(editAdCampaign(nextCampaign))
    }
  }

  async function saveGroup(event) {
    event.preventDefault()
    const result = await act(
      () => marketingStudio.saveAdGroup(workspace.engagement.id, selected.id, groupId, groupForm),
      groupId ? 'Ad group planning record updated.' : 'Ad group planning record created.',
    )
    if (result) setGroupId(result.id)
  }

  async function removeGroup() {
    if (!selectedGroup || !window.confirm(`Delete local ad group “${selectedGroup.name}” and its keywords?`)) return
    const result = await act(() => marketingStudio.deleteAdGroup(workspace.engagement.id, selectedGroup.id), 'Local ad group deleted.')
    if (result) { setGroupId(''); setGroupForm({ name: '', status: 'draft' }) }
  }

  async function saveKeyword(event) {
    event.preventDefault()
    const result = await act(
      () => marketingStudio.saveAdKeyword(workspace.engagement.id, selectedGroup.id, keywordId, keywordForm),
      keywordId ? 'Keyword planning record updated.' : 'Keyword planning record added.',
    )
    if (result) { setKeywordId(''); setKeywordForm({ keyword: '', match_type: 'phrase', is_negative: false }) }
  }

  async function removeKeyword(id) {
    await act(() => marketingStudio.deleteAdKeyword(workspace.engagement.id, id), 'Keyword planning record deleted.')
  }

  async function importSnapshot() {
    const result = await act(
      () => marketingStudio.importAdPerformance(workspace.engagement.id, selected.id, snapshotDate),
      'Read-only Google Ads performance import completed.',
    )
    if (result && !result.imported) window.alert('That campaign/date snapshot already exists. The immutable original was kept.')
  }

  return <div className="space-y-6">
    <div className="rounded-2xl border border-amber-700/50 bg-amber-950/25 p-5 text-sm leading-6 text-amber-100">
      <p className="font-semibold">Planning mirror only</p>
      <p className="mt-1 text-amber-200/80">Campaign, budget, status, ad group, and keyword changes made here are local planning records. They must still be executed in Google Ads. The only provider action below is a read-only performance import.</p>
    </div>
    <div className="grid gap-6 xl:grid-cols-[320px_1fr]">
      <section className="space-y-3">
        <button onClick={() => { setCreating(true); setSelectedId(''); setForm(blankAdCampaign()) }} className={`${PRIMARY} w-full`}>New Google Ads plan</button>
        {workspace.adCampaigns.map(campaign => {
          const campaignSnapshots = workspace.adSnapshots.filter(item => item.ad_campaign_id === campaign.id)
          const summary = campaignSnapshots.at(-1)
          return <button key={campaign.id} onClick={() => { setCreating(false); setSelectedId(campaign.id) }} className={`w-full rounded-2xl border p-4 text-left ${!creating && selectedId === campaign.id ? 'border-emerald-500/60 bg-emerald-950/20' : 'border-slate-800 bg-slate-900/70'}`}>
            <div className="flex justify-between gap-3"><span className="font-semibold">{campaign.campaign_name}</span><span className="text-[10px] uppercase text-slate-500">{campaign.status}</span></div>
            <p className="mt-2 text-xs text-slate-500">{titleize(campaign.campaign_type)} · Daily {campaign.daily_budget == null ? '—' : metric(campaign.daily_budget, 'money')} · Total {campaign.total_budget == null ? '—' : metric(campaign.total_budget, 'money')}</p>
            <p className="mt-1 text-[11px] text-slate-600">{campaign.start_date || 'No start'} → {campaign.end_date || 'No end'}</p>
            <p className="mt-2 line-clamp-2 text-xs leading-5 text-slate-500">{campaign.goal || 'No campaign goal recorded.'}</p>
            <p className="mt-2 text-[11px] leading-5 text-slate-600">{summary ? `${summary.snapshot_date} · ${metric(summary.impressions)} impressions · ${metric(summary.clicks)} clicks · ${metric(summary.cost, 'money')} cost · ${metric(summary.conversions)} conversions` : 'No imported performance'}</p>
          </button>
        })}
      </section>
      <section className="space-y-6">
        <form onSubmit={saveCampaign} className="rounded-2xl border border-slate-800 bg-slate-900/70 p-6">
          <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs font-semibold uppercase tracking-[0.14em] text-emerald-400">Google Ads planning</p><h2 className="mt-1 text-xl font-semibold">{creating ? 'Create campaign structure' : selected?.campaign_name}</h2></div>{selected && !creating && <button type="button" onClick={removeCampaign} className="text-xs font-semibold text-red-400 hover:text-red-300">Delete local plan</button>}</div>
          <div className="mt-6 grid gap-4 md:grid-cols-2">
            <Field label="Campaign name"><input required className={INPUT} value={form.campaign_name} onChange={event => setForm({ ...form, campaign_name: event.target.value })} /></Field>
            <Field label="Campaign type"><select className={INPUT} value={form.campaign_type} onChange={event => setForm({ ...form, campaign_type: event.target.value })}>{AD_CAMPAIGN_TYPES.map(value => <option key={value}>{value}</option>)}</select></Field>
            <Field label="Status"><select className={INPUT} value={form.status} onChange={event => setForm({ ...form, status: event.target.value })}>{AD_STRUCTURE_STATUSES.map(value => <option key={value}>{value}</option>)}</select></Field>
            <Field label="Audience segment"><input className={INPUT} value={form.audience_segment} onChange={event => setForm({ ...form, audience_segment: event.target.value })} /></Field>
            <Field label="Daily budget"><input type="number" min="0" step="0.01" className={INPUT} value={form.daily_budget ?? ''} onChange={event => setForm({ ...form, daily_budget: event.target.value })} /></Field>
            <Field label="Total budget"><input type="number" min="0" step="0.01" className={INPUT} value={form.total_budget ?? ''} onChange={event => setForm({ ...form, total_budget: event.target.value })} /></Field>
            <Field label="Start date"><input type="date" className={INPUT} value={form.start_date || ''} onChange={event => setForm({ ...form, start_date: event.target.value })} /></Field>
            <Field label="End date"><input type="date" className={INPUT} value={form.end_date || ''} onChange={event => setForm({ ...form, end_date: event.target.value })} /></Field>
            <div className="md:col-span-2"><Field label="Goal"><textarea className={`${INPUT} min-h-20`} value={form.goal} onChange={event => setForm({ ...form, goal: event.target.value })} /></Field></div>
            <div className="md:col-span-2"><Field label="Location targeting" hint="One location per line"><textarea className={`${INPUT} min-h-20`} value={form.location_targeting} onChange={event => setForm({ ...form, location_targeting: event.target.value })} /></Field></div>
            <Field label="Verified Google Ads connection"><select className={INPUT} value={form.provider_connection_id || ''} onChange={event => selectConnection(event.target.value)}><option value="">Planning only — not linked</option>{workspace.googleAdsConnections.map(item => <option key={item.id} value={item.id}>{item.display_name}</option>)}</select></Field>
            <Field label="External campaign ID"><input inputMode="numeric" disabled={!form.provider_connection_id} className={INPUT} value={form.external_campaign_id || ''} onChange={event => setForm({ ...form, external_campaign_id: event.target.value.replace(/\D/g, '') })} /></Field>
          </div>
          <div className="mt-6 flex justify-end border-t border-slate-800 pt-5"><button disabled={saving} className={PRIMARY}>{saving ? 'Saving…' : creating ? 'Create local plan' : 'Save local changes'}</button></div>
        </form>

        {selected && !creating && <>
          <div className="grid gap-6 lg:grid-cols-2">
            <form onSubmit={saveGroup} className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5"><div className="flex justify-between"><h3 className="font-semibold">Ad groups</h3><button type="button" onClick={() => { setGroupId(''); setGroupForm({ name: '', status: 'draft' }) }} className="text-xs text-emerald-400">New group</button></div><div className="mt-4 flex flex-wrap gap-2">{groups.map(group => <button type="button" key={group.id} onClick={() => { setGroupId(group.id); setGroupForm({ name: group.name, status: group.status }) }} className={`rounded-full border px-3 py-1.5 text-xs ${groupId === group.id ? 'border-emerald-500 text-emerald-300' : 'border-slate-700 text-slate-400'}`}>{group.name}</button>)}</div><div className="mt-4 grid gap-3"><Field label="Group name"><input required className={INPUT} value={groupForm.name} onChange={event => setGroupForm({ ...groupForm, name: event.target.value })} /></Field><Field label="Status"><select className={INPUT} value={groupForm.status} onChange={event => setGroupForm({ ...groupForm, status: event.target.value })}>{AD_STRUCTURE_STATUSES.map(value => <option key={value}>{value}</option>)}</select></Field><div className="flex justify-end gap-3">{selectedGroup && <button type="button" onClick={removeGroup} className="text-xs text-red-400">Delete</button>}<button disabled={saving} className={BUTTON}>{groupId ? 'Update group' : 'Add group'}</button></div></div></form>
            <form onSubmit={saveKeyword} className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5"><h3 className="font-semibold">Keywords</h3>{!selectedGroup ? <p className="mt-4 text-sm text-slate-500">Select or create an ad group first.</p> : <><div className="mt-4 max-h-40 space-y-2 overflow-auto">{keywords.map(item => <div key={item.id} className="flex items-center gap-2 rounded-xl bg-slate-950 px-3 py-2 text-xs"><button type="button" onClick={() => { setKeywordId(item.id); setKeywordForm({ keyword: item.keyword, match_type: item.match_type, is_negative: item.is_negative }) }} className="min-w-0 flex-1 truncate text-left text-slate-300">{item.keyword}</button><span className={item.is_negative ? 'text-red-400' : 'text-emerald-400'}>{item.is_negative ? 'Negative' : 'Positive'}</span><span className="text-slate-600">{item.match_type}</span><button type="button" onClick={() => removeKeyword(item.id)} className="text-red-500">×</button></div>)}</div><div className="mt-4 grid gap-3"><Field label="Keyword"><input required className={INPUT} value={keywordForm.keyword} onChange={event => setKeywordForm({ ...keywordForm, keyword: event.target.value })} /></Field><div className="grid grid-cols-2 gap-3"><Field label="Match"><select className={INPUT} value={keywordForm.match_type} onChange={event => setKeywordForm({ ...keywordForm, match_type: event.target.value })}>{AD_MATCH_TYPES.map(value => <option key={value}>{value}</option>)}</select></Field><label className="flex items-end gap-2 pb-3 text-xs text-slate-400"><input type="checkbox" checked={keywordForm.is_negative} onChange={event => setKeywordForm({ ...keywordForm, is_negative: event.target.checked })} /> Negative keyword</label></div><div className="flex justify-end"><button disabled={saving} className={BUTTON}>{keywordId ? 'Update keyword' : 'Add keyword'}</button></div></div></>}</form>
          </div>
          <section className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5"><div className="flex flex-wrap items-end gap-4"><div className="mr-auto"><h3 className="font-semibold">Dated performance snapshots</h3><p className="mt-1 text-sm text-slate-500">Append-only reporting history from the linked Google Ads campaign.</p></div><Field label="Snapshot date"><input type="date" className={INPUT} value={snapshotDate} onChange={event => setSnapshotDate(event.target.value)} /></Field><button type="button" disabled={saving || !selected.provider_connection_id} onClick={importSnapshot} className={PRIMARY}>Import read-only metrics</button></div>{latest && <div className="mt-5 grid gap-3 sm:grid-cols-3"><MetricCard label="CTR" value={metric(latest.ctr, 'percent')} /><MetricCard label="CPC" value={metric(latest.cpc, 'money')} /><MetricCard label="Cost / conversion" value={metric(latest.cost_per_conversion, 'money')} /></div>}<div className="mt-5 overflow-x-auto"><table className="w-full min-w-[760px] text-left text-xs"><thead className="text-slate-500"><tr>{['Date', 'Impressions', 'Clicks', 'Cost', 'Conversions', 'CTR', 'CPC', 'Cost / conversion'].map(label => <th key={label} className="border-b border-slate-800 px-3 py-2">{label}</th>)}</tr></thead><tbody>{snapshots.map(row => <tr key={row.id} className="text-slate-300"><td className="px-3 py-2">{row.snapshot_date}</td><td className="px-3 py-2">{metric(row.impressions)}</td><td className="px-3 py-2">{metric(row.clicks)}</td><td className="px-3 py-2">{metric(row.cost, 'money')}</td><td className="px-3 py-2">{metric(row.conversions)}</td><td className="px-3 py-2">{metric(row.ctr, 'percent')}</td><td className="px-3 py-2">{metric(row.cpc, 'money')}</td><td className="px-3 py-2">{metric(row.cost_per_conversion, 'money')}</td></tr>)}</tbody></table>{snapshots.length === 0 && <p className="py-8 text-center text-sm text-slate-500">No snapshots imported yet.</p>}</div></section>
        </>}
      </section>
    </div>
  </div>
}

function Metric({ label, value }) { // eslint-disable-line no-unused-vars
  const known = value !== null && value !== undefined && value !== ''
  return <div className="rounded-lg bg-slate-950 px-2.5 py-2"><p className="text-[9px] uppercase tracking-[0.1em] text-slate-600">{label}</p><p className="mt-1 font-semibold text-slate-300">{known ? Number(value).toLocaleString(undefined, { maximumFractionDigits: 2 }) : '—'}</p></div>
}

function MetricCard({ label, value }) {
  return <div className="rounded-xl bg-slate-950 p-4"><p className="text-[10px] uppercase tracking-[0.12em] text-slate-500">{label}</p><p className="mt-1 text-xl font-semibold">{value}</p></div>
}

function Artifacts({ workspace, campaign, saving, act, setTab, onRefresh }) {
  const [type, setType] = useState('channel_strategy')
  const links = campaign ? workspace.links.filter(item => item.campaign_id === campaign.id) : []
  const artifact = workspace.artifacts.find(item => links.some(link => link.artifact_id === item.id) && item.artifact_type === type)
  const versions = artifact ? workspace.versions.filter(item => item.artifact_id === artifact.id) : []
  const latest = latestVersion(versions)
  const approval = latest ? workspace.approvals.find(item => item.artifact_version_id === latest.id) : null
  const [form, setForm] = useState(artifactEditor(type, latest?.content))
  useEffect(() => { setForm(artifactEditor(type, latest?.content)) }, [type, latest?.id])
  const definition = MARKETING_ARTIFACT_FORMS[type]

  if (!campaign) return <div className="rounded-2xl border border-dashed border-slate-700 px-6 py-16 text-center"><p className="text-sm text-slate-400">Create or select a campaign before linking its artifacts.</p><button onClick={() => setTab('campaigns')} className={`${PRIMARY} mt-4`}>Go to campaigns</button></div>

  async function save(event) {
    event.preventDefault()
    const content = Object.fromEntries(definition.fields.map(([key, , kind]) => [key, kind === 'list' ? lines(form[key]) : form[key]]))
    await act(() => marketingStudio.saveArtifact({
      engagement_id: workspace.engagement.id, campaign_id: campaign.id, artifact_id: artifact?.id || null,
      artifact_type: type, title: `${campaign.name} — ${definition.label}`,
      content, change_summary: latest ? 'Marketing Studio revision' : 'Initial Marketing Studio version', ai_use_allowed: false,
    }), `${definition.label} saved as a new immutable version.`, campaign.id)
  }

  return <div className="grid gap-6 xl:grid-cols-[300px_1fr]">
    <section className="space-y-3"><div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4"><p className="text-xs uppercase tracking-[0.14em] text-slate-500">Campaign</p><p className="mt-1 font-semibold text-white">{campaign.name}</p></div>{Object.entries(MARKETING_ARTIFACT_FORMS).map(([id, item]) => {
      const linkedArtifact = workspace.artifacts.find(candidate => links.some(link => link.artifact_id === candidate.id) && candidate.artifact_type === id)
      return <button key={id} onClick={() => setType(id)} className={`w-full rounded-2xl border p-4 text-left ${type === id ? 'border-emerald-500/60 bg-emerald-950/20' : 'border-slate-800 bg-slate-900/70'}`}><div className="flex justify-between gap-3"><span className="font-semibold text-white">{item.label}</span><span className="text-[10px] uppercase text-slate-500">{linkedArtifact ? 'Versioned' : 'Not started'}</span></div><p className="mt-2 text-xs leading-5 text-slate-500">{item.description}</p></button>
    })}</section>
    <div><form onSubmit={save} className="rounded-2xl border border-slate-800 bg-slate-900/70 p-6"><div className="flex flex-wrap justify-between gap-4"><div><p className="text-xs font-semibold uppercase tracking-[0.14em] text-emerald-400">Immutable artifact</p><h2 className="mt-1 text-xl font-semibold">{definition.label}</h2><p className="mt-2 max-w-2xl text-sm leading-6 text-slate-400">{definition.description}</p></div><div className="text-right text-xs text-slate-500"><p>{latest ? `Version ${latest.version_number}` : 'No version yet'}</p><p className={approval ? 'mt-1 text-emerald-400' : 'mt-1 text-amber-400'}>{approval ? 'Exact version approved' : 'Approval pending'}</p></div></div>
      <div className="mt-6 grid gap-4 md:grid-cols-2">{definition.fields.map(([key, label, kind]) => <div key={key} className={kind === 'textarea' || kind === 'list' ? 'md:col-span-2' : ''}><Field label={label} hint={kind === 'list' ? 'One item per line' : ''}>{kind === 'textarea' || kind === 'list' ? <textarea required className={`${INPUT} min-h-28`} value={form[key] || ''} onChange={event => setForm({ ...form, [key]: event.target.value })} /> : <input required type={kind} className={INPUT} value={form[key] || ''} onChange={event => setForm({ ...form, [key]: event.target.value })} />}</Field></div>)}</div>
      <div className="mt-6 flex flex-wrap items-center justify-end gap-3 border-t border-slate-800 pt-5"><button disabled={saving} className={PRIMARY}>{saving ? 'Saving…' : latest ? 'Create new version' : 'Save first version'}</button></div>
    </form><ArtifactApprovalPanel version={latest} approval={approval} theme="emerald" singleApprovalLabel={`Approve version ${latest?.version_number}`} onSingleApprove={() => act(() => marketingStudio.approveArtifact(latest.id), `${definition.label} exact version approved.`, campaign.id)} onChanged={onRefresh} /><ArtifactRelationsPanel artifact={artifact} /><VersionProofingPanel targetKind="artifact" versions={versions} initialVersionId={latest?.id} department="marketing" theme="emerald" /></div>
  </div>
}

function Analytics({ engagementId, brand }) {
  const initial = useMemo(() => defaultReportingPeriod(), [])
  const [period, setPeriod] = useState(initial)
  const [dashboard, setDashboard] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => { setDashboard(null); setError('') }, [engagementId, brand.id])
  async function load() {
    setLoading(true); setError('')
    try { setDashboard(await loadPerformanceDashboard({ engagementId, brand, period })) }
    catch (loadError) { setError(loadError.message) }
    finally { setLoading(false) }
  }
  return <section className="space-y-5"><div className="flex flex-wrap items-end gap-4 rounded-2xl border border-slate-800 bg-slate-900/70 p-5"><div className="mr-auto"><p className="text-xs font-semibold uppercase tracking-[0.14em] text-emerald-400">{brand.name}</p><h2 className="mt-1 font-semibold">Unified performance dashboard</h2><p className="mt-1 max-w-2xl text-sm leading-6 text-slate-400">Live, read-only reporting across organic visibility, technical health, paid campaigns, and Meta. Every section reads its existing source; no rollup is stored.</p></div><Field label="From"><input type="date" className={INPUT} value={period.start} onChange={event => setPeriod({ ...period, start: event.target.value })} /></Field><Field label="To"><input type="date" className={INPUT} value={period.end} onChange={event => setPeriod({ ...period, end: event.target.value })} /></Field><button onClick={load} disabled={loading} className={PRIMARY}>{loading ? 'Loading sources…' : 'Load dashboard'}</button></div>
    {error && <Notice error={error} />}
    {!dashboard ? <div className="rounded-2xl border border-dashed border-slate-700 px-6 py-16 text-center text-sm text-slate-500">Choose a period to read the brand's current source data. Missing connectors will appear as calm empty states, not fabricated metrics.</div> : <PerformanceSections dashboard={dashboard} />}
  </section>
}

function PerformanceSections({ dashboard }) {
  const { organic, technical, paid, social } = dashboard
  return <div className="space-y-5">
    {dashboard.source_errors.map(source => <div key={`${source.provider}-${source.connection_name}`} className="rounded-xl border border-amber-900/50 bg-amber-950/20 px-4 py-3 text-sm text-amber-200">{source.connection_name || titleize(source.provider)} could not be read: {source.error}</div>)}
    <div className="grid gap-5 xl:grid-cols-2">
      <DashboardSection eyebrow="Organic visibility" title="Search and site activity" available={organic.available} empty="No Search Console, GA4, or tracked-keyword data is available for this brand.">
        <MetricGrid items={[
          ['GSC clicks', organic.gsc.connected ? metric(organic.gsc.clicks) : 'Not connected'],
          ['GSC impressions', organic.gsc.connected ? metric(organic.gsc.impressions) : 'Not connected'],
          ['GA4 sessions', organic.ga4.connected ? metric(organic.ga4.sessions) : 'Not connected'],
          ['GA4 active users', organic.ga4.connected ? metric(organic.ga4.active_users) : 'Not connected'],
        ]} />
        <TrendChart points={organic.gsc.trend} series={[['clicks', 'Clicks', '#34d399'], ['impressions', 'Impressions', '#38bdf8']]} />
        <div className="grid grid-cols-2 gap-3 border-t border-slate-800 pt-4 sm:grid-cols-4">
          <CompactMetric label="Tracked keywords" value={organic.keywords.tracked} />
          <CompactMetric label="Top 10" value={organic.keywords.top_10} />
          <CompactMetric label="Average position" value={organic.keywords.average_position === null ? '—' : metric(organic.keywords.average_position)} />
          <CompactMetric label="Improved" value={organic.keywords.improved} />
        </div>
        {organic.keywords.no_rank_data > 0 && <p className="text-xs text-slate-500">{organic.keywords.no_rank_data} tracked keyword{organic.keywords.no_rank_data === 1 ? '' : 's'} has no Search Console rank data yet.</p>}
      </DashboardSection>

      <DashboardSection eyebrow="Technical health" title="Pages needing attention" available={technical.available} empty="No tracked pages exist for this brand yet.">
        <MetricGrid items={[
          ['Tracked pages', metric(technical.tracked_pages)],
          ['Pages with open issues', metric(technical.pages_with_open_issues)],
          ['Open issues', metric(technical.open_issues)],
          ['Need attention', metric(technical.needs_attention)],
        ]} />
        <div className="space-y-2">
          {technical.pages.slice(0, 5).map(page => <div key={page.id} className="flex items-center gap-3 rounded-xl bg-slate-950 px-3 py-2.5 text-xs"><span className="min-w-0 flex-1 truncate text-slate-300">{page.page_url}</span><span className="shrink-0 text-amber-300">{page.open_issue_count} issue{page.open_issue_count === 1 ? '' : 's'}</span></div>)}
          {technical.pages.length === 0 && <p className="rounded-xl bg-slate-950 px-3 py-4 text-center text-xs text-emerald-300">No tracked page currently needs attention.</p>}
          {technical.pages.length > 5 && <p className="text-xs text-slate-500">And {technical.pages.length - 5} more page{technical.pages.length - 5 === 1 ? '' : 's'} needing attention.</p>}
        </div>
      </DashboardSection>

      <DashboardSection eyebrow="Paid performance" title="Google Ads snapshots" available={paid.available} empty="No Google Ads planning campaign exists for this brand.">
        <MetricGrid items={[
          ['Spend (account currency)', metric(paid.spend, 'money')], ['Impressions', metric(paid.impressions)],
          ['Clicks', metric(paid.clicks)], ['Conversions', metric(paid.conversions)],
        ]} />
        <TrendChart points={paid.trend} series={[['cost', 'Spend', '#fbbf24'], ['conversions', 'Conversions', '#a78bfa']]} />
        <p className="text-xs text-slate-500">{paid.active_campaigns} active of {paid.campaigns} tracked campaign{paid.campaigns === 1 ? '' : 's'} · CTR {metric(paid.ctr, 'percent')}</p>
      </DashboardSection>

      <DashboardSection eyebrow="Social performance" title="Meta organic snapshots" available={social.available} empty="No Meta connection exists for this brand.">
        <MetricGrid items={[
          ['Reach', metric(social.reach)], ['Impressions', metric(social.impressions)],
          ['Engagement', metric(social.engagement)], ['Engagement rate', metric(social.engagement_rate, 'percent')],
        ]} />
        <TrendChart points={social.trend} series={[['reach', 'Reach', '#fb7185'], ['engagement', 'Engagement', '#c084fc']]} />
        <p className="text-xs text-slate-500">{social.connections} Meta connection{social.connections === 1 ? '' : 's'} · {social.platforms.length ? social.platforms.map(titleize).join(' + ') : 'No dated snapshots in this period'}</p>
      </DashboardSection>
    </div>
  </div>
}

function DashboardSection({ eyebrow, title, available, empty, children }) {
  return <article className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5"><div className="mb-5 flex items-start justify-between gap-4"><div><p className="text-xs font-semibold uppercase tracking-[0.14em] text-emerald-400">{eyebrow}</p><h3 className="mt-1 font-semibold text-white">{title}</h3></div><span className={`rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide ${available ? 'bg-emerald-950 text-emerald-300' : 'bg-slate-950 text-slate-500'}`}>{available ? 'Available' : 'No source'}</span></div>{available ? <div className="space-y-4">{children}</div> : <div className="rounded-xl border border-dashed border-slate-700 px-4 py-10 text-center text-sm leading-6 text-slate-500">{empty}</div>}</article>
}

function MetricGrid({ items }) {
  return <div className="grid grid-cols-2 gap-3">{items.map(([label, value]) => <div key={label} className="rounded-xl bg-slate-950 p-3"><p className="text-[10px] uppercase tracking-[0.12em] text-slate-500">{label}</p><p className="mt-1 text-lg font-semibold text-white">{value}</p></div>)}</div>
}

function CompactMetric({ label, value }) {
  return <div><p className="text-[10px] uppercase tracking-[0.1em] text-slate-600">{label}</p><p className="mt-1 text-sm font-semibold text-slate-200">{value}</p></div>
}

function TrendChart({ points, series }) {
  if (points.length < 2) return <div className="rounded-xl border border-dashed border-slate-800 px-4 py-6 text-center text-xs text-slate-600">A simple time series appears after two dated snapshots.</div>
  const width = 520
  const height = 130
  const paths = series.map(([field, label, color]) => {
    const values = points.map(point => Number(point[field]) || 0)
    const max = Math.max(...values, 1)
    const coordinates = values.map((value, index) => `${(index / (values.length - 1)) * width},${height - (value / max) * (height - 12)}`).join(' ')
    return { field, label, color, coordinates }
  })
  return <div className="rounded-xl bg-slate-950 p-3"><div className="mb-2 flex flex-wrap gap-4">{paths.map(path => <span key={path.field} className="flex items-center gap-1.5 text-[10px] text-slate-500"><span className="h-2 w-2 rounded-full" style={{ backgroundColor: path.color }} />{path.label}</span>)}<span className="ml-auto text-[10px] text-slate-700">Each line uses its own scale</span></div><svg viewBox={`0 0 ${width} ${height}`} className="h-32 w-full" role="img" aria-label={`${series.map(item => item[1]).join(' and ')} trend from ${points[0].date} to ${points.at(-1).date}`}><line x1="0" y1={height - 1} x2={width} y2={height - 1} stroke="#1e293b" />{paths.map(path => <polyline key={path.field} fill="none" stroke={path.color} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" points={path.coordinates} />)}</svg><div className="flex justify-between text-[10px] text-slate-700"><span>{points[0].date}</span><span>{points.at(-1).date}</span></div></div>
}

function Field({ label, hint, children }) {
  return <label className="block text-xs font-semibold uppercase tracking-[0.12em] text-slate-400">{label}{hint && <span className="ml-2 font-normal normal-case tracking-normal text-slate-600">{hint}</span>}<div className="mt-2 normal-case tracking-normal">{children}</div></label>
}
