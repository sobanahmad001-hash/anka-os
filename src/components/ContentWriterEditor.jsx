import { useMemo, useState } from 'react'

import {
  CONTENT_WRITER_OUTPUT_TYPES,
  architecturePages,
  architectureVersions,
  contentWriterIssues,
  contentWriterFormFromVersion,
  contentWriterPreview,
  newContentWriterDraft,
  writerDestinationLabel,
  writerOutputs,
} from '../data/contentWriter.js'
import {
  CONTENT_LENGTH_UNITS,
  checkContentQuality,
  contentCounts,
  contentQualityConfiguration,
  contentQualityConfigurationIssues,
} from '../data/contentQualityChecks.js'

const INPUT = 'w-full rounded-xl border border-slate-700 bg-slate-950 px-3.5 py-2.5 text-sm text-white outline-none focus:border-amber-500 focus:ring-2 focus:ring-amber-500/20'
const PRIMARY = 'rounded-xl bg-amber-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-amber-500 disabled:cursor-not-allowed disabled:opacity-50'
const SECONDARY = 'rounded-xl border border-slate-700 bg-slate-950 px-4 py-2.5 text-sm font-semibold text-slate-200 transition hover:border-slate-500 disabled:cursor-not-allowed disabled:opacity-50'

export default function ContentWriterEditor({ workspace, studio, saving, act, onRefresh, refreshing = false, stale = false, stageId, defaultLanguage = '' }) {
  const [form, setForm] = useState(() => newContentWriterDraft({ language: defaultLanguage }))
  const [preview, setPreview] = useState(null)
  const [attempted, setAttempted] = useState(false)
  const [checkReport, setCheckReport] = useState(null)
  const [qualityAttempted, setQualityAttempted] = useState(false)
  const [continuation, setContinuation] = useState(null)
  const versions = useMemo(() => architectureVersions(workspace), [workspace])
  const selectedVersion = versions.find(version => version.id === form.source_architecture_version_id)
  const issues = contentWriterIssues(form, versions)
  const outputs = writerOutputs(workspace)
  const approvedVersionIds = new Set((workspace.approvals || []).map(item => item.artifact_version_id))
  const qualityIssues = contentQualityConfigurationIssues(form)
  const counts = contentCounts(form.body)
  const currentOutput = continuation && outputs.find(item => item.artifact.id === continuation.artifactId)
  const staleContinuation = continuation && currentOutput?.latest.id !== continuation.baseVersionId
  function resetDraft() {
    setContinuation(null)
    setForm(newContentWriterDraft({ language: defaultLanguage }))
    setPreview(null)
    setAttempted(false)
    setCheckReport(null)
    setQualityAttempted(false)
  }
  function continueOutput(artifact, latest) {
    setContinuation({ artifactId: artifact.id, baseVersionId: latest.id, versionNumber: latest.version_number })
    setForm(contentWriterFormFromVersion(latest))
    setPreview(null)
    setAttempted(false)
    setCheckReport(null)
    setQualityAttempted(false)
  }

  function setField(key, value) {
    setPreview(null)
    setCheckReport(null)
    setQualityAttempted(false)
    setForm(current => ({ ...current, [key]: value }))
  }

  function selectOutputType(value) {
    setPreview(null)
    setCheckReport(null)
    setQualityAttempted(false)
    setForm(current => ({
      ...current, output_type: value, source_architecture_version_id: '', target_page_key: '', destination: '',
    }))
  }

  function buildPreview(event) {
    event.preventDefault()
    setAttempted(true)
    if (staleContinuation || Object.keys(issues).length) return
    setPreview(contentWriterPreview(form, versions))
  }

  function runQualityChecks() {
    setQualityAttempted(true)
    if (Object.keys(qualityIssues).length) return
    const quality = contentQualityConfiguration(form)
    setCheckReport(checkContentQuality({ body: form.body, cta: form.cta, ...quality }))
  }

  async function confirmDraft() {
    if (stale || staleContinuation || Object.keys(issues).length) {
      setAttempted(true)
      setPreview(null)
      return
    }
    const current = contentWriterPreview(form, versions)
    if (!preview || preview.signature !== current.signature) {
      setPreview(null)
      return
    }
    if (!globalThis.confirm(`Confirm: ${continuation ? 'append one new unapproved immutable version' : 'create one unapproved immutable draft'} for ${current.destinationLabel}.`)) return
    const result = await act(() => studio.saveArtifact({
      engagement_id: workspace.engagement.id,
      engagement_stage_instance_id: stageId || null,
      artifact_id: continuation?.artifactId || null,
      expected_parent_version_id: continuation?.baseVersionId || null,
      artifact_type: 'content',
      title: current.content.working_title,
      content: current.content,
      change_summary: continuation ? `Continued from exact version ${continuation.versionNumber} in the manual Content writer` : 'Created from the manual Content writer preview',
      data_classification: 'internal',
      ai_use_allowed: false,
    }), 'Writer output saved as one unapproved immutable version. Earlier versions and approvals remain intact.')
    if (result) {
      resetDraft()
    }
  }

  const error = key => attempted && issues[key]
  const qualityError = key => (attempted || qualityAttempted) && qualityIssues[key]
  return <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,0.9fr)]">
    <form onSubmit={buildPreview} className="rounded-2xl border border-slate-800 bg-slate-900/70 p-6">
      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-amber-400">Content B05 · manual writer</p>
      <h2 className="mt-1 text-2xl font-semibold">Production writer</h2>
      <p className="mt-2 text-sm leading-6 text-slate-400">Prepare one text draft, inspect its exact destination, then confirm an unapproved immutable version. Generation jobs, multiple variants, selective rewrite, and publishing are not enabled in this slice.</p>
      {stale && <p role="alert" className="mt-4 text-sm text-amber-300">The saved output list could not be refreshed. Retry before saving a new version.</p>}
      {continuation && <div className="mt-4 rounded-xl border border-amber-500/40 bg-amber-950/20 p-4 text-sm text-amber-100">Continuing exact version {continuation.versionNumber}. Saving appends a new unapproved version; the earlier version and its approval remain unchanged.
        {staleContinuation && <p role="alert" className="mt-2 text-red-300">A newer version is available. Reopen the latest output before previewing or saving.</p>}
        <button type="button" className="mt-3 block text-xs font-semibold underline" onClick={resetDraft}>Start a new draft instead</button>
      </div>}
      {attempted && Object.keys(issues).length > 0 && <div role="alert" className="mt-5 rounded-xl border border-red-900/60 bg-red-950/40 px-4 py-3 text-sm text-red-300">Resolve the labelled fields before previewing this draft.</div>}
      <div className="mt-6 space-y-5">
        <Field label="Output type" error={error('output_type')}><select className={INPUT} value={form.output_type} onChange={event => selectOutputType(event.target.value)}>{CONTENT_WRITER_OUTPUT_TYPES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></Field>
        <Field label="Working title" error={error('working_title')}><input className={INPUT} maxLength="160" value={form.working_title} onChange={event => setField('working_title', event.target.value)} /></Field>
        {form.output_type === 'website_page_copy' ? <>
          <Field label="Exact Website Architecture version" error={error('source_architecture_version_id')}><select className={INPUT} value={form.source_architecture_version_id} onChange={event => { setPreview(null); setCheckReport(null); setQualityAttempted(false); setForm(current => ({ ...current, source_architecture_version_id: event.target.value, target_page_key: '' })) }}><option value="">Choose exact version</option>{versions.map(version => <option key={version.id} value={version.id}>Version {version.version_number} · {version.id}</option>)}</select></Field>
          <Field label="Target page" error={error('target_page_key')}><select className={INPUT} value={form.target_page_key} onChange={event => setField('target_page_key', event.target.value)}><option value="">Choose a page</option>{architecturePages(selectedVersion).map(page => <option key={page.page_key} value={page.page_key}>{page.title} · {page.slug}</option>)}</select></Field>
        </> : <Field label={writerDestinationLabel(form.output_type)} error={error('destination')}><input className={INPUT} value={form.destination} onChange={event => setField('destination', event.target.value)} /></Field>}
        <Field label="Objective" error={error('objective')}><textarea rows="3" className={INPUT} value={form.objective} onChange={event => setField('objective', event.target.value)} /></Field>
        <Field label="Audience" error={error('audience')}><textarea rows="3" className={INPUT} value={form.audience} onChange={event => setField('audience', event.target.value)} /></Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Language" error={error('language')}><input className={INPUT} value={form.language} onChange={event => setField('language', event.target.value)} /></Field>
          <Field label="Tone override (optional)"><input className={INPUT} value={form.tone} onChange={event => setField('tone', event.target.value)} /></Field>
        </div>
        <Field label="Draft text" error={error('body')}><textarea rows="12" className={INPUT} value={form.body} onChange={event => setField('body', event.target.value)} /></Field>
        <p className="text-xs text-slate-500" aria-live="polite">{counts.words} words · {counts.characters} characters. Counts are factual and do not imply quality or approval.</p>
        <Field label="Selected call to action (optional, checked against draft)"><textarea rows="2" className={INPUT} value={form.cta} onChange={event => setField('cta', event.target.value)} /></Field>
        <Field label="Excluded phrases (optional, one per line)"><textarea rows="3" className={INPUT} value={form.exclusions} onChange={event => setField('exclusions', event.target.value)} /></Field>
        <section className="rounded-xl border border-slate-800 bg-slate-950/40 p-4">
          <h3 className="text-sm font-semibold text-white">Request-local quality rules</h3>
          <p className="mt-1 text-xs leading-5 text-slate-500">Optional deterministic checks only. Missing rules are Not configured, and these values never update approved brand defaults.</p>
          <div className="mt-4 space-y-4">
            <Field label="Required section headings or labels (optional, one per line)" error={qualityError('required_sections')}><textarea rows="3" className={INPUT} value={form.required_sections} onChange={event => setField('required_sections', event.target.value)} /></Field>
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="Length rule" error={qualityError('length_unit')}><select className={INPUT} value={form.length_unit} onChange={event => setField('length_unit', event.target.value)}>{CONTENT_LENGTH_UNITS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></Field>
              <Field label="Minimum"><input type="number" min="1" step="1" disabled={form.length_unit === 'none'} className={INPUT} value={form.min_length} onChange={event => setField('min_length', event.target.value)} /></Field>
              <Field label="Maximum" error={qualityError('length_rule')}><input type="number" min="1" step="1" disabled={form.length_unit === 'none'} className={INPUT} value={form.max_length} onChange={event => setField('max_length', event.target.value)} /></Field>
            </div>
            <Field label="Required terms or phrases (optional, one per line)" error={qualityError('required_terms')}><textarea rows="3" className={INPUT} value={form.required_terms} onChange={event => setField('required_terms', event.target.value)} /></Field>
            <label className="flex items-start gap-3 text-sm text-slate-300"><input type="checkbox" className="mt-1" checked={form.require_source_citations} onChange={event => setField('require_source_citations', event.target.checked)} /><span>Require at least one selected source citation for this request.</span></label>
            <Field label="Selected source citations (optional, one label or URL per line)" error={qualityError('source_citations')}><textarea rows="3" className={INPUT} value={form.source_citations} onChange={event => setField('source_citations', event.target.value)} /></Field>
          </div>
        </section>
      </div>
      <div className="mt-6 flex flex-wrap items-center justify-between gap-4 border-t border-slate-800 pt-5"><p className="text-xs text-slate-500">Variant 1 only · cost estimate unavailable because no provider job is being started.</p><div className="flex gap-2"><button type="button" onClick={runQualityChecks} className={SECONDARY}>Check content</button><button disabled={saving || stale || staleContinuation} className={PRIMARY}>{preview ? 'Refresh preview' : 'Preview draft'}</button></div></div>
    </form>
    <section className="space-y-5">
      {checkReport && <article className="rounded-2xl border border-slate-700 bg-slate-900/70 p-5">
        <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">Deterministic advisory checks</p><h3 className="mt-1 text-lg font-semibold text-white">{checkReport.attention ? `${checkReport.attention} item${checkReport.attention === 1 ? '' : 's'} need attention` : 'No configured issue found'}</h3></div><p className="text-xs text-slate-500">{checkReport.counts.words} words · {checkReport.counts.characters} characters</p></div>
        <p className="mt-3 text-xs leading-5 text-slate-500">Heading and phrase checks report structural presence only, not semantic correctness. Citation checks do not verify accuracy, access, or support. No SEO score, AI assessment, approval, release, or publication is created.</p>
        <div className="mt-4 space-y-2">{checkReport.checks.map(item => <div key={item.id} className="rounded-xl border border-slate-800 bg-slate-950/60 p-3"><div className="flex justify-between gap-3"><p className="text-sm font-semibold text-white">{item.label}</p><span className={`text-xs font-semibold ${item.status === 'pass' ? 'text-emerald-300' : item.status === 'attention' ? 'text-amber-300' : 'text-slate-500'}`}>{item.status === 'pass' ? 'Pass' : item.status === 'attention' ? 'Attention' : 'Not configured'}</span></div><p className="mt-1 text-xs leading-5 text-slate-500">{item.detail}</p></div>)}</div>
      </article>}
      {preview ? <article className="rounded-2xl border border-amber-500/30 bg-amber-950/20 p-6">
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-amber-300">Exact save preview</p>
        <h3 className="mt-2 text-xl font-semibold">{preview.content.working_title}</h3>
        <dl className="mt-5 grid gap-3 text-sm"><PreviewRow label="Type" value={preview.content.output_type.replaceAll('_', ' ')} /><PreviewRow label="Destination" value={preview.destinationLabel} /><PreviewRow label="Language" value={preview.content.language} /><PreviewRow label="Tone" value={preview.content.tone || 'No request override'} /><PreviewRow label="Effect" value={continuation ? `Append unapproved version after exact v${continuation.versionNumber}` : "Create one unapproved immutable Content artifact version"} /></dl>
        <div className="mt-5 max-h-80 overflow-y-auto whitespace-pre-wrap rounded-xl border border-slate-800 bg-slate-950/70 p-4 text-sm leading-6 text-slate-200">{preview.content.body}</div>
        <button type="button" disabled={saving || stale || staleContinuation} onClick={confirmDraft} className={`${PRIMARY} mt-5 w-full`}>{saving ? 'Saving…' : 'Confirm unapproved draft'}</button>
      </article> : <div className="rounded-2xl border border-dashed border-slate-700 p-8 text-center text-sm text-slate-500">Complete the required fields to preview the exact output and destination before anything is saved.</div>}
      <article className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5"><div className="flex items-center justify-between gap-3"><h3 className="font-semibold">Saved writer outputs</h3><button type="button" className={SECONDARY} disabled={refreshing || saving} onClick={onRefresh}>{refreshing ? "Refreshing…" : "Refresh outputs"}</button></div><p className="mt-1 text-xs text-slate-500">These schema-v2 outputs remain visible here without replacing legacy page-content tracking.</p>{outputs.length ? <div className="mt-4 space-y-3">{outputs.map(({ artifact, latest }) => { const approved = approvedVersionIds.has(latest.id); return <div key={artifact.id} className="rounded-xl border border-slate-800 bg-slate-950/60 p-3"><div className="flex justify-between gap-3"><p className="text-sm font-semibold text-white">{latest.content.working_title || artifact.title}</p><span className={`text-xs ${approved ? 'text-emerald-300' : 'text-amber-300'}`}>{approved ? 'Approved' : 'Unapproved'} v{latest.version_number}</span></div><p className="mt-1 text-xs text-slate-500">{latest.content.output_type.replaceAll('_', ' ')} · {latest.content.language}</p><button type="button" disabled={saving} onClick={() => continueOutput(artifact, latest)} className="mt-3 text-xs font-semibold text-amber-300 underline">Continue from exact v{latest.version_number}</button></div> })}</div> : <p className="mt-4 text-sm text-slate-500">No writer outputs saved yet.</p>}</article>
    </section>
  </div>
}

function Field({ label, error, children }) {
  return <label className="block text-xs font-semibold uppercase tracking-[0.12em] text-slate-400">{label}<span className="mt-2 block normal-case tracking-normal">{children}</span>{error && <span className="mt-2 block font-normal normal-case tracking-normal text-red-300">{error}</span>}</label>
}

function PreviewRow({ label, value }) {
  return <div className="grid grid-cols-[7rem_1fr] gap-3"><dt className="text-slate-500">{label}</dt><dd className="text-slate-200">{value}</dd></div>
}
