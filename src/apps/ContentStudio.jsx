import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'

import DepartmentChat from '../components/DepartmentChat.jsx'
import ContentRequestPanel from '../components/ContentRequestPanel.jsx'
import GeneralContentRequestsPanel from '../components/GeneralContentRequestsPanel.jsx'
import ContentQueuePanel from '../components/ContentQueuePanel.jsx'
import ArtifactRelationsPanel from '../components/ArtifactRelationsPanel.jsx'
import ArtifactApprovalPanel from '../components/ArtifactApprovalPanel.jsx'
import ContentCustomFieldsPanel from '../components/ContentCustomFieldsPanel.jsx'
import VersionProofingPanel from '../components/VersionProofingPanel.jsx'
import {
  BRAND_STATEMENT_SOURCE_TYPES,
  BRAND_STATEMENT_TYPE,
  brandBriefEditor,
  brandStatementEditor,
  serializeBrandBrief,
  serializeBrandStatement,
} from '../data/brandBrief.js'
import {
  CONTENT_ARTIFACT_FORMS,
  CONTENT_ARTIFACT_TYPES,
  approvalForVersion,
  bestContentStage,
  buildContentPageTracking,
  contentArtifactEditor,
  latestVersion,
  newContentRecord,
  serializeContentArtifact,
} from '../data/contentStudio.js'
import { contentStudio } from '../data/contentStudioRepository.js'
import { blogLinksForMonth, relatedRecord } from '../data/contentDesignEventLinking.js'

const INPUT = 'w-full rounded-xl border border-slate-700 bg-slate-950 px-3.5 py-2.5 text-sm text-white outline-none focus:border-amber-500 focus:ring-2 focus:ring-amber-500/20'
const BUTTON = 'rounded-xl border border-slate-700 px-4 py-2 text-sm font-semibold text-slate-200 transition hover:border-amber-500 hover:text-white disabled:cursor-not-allowed disabled:opacity-50'
const PRIMARY = 'rounded-xl bg-amber-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-amber-500 disabled:cursor-not-allowed disabled:opacity-50'

