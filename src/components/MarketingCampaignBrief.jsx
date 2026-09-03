import { useEffect, useState } from 'react'

import { blankMarketingArtifact, latestVersion, selectedCampaignBriefSuggestions, validateCampaignBriefDraft } from '../data/marketingStudio.js'
import ArtifactApprovalPanel from './ArtifactApprovalPanel.jsx'
import ArtifactRelationsPanel from './ArtifactRelationsPanel.jsx'
import VersionProofingPanel from './VersionProofingPanel.jsx'

const INPUT = 'w-full rounded-xl border border-slate-700 bg-slate-950 px-3.5 py-2.5 text-sm text-white outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20'
const BUTTON = 'rounded-xl border border-slate-700 px-4 py-2 text-sm font-semibold text-slate-200 hover:border-emerald-500 disabled:opacity-50'
const PRIMARY = 'rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-50'
const LEADERS = new Set(['system_owner', 'operations_admin', 'executive'])
const eligibleMarketingApprover = approver => LEADERS.has(approver.role)
  || (approver.department_id === 'marketing' && approver.role === 'department_manager')

function editor(content = {}) {
  const value = { ...blankMarketingArtifact('campaign_brief'), ...content }
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, Array.isArray(item) ? item.join('\n') : item ?? '']))
}

function Field({ label, hint, children }) {
  return <label className="block text-xs font-semibold uppercase tracking-[0.12em] text-slate-400">{label}{hint && <span className="ml-2 font-normal normal-case tracking-normal text-slate-600">{hint}</span>}<div className="mt-2">{children}</div></label>
}

