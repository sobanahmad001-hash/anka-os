import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'

import {
  CAMPAIGN_STATUSES,
  MARKETING_ARTIFACT_FORMS,
  blankMarketingArtifact,
  defaultReportingPeriod,
  latestVersion,
  lines,
} from '../data/marketingStudio.js'
import { marketingStudio } from '../data/marketingStudioRepository.js'
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
  const [engagements, setEngagements] = useState([])
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
    marketingStudio.listEngagements().then(rows => {
      if (!active) return
      setEngagements(rows || [])
      const first = rows?.[0]?.id || ''
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
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-400">Plan campaigns, version accountable marketing artifacts, and inspect live read-only performance from engagement-approved Google connections.</p>
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
          {[['campaigns', 'Campaigns'], ['artifacts', 'Artifacts'], ['analytics', 'Live analytics']].map(([id, label]) => (
            <button key={id} onClick={() => setTab(id)} className={`border-b-2 px-4 py-3 text-sm font-semibold ${tab === id ? 'border-emerald-400 text-emerald-300' : 'border-transparent text-slate-500 hover:text-white'}`}>{label}</button>
          ))}
        </nav>

        {loading ? <div className="py-20 text-center text-sm text-slate-500">Loading Marketing Studio…</div> : !workspace ? (
          <div className="rounded-2xl border border-dashed border-slate-700 px-6 py-16 text-center text-sm text-slate-500">Select an engagement with a Marketing service to begin.</div>
        ) : tab === 'campaigns' ? (
          <Campaigns workspace={workspace} campaignId={campaignId} setCampaignId={setCampaignId} selected={selectedCampaign} saving={saving} act={act} />
        ) : tab === 'artifacts' ? (
          <Artifacts workspace={workspace} campaign={selectedCampaign} saving={saving} act={act} setTab={setTab} onRefresh={() => loadWorkspace(engagementId, campaignId)} />
        ) : (
          <Analytics engagementId={engagementId} />
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

function Analytics({ engagementId }) {
  const initial = useMemo(() => defaultReportingPeriod(), [])
  const [period, setPeriod] = useState(initial)
  const [dashboard, setDashboard] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  async function load() {
    setLoading(true); setError('')
    try { setDashboard(await marketingStudio.analytics(engagementId, period.start, period.end)) }
    catch (loadError) { setError(loadError.message) }
    finally { setLoading(false) }
  }
  return <section className="space-y-5"><div className="flex flex-wrap items-end gap-4 rounded-2xl border border-slate-800 bg-slate-900/70 p-5"><div className="mr-auto"><h2 className="font-semibold">Live read-only analytics</h2><p className="mt-1 max-w-2xl text-sm leading-6 text-slate-400">Queries only verified Google connections mapped to this engagement and Marketing. Nothing here can edit campaigns, properties, sites, or spend.</p></div><Field label="From"><input type="date" className={INPUT} value={period.start} onChange={event => setPeriod({ ...period, start: event.target.value })} /></Field><Field label="To"><input type="date" className={INPUT} value={period.end} onChange={event => setPeriod({ ...period, end: event.target.value })} /></Field><button onClick={load} disabled={loading} className={PRIMARY}>{loading ? 'Reading Google…' : 'Load live data'}</button></div>
    {error && <Notice error={error} />}
    {!dashboard ? <div className="rounded-2xl border border-dashed border-slate-700 px-6 py-16 text-center text-sm text-slate-500">No placeholder data is shown. Load the selected period to request real connector data.</div> : dashboard.reports.length === 0 ? <div className="rounded-2xl border border-amber-900/50 bg-amber-950/20 p-6 text-sm text-amber-200">No verified Google reporting connector is mapped to this engagement. Configure and map one in the Connector Centre.</div> : <div className="grid gap-5 xl:grid-cols-2">{dashboard.reports.map(report => <ReportCard key={report.connection_id} report={report} />)}</div>}
  </section>
}

function ReportCard({ report }) {
  return <article className="overflow-hidden rounded-2xl border border-slate-800 bg-slate-900/70"><div className="border-b border-slate-800 p-5"><p className="text-xs font-semibold uppercase tracking-[0.14em] text-emerald-400">{titleize(report.provider)}</p><h3 className="mt-1 font-semibold text-white">{report.connection_name}</h3></div>{report.error ? <p className="p-5 text-sm text-amber-300">{report.error}</p> : <><div className="grid grid-cols-2 gap-px bg-slate-800">{Object.entries(report.totals || {}).map(([key, value]) => <div key={key} className="bg-slate-900 p-4"><p className="text-[10px] uppercase tracking-[0.12em] text-slate-500">{titleize(key)}</p><p className="mt-1 text-xl font-semibold text-white">{typeof value === 'number' ? value.toLocaleString(undefined, { maximumFractionDigits: 2 }) : value}</p></div>)}</div><div className="max-h-64 overflow-auto p-4"><pre className="whitespace-pre-wrap text-xs leading-5 text-slate-500">{JSON.stringify((report.rows || []).slice(0, 12), null, 2)}</pre></div></>}</article>
}

function Field({ label, hint, children }) {
  return <label className="block text-xs font-semibold uppercase tracking-[0.12em] text-slate-400">{label}{hint && <span className="ml-2 font-normal normal-case tracking-normal text-slate-600">{hint}</span>}<div className="mt-2 normal-case tracking-normal">{children}</div></label>
}