export default function ContentStudio() {
  const [searchParams, setSearchParams] = useSearchParams()
  const requestedBrandId = searchParams.get('brand') || ''
  const requestedEngagementId = searchParams.get('engagement') || ''
  const originLinkId = searchParams.get('eventLink') || ''
  const [engagements, setEngagements] = useState([])
  const [engagementId, setEngagementId] = useState('')
  const [workspace, setWorkspace] = useState(null)
  const [type, setType] = useState('discovery')
  const requestedTab = searchParams.get('tab') || ''
  const [tab, setTab] = useState(['general', 'queue', 'calendar'].includes(requestedTab) ? requestedTab : 'artifacts')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

  async function loadWorkspace(id) {
    if (!id) { setWorkspace(null); setLoading(false); return }
    setLoading(true); setError('')
    try { setWorkspace(await contentStudio.load(id)) }
    catch (reason) { setError(reason.message) }
    finally { setLoading(false) }
  }

  useEffect(() => {
    let active = true
    contentStudio.listEngagements().then(rows => {
      if (!active) return
      setEngagements(rows || [])
      const requested = rows?.find(item => item.id === requestedEngagementId)
        || rows?.find(item => item.brand_id === requestedBrandId)
      const first = requested?.id || rows?.[0]?.id || ''
      setEngagementId(first)
      if (first) loadWorkspace(first)
      else setLoading(false)
    }).catch(reason => { if (active) { setError(reason.message); setLoading(false) } })
    return () => { active = false }
  }, [])

  async function act(callback, success) {
    setSaving(true); setError(''); setMessage('')
    try {
      const result = await callback()
      setMessage(typeof success === 'function' ? success(result) : success)
      await loadWorkspace(engagementId)
      return result
    } catch (reason) {
      setError(reason.message)
      return null
    } finally { setSaving(false) }
  }

  const artifactForType = artifactType => workspace?.artifacts.find(item => item.artifact_type === artifactType) || null

  useEffect(() => {
    const originLink = workspace?.blogEventLinks?.find(link => link.id === originLinkId)
    if (!originLink || originLink.status !== 'in_progress') return
    const contentArtifact = workspace.artifacts.find(item => item.artifact_type === 'content')
    const currentVersion = latestVersion(workspace.versions.filter(version => version.artifact_id === contentArtifact?.id))
    if (!approvalForVersion(workspace.approvals, currentVersion?.id)) return
    let active = true
    contentStudio.updateBlogEventLink(originLink, 'ready')
      .then(() => { if (active) setWorkspace(current => ({ ...current, blogEventLinks: current.blogEventLinks.map(link => link.id === originLink.id ? { ...link, status: 'ready' } : link) })) })
      .catch(reason => { if (active) setError(reason.message) })
    return () => { active = false }
  }, [workspace, originLinkId])

  async function updateBlogLink(link, status, success) {
    await act(() => contentStudio.updateBlogEventLink(link, status), success)
  }

  async function openBlogDraft(link) {
    await updateBlogLink(link, 'in_progress', 'Blog draft started from the shared event plan.')
    const nextParams = new URLSearchParams(searchParams)
    nextParams.set('brand', workspace.engagement.brand_id)
    nextParams.set('eventLink', link.id)
    nextParams.set('tab', 'artifacts')
    setSearchParams(nextParams, { replace: true })
    setType('content')
    setTab('artifacts')
  }

  function selectTab(nextTab) {
    setTab(nextTab)
    const nextParams = new URLSearchParams(searchParams)
    if (nextTab === 'artifacts') nextParams.delete('tab')
    else nextParams.set('tab', nextTab)
    setSearchParams(nextParams, { replace: true })
  }

  return <div className="h-full overflow-y-auto bg-slate-950 text-white">
    <header className="border-b border-slate-800 bg-[radial-gradient(circle_at_top_left,rgba(245,158,11,0.12),transparent_36%)] px-6 py-6">
      <div className="mx-auto flex max-w-7xl flex-wrap items-end justify-between gap-5">
        <div><p className="text-xs font-semibold uppercase tracking-[0.16em] text-amber-400">Content department</p><h1 className="mt-1 text-3xl font-semibold tracking-tight">Content Studio</h1><p className="mt-2 max-w-3xl text-sm leading-6 text-slate-400">Build the approved context and structured content system that Design, Development, and Marketing consume.</p></div>
        <div className="flex flex-wrap gap-3"><button type="button" onClick={() => selectTab('general')} className={PRIMARY}>Make a post / reel</button><Link to="/sphere/content" className={BUTTON}>Open Content work queue</Link></div>
      </div>
    </header>
    <main className="mx-auto max-w-7xl space-y-6 px-6 py-6">
      {(error || message) && <div className={`rounded-xl border px-4 py-3 text-sm ${error ? 'border-red-900/60 bg-red-950/40 text-red-300' : 'border-emerald-900/60 bg-emerald-950/30 text-emerald-300'}`}>{error || message}</div>}
      {!['general', 'queue'].includes(tab) && <section className="flex flex-wrap items-end gap-4 rounded-2xl border border-slate-800 bg-slate-900/70 p-5">
        <label className="min-w-72 flex-1 text-xs font-semibold uppercase tracking-[0.12em] text-slate-400">Content engagement
          <select value={engagementId} onChange={event => { setEngagementId(event.target.value); loadWorkspace(event.target.value) }} className={`${INPUT} mt-2 normal-case tracking-normal`}>
            {engagements.map(item => <option key={item.id} value={item.id}>{item.name} · {item.brands?.name || 'Brand'}</option>)}
          </select>
        </label>
        {workspace?.engagement && <div className="rounded-xl bg-slate-950 px-4 py-3 text-sm text-slate-400"><span className="font-semibold text-white">{workspace.engagement.brands?.name}</span><span className="mx-2 text-slate-700">/</span>{workspace.engagement.agency_clients?.name}</div>}
      </section>}
      <nav className="flex gap-2 overflow-x-auto border-b border-slate-800">
        {[['general', 'General requests'], ['queue', 'Content queue'], ['artifacts', 'Artifact workspace'], ['requests', 'Content requests'], ['calendar', 'Blog calendar'], ['brand', 'Brief & brand statement'], ['chat', 'Shared Department Chat']].map(([id, label]) => <button type="button" key={id} onClick={() => selectTab(id)} className={`border-b-2 px-4 py-3 text-sm font-semibold ${tab === id ? 'border-amber-400 text-amber-300' : 'border-transparent text-slate-500 hover:text-white'}`}>{label}</button>)}
      </nav>
      {tab === 'general' ? <GeneralContentRequestsPanel /> : loading ? <div className="py-20 text-center text-sm text-slate-500">Loading Content Studio…</div> : tab === 'queue' ? <ContentQueuePanel /> : !workspace ? <div className="rounded-2xl border border-dashed border-slate-700 px-6 py-16 text-center text-sm text-slate-500">Activate a Content service on an engagement to begin, or use General requests without an engagement.</div> : tab === 'artifacts' ? (
        <ArtifactWorkspace workspace={workspace} type={type} setType={setType} saving={saving} act={act} onRefresh={() => loadWorkspace(engagementId)} originLinkId={originLinkId} />
      ) : tab === 'calendar' ? (
        <BlogCalendarPanel workspace={workspace} saving={saving} originLinkId={originLinkId} onStart={openBlogDraft} onPublish={link => updateBlogLink(link, 'published', 'Approved blog content marked as published.')} />
      ) : tab === 'requests' ? (
        <ContentRequestPanel engagement={workspace.engagement} />
      ) : tab === 'brand' ? (
        <BrandBriefWorkspace workspace={workspace} saving={saving} act={act} onRefresh={() => loadWorkspace(engagementId)} />
      ) : <DepartmentChat departmentId="content" engagement={workspace.engagement} artifactTypes={CONTENT_ARTIFACT_TYPES} artifactDefinitions={CONTENT_ARTIFACT_FORMS} artifactForType={artifactForType} stageForType={artifactType => bestContentStage(workspace.stages, artifactType)} onPropose={contentStudio.proposeArtifact} onCreated={() => loadWorkspace(engagementId)} />}
    </main>
  </div>
}