export default function MarketingCampaignBrief({ studio, workspace, campaign, saving, act, onRefresh, onDirtyChange, saveHandleRef }) {
  const link = workspace.links.find(item => item.campaign_id === campaign?.id && item.relation_type === 'campaign_brief')
  const artifact = workspace.artifacts.find(item => item.id === link?.artifact_id) || null
  const versions = workspace.versions.filter(item => item.artifact_id === artifact?.id)
  const latest = latestVersion(versions)
  const approval = workspace.approvals.find(item => item.artifact_version_id === latest?.id)
  const [title, setTitle] = useState(artifact?.title || `${campaign?.name || 'Campaign'} brief`)
  const [form, setForm] = useState(editor(latest?.content))
  const [changeSummary, setChangeSummary] = useState('')
  const [aiUseAllowed, setAiUseAllowed] = useState(false)
  const [suggestionPrompt, setSuggestionPrompt] = useState('')
  const [promptSafe, setPromptSafe] = useState(false)
  const [proposal, setProposal] = useState(null)
  const [selectedFields, setSelectedFields] = useState([])
  const [suggesting, setSuggesting] = useState(false)
  const [localError, setLocalError] = useState('')
  const baseline = JSON.stringify({ title: artifact?.title || `${campaign?.name || 'Campaign'} brief`, form: editor(latest?.content), changeSummary: '', aiUseAllowed: false })
  const dirty = JSON.stringify({ title, form, changeSummary, aiUseAllowed }) !== baseline

  useEffect(() => {
    setTitle(artifact?.title || `${campaign?.name || 'Campaign'} brief`)
    setForm(editor(latest?.content)); setChangeSummary(''); setAiUseAllowed(false); setProposal(null); setSelectedFields([]); setLocalError('')
  }, [artifact?.title, campaign?.name, latest?.content, latest?.id])
  useEffect(() => { onDirtyChange?.(dirty) }, [dirty, onDirtyChange])
  useEffect(() => {
    if (!dirty) return undefined
    const warn = event => { event.preventDefault(); event.returnValue = '' }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])

  async function saveDraft(event) {
    event?.preventDefault(); setLocalError('')
    try {
      if (!title.trim()) throw new Error('Brief title is required')
      const content = validateCampaignBriefDraft(form)
      const result = await act(() => studio.saveCampaignBrief({
        engagement_id: workspace.engagement.id, campaign_id: campaign.id,
        artifact_id: artifact?.id || null, expected_latest_version_id: latest?.id || null,
        title: title.trim(), content, change_summary: changeSummary.trim(), ai_use_allowed: aiUseAllowed,
        idempotency_key: crypto.randomUUID(),
      }), `Campaign brief version ${Number(latest?.version_number || 0) + 1} saved as an unapproved immutable draft.`, campaign.id)
      if (result) await onRefresh?.()
      return result
    } catch (reason) { setLocalError(reason.message); return null }
  }

  if (saveHandleRef) saveHandleRef.current = saveDraft
  if (!campaign) return <div className="rounded-2xl border border-dashed border-slate-700 px-6 py-16 text-center text-sm text-slate-500">Create or select a campaign before drafting its governed brief.</div>

  async function generateSuggestions(event) {
    event.preventDefault(); setSuggesting(true); setLocalError('')
    try {
      const result = await studio.proposeArtifact({
        engagement_id: workspace.engagement.id, artifact_id: artifact?.id || null,
        artifact_type: 'campaign_brief', title, change_summary: 'Campaign brief suggestions',
        prompt: suggestionPrompt, prompt_safe_for_ai: promptSafe,
      })
      setProposal(result); setSelectedFields(Object.keys(result?.preview?.content || {}))
    } catch (reason) { setLocalError(reason.message) }
    finally { setSuggesting(false) }
  }

  async function closeProposal(apply) {
    if (apply) setForm(editor(selectedCampaignBriefSuggestions(form, proposal.preview.content, selectedFields)))
    try { await studio.rejectProposal(proposal.proposal_id) } catch (reason) { setLocalError(reason.message); return }
    setProposal(null); setSelectedFields([])
  }

  const assetVersions = workspace.versions.filter(version => version.artifact_id !== artifact?.id)
  const selectedAssets = new Set(String(form.existing_asset_version_ids || '').split('\n').filter(Boolean))
  return <div className="grid gap-6 xl:grid-cols-[minmax(0,1.35fr)_minmax(330px,0.65fr)]">
    <form onSubmit={saveDraft} className="rounded-2xl border border-slate-800 bg-slate-900/70 p-6">
      <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs font-semibold uppercase tracking-[0.14em] text-emerald-400">Governed authoring</p><h2 className="mt-1 text-xl font-semibold">Campaign brief</h2><p className="mt-2 text-sm text-slate-400">Each save creates an immutable, unapproved version. Review and proofing remain separate.</p></div><span className="rounded-full border border-slate-700 px-3 py-1 text-xs text-slate-400">{latest ? `Version ${latest.version_number}` : 'Not saved'}</span></div>
      {localError && <p className="mt-4 rounded-xl border border-red-900/60 bg-red-950/40 px-3 py-2 text-sm text-red-300">{localError}</p>}
      <div className="mt-6 grid gap-4 md:grid-cols-2">
        <div className="md:col-span-2"><Field label="Brief title"><input required maxLength="240" className={INPUT} value={title} onChange={event => setTitle(event.target.value)} /></Field></div>
        <div className="md:col-span-2"><Field label="Campaign goal"><textarea required rows="4" className={INPUT} value={form.campaign_goal} onChange={event => setForm({ ...form, campaign_goal: event.target.value })} /></Field></div>
        <div className="md:col-span-2"><Field label="Channels" hint="One per line"><textarea required rows="3" className={INPUT} value={form.channels} onChange={event => setForm({ ...form, channels: event.target.value })} /></Field></div>
        <Field label="Market" hint="Optional; required only by scoped downstream research"><input className={INPUT} value={form.market} onChange={event => setForm({ ...form, market: event.target.value })} /></Field>
        <Field label="Audience" hint="Optional"><textarea className={INPUT} value={form.audience} onChange={event => setForm({ ...form, audience: event.target.value })} /></Field>
        <Field label="Offer" hint="Optional"><textarea className={INPUT} value={form.offer} onChange={event => setForm({ ...form, offer: event.target.value })} /></Field>
        <Field label="Key message" hint="Optional"><textarea className={INPUT} value={form.key_message} onChange={event => setForm({ ...form, key_message: event.target.value })} /></Field>
        <Field label="Starts on" hint="Organization-local date"><input type="date" className={INPUT} value={form.starts_on} onChange={event => setForm({ ...form, starts_on: event.target.value })} /></Field>
        <Field label="Ends on" hint="Organization-local date"><input type="date" className={INPUT} value={form.ends_on} onChange={event => setForm({ ...form, ends_on: event.target.value })} /></Field>
        <Field label="Measurement target"><input className={INPUT} value={form.measurement_target} onChange={event => setForm({ ...form, measurement_target: event.target.value })} /></Field>
        <Field label="Measurement value"><input type="number" step="any" className={INPUT} value={form.measurement_value} onChange={event => setForm({ ...form, measurement_value: event.target.value })} /></Field>
        <Field label="Measurement unit" hint="Required with a value"><input className={INPUT} value={form.measurement_unit} onChange={event => setForm({ ...form, measurement_unit: event.target.value })} /></Field>
        <Field label="Measurement evidence" hint="Leave absent when no benchmark exists"><textarea className={INPUT} value={form.measurement_evidence} onChange={event => setForm({ ...form, measurement_evidence: event.target.value })} /></Field>
        <div className="md:col-span-2"><Field label="Deliverables" hint="Optional; one per line"><textarea rows="3" className={INPUT} value={form.deliverables} onChange={event => setForm({ ...form, deliverables: event.target.value })} /></Field></div>
        <div className="md:col-span-2"><Field label="Existing asset versions" hint="References only; this editor never uploads binaries"><div className="space-y-2 rounded-xl border border-slate-800 bg-slate-950/50 p-3">{assetVersions.map(version => { const related = workspace.artifacts.find(item => item.id === version.artifact_id); return <label key={version.id} className="flex items-start gap-3 text-sm text-slate-300"><input type="checkbox" checked={selectedAssets.has(version.id)} onChange={() => { const next = new Set(selectedAssets); next.has(version.id) ? next.delete(version.id) : next.add(version.id); setForm({ ...form, existing_asset_version_ids: [...next].join('\n') }) }} /><span>{related?.title || related?.artifact_type || 'Artifact'} · version {version.version_number}<span className="block font-mono text-[10px] text-slate-600">{version.id}</span></span></label>})}{!assetVersions.length && <p className="text-xs text-slate-500">No readable existing artifact versions are available in this engagement.</p>}</div></Field></div>
        <div className="md:col-span-2"><Field label="Change summary"><input maxLength="1000" className={INPUT} value={changeSummary} onChange={event => setChangeSummary(event.target.value)} /></Field></div>
      </div>
      <label className="mt-5 flex items-start gap-2 text-xs text-slate-400"><input type="checkbox" checked={aiUseAllowed} onChange={event => setAiUseAllowed(event.target.checked)} /><span>Allow this exact saved version to be considered for governed AI-safe context. Default is off.</span></label>
      <div className="mt-6 flex items-center justify-between border-t border-slate-800 pt-5"><p className="text-xs text-slate-500">{dirty ? 'Unsaved changes' : 'Draft matches the latest version'}</p><button disabled={saving || !dirty} className={PRIMARY}>{saving ? 'Saving…' : 'Save immutable draft'}</button></div>
    </form>
    <aside className="space-y-5">
      <section className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5"><p className="text-xs font-semibold uppercase tracking-[0.14em] text-emerald-400">WCH suggestions</p><h3 className="mt-1 font-semibold text-white">Suggest, then choose</h3><p className="mt-2 text-xs leading-5 text-slate-500">Generation creates a pending preview only. Applying selected fields changes this unsaved form; it never confirms or saves a canonical record.</p>{proposal ? <div className="mt-4 space-y-3">{Object.entries(proposal.preview?.content || {}).map(([field, value]) => <label key={field} className="flex gap-3 rounded-xl border border-slate-800 p-3 text-xs text-slate-300"><input type="checkbox" checked={selectedFields.includes(field)} onChange={() => setSelectedFields(current => current.includes(field) ? current.filter(item => item !== field) : [...current, field])} /><span><strong className="block text-white">{field.replaceAll('_', ' ')}</strong>{Array.isArray(value) ? value.join(', ') : String(value ?? '')}</span></label>)}<div className="flex gap-2"><button type="button" className={PRIMARY} onClick={() => closeProposal(true)}>Apply selected locally</button><button type="button" className={BUTTON} onClick={() => closeProposal(false)}>Dismiss</button></div></div> : <form onSubmit={generateSuggestions} className="mt-4 space-y-3"><textarea required rows="5" maxLength="8000" className={INPUT} placeholder="Describe the suggestions you want…" value={suggestionPrompt} onChange={event => setSuggestionPrompt(event.target.value)} /><label className="flex items-start gap-2 text-xs text-slate-400"><input type="checkbox" checked={promptSafe} onChange={event => setPromptSafe(event.target.checked)} /><span>I confirm this prompt is safe to send to the configured model.</span></label><button disabled={suggesting || !promptSafe || !suggestionPrompt.trim()} className={BUTTON}>{suggesting ? 'Generating…' : 'Generate suggestions'}</button></form>}</section>
      {latest && <ArtifactApprovalPanel version={latest} approval={approval} theme="emerald" approverFilter={eligibleMarketingApprover} minimumApprovers={1} requestLabel="Submit exact version for review" onChanged={onRefresh} />}
      {latest && <ArtifactRelationsPanel artifact={artifact} />}
      {latest && <VersionProofingPanel targetKind="artifact" versions={versions} initialVersionId={latest.id} department="marketing" theme="emerald" />}
    </aside>
  </div>
}