function BrandBriefWorkspace({ workspace, saving, act, onRefresh }) {
  const [brief, setBrief] = useState(brandBriefEditor(workspace.brandBrief))
  const artifact = workspace.artifacts.find(item => item.artifact_type === BRAND_STATEMENT_TYPE)
  const versions = workspace.versions.filter(item => item.artifact_id === artifact?.id)
  const latest = latestVersion(versions)
  const approval = approvalForVersion(workspace.approvals, latest?.id)

  async function saveBrief(event) {
    event.preventDefault()
    await act(() => contentStudio.saveBrandBrief({ engagement_id: workspace.engagement.id, ...serializeBrandBrief(brief) }), 'Brand brief updated in place.')
  }

  async function generateStatement() {
    await act(() => contentStudio.generateBrandStatement({
      engagement_id: workspace.engagement.id,
      engagement_stage_instance_id: bestContentStage(workspace.stages, BRAND_STATEMENT_TYPE)?.id || null,
    }), 'Brand statement compiled as a new immutable version.')
  }

  const approvedSources = Object.fromEntries(BRAND_STATEMENT_SOURCE_TYPES.map(sourceType => {
    const sourceIds = workspace.brandSourceArtifacts.filter(item => item.artifact_type === sourceType).map(item => item.id)
    return [sourceType, workspace.brandSourceApprovals.find(item => sourceIds.includes(item.artifact_id)) || null]
  }))
  const ready = Boolean(workspace.brandBrief) && BRAND_STATEMENT_SOURCE_TYPES.every(sourceType => approvedSources[sourceType])

  return <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
    <form onSubmit={saveBrief} className="rounded-2xl border border-slate-800 bg-slate-900/70 p-6">
      <div><p className="text-xs font-semibold uppercase tracking-[0.14em] text-amber-400">Mutable brand record</p><h2 className="mt-1 text-2xl font-semibold">Brand brief</h2><p className="mt-2 text-sm leading-6 text-slate-400">Maintain the current commercial and operating context for this brand. Saving updates this one record in place.</p></div>
      <div className="mt-6 space-y-5">
        <label className="block text-xs font-semibold uppercase tracking-[0.12em] text-slate-400">Target market<textarea rows="4" className={`${INPUT} mt-2 normal-case tracking-normal`} value={brief.target_market} onChange={event => setBrief(current => ({ ...current, target_market: event.target.value }))} /></label>
        <label className="block text-xs font-semibold uppercase tracking-[0.12em] text-slate-400">Price tier<select className={`${INPUT} mt-2 normal-case tracking-normal`} value={brief.price_tier} onChange={event => setBrief(current => ({ ...current, price_tier: event.target.value }))}><option value="">Not specified</option><option value="value">Value</option><option value="mid">Mid-market</option><option value="premium">Premium</option></select></label>
        <ListField label="Operating principles" value={brief.operating_principles} onChange={value => setBrief(current => ({ ...current, operating_principles: value }))} />
        <ListField label="Competitor references" value={brief.competitor_references} onChange={value => setBrief(current => ({ ...current, competitor_references: value }))} />
        <label className="block text-xs font-semibold uppercase tracking-[0.12em] text-slate-400">Raw brief<textarea required rows="10" className={`${INPUT} mt-2 normal-case tracking-normal`} value={brief.raw_brief} onChange={event => setBrief(current => ({ ...current, raw_brief: event.target.value }))} /></label>
      </div>
      <div className="mt-6 flex items-center justify-between gap-4 border-t border-slate-800 pt-5"><p className="text-xs text-slate-500">{workspace.brandBrief ? `Last updated ${new Date(workspace.brandBrief.updated_at).toLocaleString()}` : 'No brand brief saved yet'}</p><button disabled={saving} className={PRIMARY}>{saving ? 'Saving…' : workspace.brandBrief ? 'Update brief' : 'Save brief'}</button></div>
    </form>
    <section className="space-y-6">
      <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-6">
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-amber-400">Approved source context</p><h2 className="mt-1 text-2xl font-semibold">Compile brand statement</h2><p className="mt-2 text-sm leading-6 text-slate-400">Compilation uses the current saved brief and the latest approved Discovery, Vision, and Audience versions for this brand.</p>
        <div className="mt-5 grid gap-3 sm:grid-cols-3">{BRAND_STATEMENT_SOURCE_TYPES.map(sourceType => <div key={sourceType} className="rounded-xl border border-slate-800 bg-slate-950/60 p-3"><p className="text-xs font-semibold capitalize text-white">{sourceType}</p><p className={`mt-1 text-[11px] ${approvedSources[sourceType] ? 'text-emerald-400' : 'text-amber-400'}`}>{approvedSources[sourceType] ? 'Approved version ready' : 'Approval required'}</p></div>)}</div>
        <button type="button" disabled={saving || !ready} onClick={generateStatement} className={`${PRIMARY} mt-5 w-full`}>{saving ? 'Compiling…' : latest ? 'Compile new statement version' : 'Compile brand statement'}</button>
        {!workspace.brandBrief && <p className="mt-3 text-xs text-amber-300">Save the brand brief first.</p>}
      </div>
      {latest ? <BrandStatementReview key={latest.id} workspace={workspace} artifact={artifact} versions={versions} latest={latest} approval={approval} saving={saving} act={act} onRefresh={onRefresh} /> : <div className="rounded-2xl border border-dashed border-slate-700 p-8 text-center text-sm text-slate-500">No compiled brand statement yet.</div>}
    </section>
  </div>
}

function BrandStatementReview({ workspace, artifact, versions, latest, approval, saving, act, onRefresh }) {
  const [form, setForm] = useState(brandStatementEditor(latest.content))
  const [summary, setSummary] = useState(`Reviewed from version ${latest.version_number}`)

  async function save(event) {
    event.preventDefault()
    await act(() => contentStudio.saveArtifact({
      engagement_id: workspace.engagement.id, artifact_id: artifact.id,
      engagement_stage_instance_id: bestContentStage(workspace.stages, BRAND_STATEMENT_TYPE)?.id || null,
      artifact_type: BRAND_STATEMENT_TYPE, title: artifact.title || 'Brand statement',
      content: serializeBrandStatement(form, latest.content.source_manifest), change_summary: summary,
      data_classification: latest.data_classification || 'internal', ai_use_allowed: latest.ai_use_allowed === true,
    }), 'Brand statement review saved as a new immutable version.')
  }

  return <div><form onSubmit={save} className="rounded-2xl border border-slate-800 bg-slate-900/70 p-6">
    <div className="flex items-start justify-between gap-4"><div><p className="text-xs font-semibold uppercase tracking-[0.14em] text-amber-400">Canonical immutable artifact</p><h3 className="mt-1 text-xl font-semibold">Brand statement review</h3></div><div className="text-right text-xs text-slate-500"><p>Version {latest.version_number}</p><p className={approval ? 'mt-1 text-emerald-400' : 'mt-1 text-amber-400'}>{approval ? 'Exact version approved' : 'Approval pending'}</p></div></div>
    <div className="mt-6 space-y-5">
      <TextField label="Brand statement" value={form.statement} onChange={value => setForm(current => ({ ...current, statement: value }))} />
      <TextField label="Target market" value={form.target_market} onChange={value => setForm(current => ({ ...current, target_market: value }))} />
      <label className="block text-xs font-semibold uppercase tracking-[0.12em] text-slate-400">Price tier<select className={`${INPUT} mt-2 normal-case tracking-normal`} value={form.price_tier} onChange={event => setForm(current => ({ ...current, price_tier: event.target.value }))}><option value="">Not specified</option><option value="value">Value</option><option value="mid">Mid-market</option><option value="premium">Premium</option></select></label>
      <TextField label="Positioning" value={form.positioning} onChange={value => setForm(current => ({ ...current, positioning: value }))} />
      <TextField label="Value proposition" value={form.value_proposition} onChange={value => setForm(current => ({ ...current, value_proposition: value }))} />
      <TextField label="Audience summary" value={form.audience_summary} onChange={value => setForm(current => ({ ...current, audience_summary: value }))} />
      <ListField label="Operating principles" value={form.operating_principles} onChange={value => setForm(current => ({ ...current, operating_principles: value }))} />
      <ListField label="Proof points" value={form.proof_points} onChange={value => setForm(current => ({ ...current, proof_points: value }))} />
      <ListField label="Competitor references" value={form.competitor_references} onChange={value => setForm(current => ({ ...current, competitor_references: value }))} />
      <label className="block text-xs font-semibold uppercase tracking-[0.12em] text-slate-400">Change summary<input required className={`${INPUT} mt-2 normal-case tracking-normal`} value={summary} onChange={event => setSummary(event.target.value)} /></label>
    </div>
    <div className="mt-6 flex justify-end border-t border-slate-800 pt-5"><button disabled={saving} className={PRIMARY}>{saving ? 'Saving…' : 'Save reviewed version'}</button></div>
  </form><ArtifactApprovalPanel version={latest} approval={approval} theme="amber" onSingleApprove={() => act(() => contentStudio.approveArtifact(latest.id), 'Brand statement exact version approved.')} onChanged={onRefresh} /><ArtifactRelationsPanel artifact={artifact} /><VersionProofingPanel targetKind="artifact" versions={versions} initialVersionId={latest.id} department="content" theme="amber" /></div>
}

function TextField({ label, value, onChange }) {
  return <label className="block text-xs font-semibold uppercase tracking-[0.12em] text-slate-400">{label}<textarea required rows="4" className={`${INPUT} mt-2 normal-case tracking-normal`} value={value || ''} onChange={event => onChange(event.target.value)} /></label>
}

function ListField({ label, value, onChange }) {
  return <label className="block text-xs font-semibold uppercase tracking-[0.12em] text-slate-400">{label}<span className="ml-2 font-normal normal-case tracking-normal text-slate-600">One item per line</span><textarea rows="4" className={`${INPUT} mt-2 normal-case tracking-normal`} value={value || ''} onChange={event => onChange(event.target.value)} /></label>
}

function BlogCalendarPanel({ workspace, saving, originLinkId, onStart, onPublish }) {
  const originLink = workspace.blogEventLinks?.find(link => link.id === originLinkId)
  const initialMonth = relatedRecord(originLink?.external_events)?.start_date?.slice(0, 7) || new Date().toISOString().slice(0, 7)
  const [month, setMonth] = useState(initialMonth)
  const links = useMemo(() => blogLinksForMonth(workspace.blogEventLinks, month), [workspace.blogEventLinks, month])
  return <section className="rounded-2xl border border-slate-800 bg-slate-900/70 p-6"><div className="flex flex-wrap items-end justify-between gap-4"><div><p className="text-xs font-semibold uppercase tracking-[0.14em] text-amber-400">Shared MK1 event infrastructure</p><h2 className="mt-1 text-2xl font-semibold">Blog calendar</h2><p className="mt-2 max-w-2xl text-sm leading-6 text-slate-400">This is a filtered Content view over existing event links. It does not maintain a separate blog-calendar table.</p></div><input aria-label="Blog calendar month" type="month" className={`${INPUT} max-w-52`} value={month} onChange={event => setMonth(event.target.value)} /></div><div className="mt-6 grid gap-4 lg:grid-cols-2">{links.map(link => { const externalEvent = relatedRecord(link.external_events); const active = link.id === originLinkId; return <article key={link.id} className={`rounded-2xl border p-4 ${active ? 'border-amber-500/60 bg-amber-950/20' : 'border-slate-800 bg-slate-950/50'}`}><div className="flex items-start justify-between gap-3"><div><p className="text-xs font-semibold uppercase tracking-[0.12em] text-amber-400">{externalEvent?.start_date || 'Date unavailable'}</p><h3 className="mt-1 font-semibold text-white">{externalEvent?.event_name || 'External event'}</h3></div><span className="rounded-full bg-slate-900 px-2.5 py-1 text-[10px] font-semibold uppercase text-slate-300">{link.status.replaceAll('_', ' ')}</span></div><p className="mt-3 text-xs text-slate-500">Lead time {link.lead_time_days} days · {externalEvent?.event_category?.replaceAll('_', ' ') || 'event'}</p><div className="mt-4 flex flex-wrap gap-2">{link.status !== 'published' && <button type="button" disabled={saving} onClick={() => onStart(link)} className={PRIMARY}>{link.status === 'planned' ? 'Start blog draft' : 'Open blog draft'}</button>}{link.status === 'ready' && <button type="button" disabled={saving} onClick={() => onPublish(link)} className={BUTTON}>Mark released / published</button>}</div>{active && <p className="mt-3 text-xs text-amber-300">This event is the active origin for the Content artifact workflow.</p>}</article> })}{!links.length && <div className="rounded-2xl border border-dashed border-slate-700 p-8 text-center text-sm text-slate-500 lg:col-span-2">No blog event links in this month. Add one from Sphere Events.</div>}</div></section>
}

function ArtifactWorkspace({ workspace, type, setType, saving, act, onRefresh, originLinkId }) {
  const artifact = workspace.artifacts.find(item => item.artifact_type === type)
  const versions = workspace.versions.filter(item => item.artifact_id === artifact?.id)
  const latest = latestVersion(versions)
  const approval = approvalForVersion(workspace.approvals, latest?.id)
  return <div className="grid gap-6 xl:grid-cols-[320px_1fr]">
    <section className="space-y-3">{Object.entries(CONTENT_ARTIFACT_FORMS).map(([id, definition]) => {
      const item = workspace.artifacts.find(candidate => candidate.artifact_type === id)
      const itemLatest = latestVersion(workspace.versions.filter(version => version.artifact_id === item?.id))
      const itemApproval = approvalForVersion(workspace.approvals, itemLatest?.id)
      return <button key={id} onClick={() => setType(id)} className={`w-full rounded-2xl border p-4 text-left ${type === id ? 'border-amber-500/60 bg-amber-950/20' : 'border-slate-800 bg-slate-900/70 hover:border-slate-700'}`}><div className="flex items-start justify-between gap-3"><p className="font-semibold text-white">{definition.label}</p><span className={`rounded-full px-2.5 py-1 text-[10px] uppercase ${itemApproval ? 'bg-emerald-950 text-emerald-300' : itemLatest ? 'bg-amber-950 text-amber-300' : 'bg-slate-950 text-slate-500'}`}>{itemApproval ? 'Approved' : itemLatest ? 'Draft' : 'Missing'}</span></div><p className="mt-2 text-xs leading-5 text-slate-500">{definition.description}</p></button>
    })}</section>
    <ArtifactForm key={`${type}:${latest?.id || 'new'}`} workspace={workspace} type={type} artifact={artifact} versions={versions} latest={latest} approval={approval} saving={saving} act={act} onRefresh={onRefresh} originLinkId={originLinkId} />
  </div>
}

function ArtifactForm({ workspace, type, artifact, versions, latest, approval, saving, act, onRefresh, originLinkId }) {
  const definition = CONTENT_ARTIFACT_FORMS[type]
  const [form, setForm] = useState(contentArtifactEditor(type, latest?.content))
  const [summary, setSummary] = useState(latest ? `Revision from version ${latest.version_number}` : 'Initial Content Studio version')
  const [classification, setClassification] = useState(latest?.data_classification || 'internal')
  const [aiSafe, setAiSafe] = useState(latest?.ai_use_allowed || false)
  const originLink = type === 'content' ? workspace.blogEventLinks?.find(link => link.id === originLinkId) : null

  async function save(event) {
    event.preventDefault()
    await act(async () => {
      const result = await contentStudio.saveArtifact({
      engagement_id: workspace.engagement.id, artifact_id: artifact?.id || null,
      engagement_stage_instance_id: bestContentStage(workspace.stages, type)?.id || null,
      artifact_type: type, title: artifact?.title || `${definition.label} artifact`,
      content: serializeContentArtifact(type, form), change_summary: summary,
      data_classification: classification, ai_use_allowed: aiSafe,
      })
      if (originLink) await contentStudio.updateBlogEventLink(originLink, 'in_progress')
      return result
    }, result => {
      const warning = result?.warnings?.[0]
      return warning ? `${definition.label} saved as a new immutable version. ${warning}` : `${definition.label} saved as a new immutable version.`
    })
  }

  const regionsByVersion = type === 'website_architecture' ? Object.fromEntries(versions.map(version => [
    version.id,
    (version.content?.pages || []).map(page => ({
      value: `page:${page.slug}`,
      label: `${page.title}${page.slug ? ` (${page.slug})` : ''}`,
    })),
  ])) : {}

  return <div><form onSubmit={save} className="rounded-2xl border border-slate-800 bg-slate-900/70 p-6">
    <div className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-xs font-semibold uppercase tracking-[0.14em] text-amber-400">Canonical immutable artifact</p><h2 className="mt-1 text-2xl font-semibold">{definition.label}</h2><p className="mt-2 max-w-2xl text-sm leading-6 text-slate-400">{definition.description}</p></div><div className="text-right text-xs text-slate-500"><p>{latest ? `Version ${latest.version_number}` : 'No version yet'}</p><p className={approval ? 'mt-1 text-emerald-400' : 'mt-1 text-amber-400'}>{approval ? 'Exact version approved' : 'Approval pending'}</p></div></div>
    <div className="mt-6 space-y-5">{definition.fields.map(field => <ArtifactField key={field.key} field={field} value={form[field.key]} pageSlugs={(workspace.versions.filter(version => version.artifact_id === workspace.artifacts.find(item => item.artifact_type === 'website_architecture')?.id).sort((left, right) => right.version_number - left.version_number)[0]?.content?.pages || []).map(page => page.slug)} onChange={value => setForm(current => ({ ...current, [field.key]: value }))} />)}</div>
    <div className="mt-6 grid gap-4 md:grid-cols-2"><label className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-400">Change summary<input required className={`${INPUT} mt-2 normal-case tracking-normal`} value={summary} onChange={event => setSummary(event.target.value)} /></label><label className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-400">Data classification<select className={`${INPUT} mt-2 normal-case tracking-normal`} value={classification} onChange={event => setClassification(event.target.value)}><option>internal</option><option>confidential</option><option>public</option><option>restricted</option></select></label></div>
    <label className="mt-4 flex items-start gap-3 rounded-xl border border-slate-800 bg-slate-950/60 p-4 text-sm text-slate-300"><input type="checkbox" className="mt-1" checked={aiSafe} onChange={event => setAiSafe(event.target.checked)} /><span>Explicitly allow this exact version to be included in approved AI context. Restricted versions remain excluded.</span></label>
    <div className="mt-6 flex flex-wrap justify-end gap-3 border-t border-slate-800 pt-5"><button disabled={saving} className={PRIMARY}>{saving ? 'Saving…' : latest ? 'Create new version' : 'Save first version'}</button></div>
  </form><ArtifactApprovalPanel version={latest} approval={approval} theme="amber" onSingleApprove={() => act(async () => { const result = await contentStudio.approveArtifact(latest.id); if (originLink) await contentStudio.updateBlogEventLink(originLink, 'ready'); return result }, `${definition.label} exact version approved.${originLink ? ' The originating blog event is ready.' : ''}`)} onChanged={onRefresh} />{['website_architecture', 'content'].includes(type) && <ContentPageTrackingPanel workspace={workspace} saving={saving} act={act} />}<ContentCustomFieldsPanel artifactType={type} versions={versions} initialVersionId={latest?.id} /><ArtifactRelationsPanel artifact={artifact} /><VersionProofingPanel targetKind="artifact" versions={versions} initialVersionId={latest?.id} department="content" theme="amber" regionsByVersion={regionsByVersion} /></div>
}

function ContentPageTrackingPanel({ workspace, saving, act }) {
  const tracking = buildContentPageTracking(workspace)
  const generated = workspace.contentTasks || []
  async function generate() {
    await act(
      () => contentStudio.generateContentTasks(workspace.engagement.id),
      'Content tasks generated from the approved sitemap.',
    )
  }
  return <section className="mt-6 rounded-2xl border border-slate-800 bg-slate-900/70 p-6">
    <div className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-xs font-semibold uppercase tracking-[0.14em] text-amber-400">Content-per-page tracking</p><h3 className="mt-1 text-xl font-semibold">Website content status</h3><p className="mt-2 max-w-2xl text-sm leading-6 text-slate-400">One explicit task per page, linked to the canonical Content artifact and its approved page slug. Later sitemap changes are flagged for manual reconciliation.</p></div><div className="flex flex-wrap gap-2"><Link to="/sphere/engagements" className={BUTTON}>Open Work board</Link>{!generated.length && <button type="button" disabled={saving || !tracking.canGenerate} onClick={generate} className={PRIMARY}>{saving ? 'Generating…' : 'Generate content tasks from sitemap'}</button>}</div></div>
    {!tracking.approvedArchitecture && <p className="mt-5 rounded-xl border border-amber-900/60 bg-amber-950/30 p-4 text-sm text-amber-200">Approve an exact Website architecture version before generating content tasks.</p>}
    {tracking.hasMismatch && generated.length > 0 && <p className="mt-5 rounded-xl border border-amber-900/60 bg-amber-950/30 p-4 text-sm text-amber-200">The current page list and generated tasks no longer match. Reconcile the differences manually; Anka OS has not created or removed tasks automatically.</p>}
    {tracking.rows.length > 0 ? <div className="mt-5 overflow-x-auto rounded-xl border border-slate-800"><table className="w-full min-w-[620px] text-left text-sm"><thead className="bg-slate-950/70 text-[10px] uppercase tracking-[0.12em] text-slate-500"><tr><th className="px-4 py-3">Page</th><th className="px-4 py-3">Page slug</th><th className="px-4 py-3">Status</th></tr></thead><tbody>{tracking.rows.map(row => <tr key={row.pagePath} className="border-t border-slate-800"><td className="px-4 py-3 font-medium text-white">{row.pageTitle}</td><td className="px-4 py-3 font-mono text-xs text-slate-400">{row.pagePath}</td><td className="px-4 py-3"><span className={`rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase ${row.task?.status === 'done' ? 'bg-emerald-950 text-emerald-300' : row.task?.status === 'blocked' ? 'bg-red-950 text-red-300' : row.task ? 'bg-blue-950 text-blue-300' : 'bg-amber-950 text-amber-300'}`}>{row.task?.status?.replaceAll('_', ' ') || 'Task missing'}</span></td></tr>)}</tbody></table></div> : <p className="mt-5 rounded-xl border border-dashed border-slate-700 p-6 text-center text-sm text-slate-500">Add pages to the approved Website architecture to begin tracking.</p>}
    {tracking.staleTasks.length > 0 && <div className="mt-4"><p className="text-xs font-semibold uppercase tracking-[0.12em] text-amber-400">Tasks for removed or renamed pages</p><div className="mt-2 flex flex-wrap gap-2">{tracking.staleTasks.map(task => <span key={task.id} className="rounded-full bg-amber-950 px-3 py-1 text-xs text-amber-200">{task.linked_page_path} · {task.status.replaceAll('_', ' ')}</span>)}</div></div>}
    <p className="mt-4 text-xs text-slate-600">Page source: {tracking.source === 'content' ? 'latest Content draft' : 'approved Website architecture'} · {generated.length} generated task{generated.length === 1 ? '' : 's'}</p>
  </section>
}

function ArtifactField({ field, value, pageSlugs, onChange }) {
  if (field.kind === 'records') return <div><div className="flex items-center justify-between gap-3"><p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-400">{field.label}</p><button type="button" className={BUTTON} onClick={() => onChange([...(value || []), newContentRecord(field)])}>{field.addLabel}</button></div><div className="mt-3 space-y-4">{(value || []).map((record, index) => <RecordEditor key={index} index={index} field={field} records={value} pageSlugs={pageSlugs} record={record} onChange={next => onChange(value.map((item, itemIndex) => itemIndex === index ? next : item))} onRemove={() => onChange(value.filter((_, itemIndex) => itemIndex !== index))} />)}{!(value || []).length && <div className="rounded-xl border border-dashed border-slate-700 p-6 text-center text-sm text-slate-500">Add at least one structured record.</div>}</div></div>
  const textarea = field.kind === 'textarea' || field.kind === 'list'
  return <label className="block text-xs font-semibold uppercase tracking-[0.12em] text-slate-400">{field.label}{field.kind === 'list' && <span className="ml-2 font-normal normal-case tracking-normal text-slate-600">One item per line</span>}{textarea ? <textarea required rows={field.kind === 'list' ? 4 : 5} className={`${INPUT} mt-2 normal-case tracking-normal`} value={value || ''} onChange={event => onChange(event.target.value)} /> : <input required className={`${INPUT} mt-2 normal-case tracking-normal`} value={value || ''} onChange={event => onChange(event.target.value)} />}</label>
}

function RecordEditor({ index, field, records, pageSlugs, record, onChange, onRemove }) {
  return <div className="rounded-2xl border border-slate-800 bg-slate-950/50 p-4"><div className="mb-4 flex items-center justify-between"><p className="text-xs font-semibold uppercase tracking-[0.12em] text-amber-400">{field.label} {index + 1}</p><button type="button" onClick={onRemove} className="text-xs font-semibold text-red-300">Remove</button></div><div className="grid gap-4 md:grid-cols-2">{field.recordFields.map(([key, label, kind, options]) => {
    const wide = kind === 'textarea' || kind === 'textarea_optional' || kind === 'list'
    const required = kind !== 'parent_slug' && kind !== 'textarea_optional'
    const choices = kind === 'parent_slug' ? records.map(item => item.slug).filter(slug => slug && slug !== record.slug) : kind === 'target_page_slug' ? pageSlugs : options
    return <label key={key} className={`text-xs font-semibold uppercase tracking-[0.12em] text-slate-500 ${wide ? 'md:col-span-2' : ''}`}>{label}{kind === 'list' && <span className="ml-2 font-normal normal-case tracking-normal">Comma separated</span>}{kind === 'textarea' || kind === 'textarea_optional' ? <textarea required={required} rows="4" className={`${INPUT} mt-2 normal-case tracking-normal`} value={record[key] || ''} onChange={event => onChange({ ...record, [key]: event.target.value })} /> : kind === 'select' || (choices || []).length ? <select required={required} className={`${INPUT} mt-2 normal-case tracking-normal`} value={record[key] || ''} onChange={event => onChange({ ...record, [key]: event.target.value })}><option value="">{required ? 'Select one' : 'No parent page'}</option>{(choices || []).map(choice => <option key={choice} value={choice}>{choice}</option>)}</select> : <input required={required} type={kind === 'number' ? 'number' : 'text'} min={kind === 'number' ? '0' : undefined} step={kind === 'number' ? '1' : undefined} className={`${INPUT} mt-2 normal-case tracking-normal`} value={Array.isArray(record[key]) ? record[key].join(', ') : record[key] || ''} onChange={event => onChange({ ...record, [key]: event.target.value })} />}</label>
  })}</div></div>
}
