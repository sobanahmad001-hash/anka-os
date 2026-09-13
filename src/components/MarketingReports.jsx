import { useEffect, useMemo, useState } from 'react'

import ArtifactApprovalPanel from './ArtifactApprovalPanel.jsx' // eslint-disable-line no-unused-vars
import {
  buildMarketingReportExport,
  emptyMarketingReportDraft,
  marketingReportDraft,
  marketingReportEvidenceState,
  marketingReportRecords,
  marketingReportReviewState,
  marketingReportVersion,
  reportLines,
  validateMarketingReportDraft,
} from '../data/marketingReports.js'

const INPUT = 'w-full rounded-xl border border-slate-700 bg-slate-950 px-3.5 py-2.5 text-sm text-white outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20'
const BUTTON = 'rounded-xl border border-slate-700 px-4 py-2 text-sm font-semibold text-slate-200 transition hover:border-emerald-500 hover:text-white disabled:cursor-not-allowed disabled:opacity-50'
const PRIMARY = 'rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50'

function Field({ label, hint, children }) { // eslint-disable-line no-unused-vars
  return <label className="block text-xs font-semibold uppercase tracking-[0.12em] text-slate-400">{label}{hint && <span className="ml-2 font-normal normal-case tracking-normal text-slate-600">{hint}</span>}<div className="mt-2 normal-case tracking-normal">{children}</div></label>
}

function list(values) {
  return reportLines(values).length
    ? <ul className="mt-2 list-disc space-y-1 pl-5 text-sm leading-6 text-slate-300">{reportLines(values).map(item => <li key={item}>{item}</li>)}</ul>
    : <p className="mt-2 text-sm text-slate-500">Unavailable</p>
}

function editorValue(value) {
  return Array.isArray(value) ? value.join('\n') : value || ''
}

function downloadExactVersion(artifact, version, approval, brandName) {
  const body = buildMarketingReportExport({ artifact, version, approval, brandName })
  const blob = new Blob([body], { type: 'text/plain;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `${String(artifact.title || 'marketing-report').replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase() || 'marketing-report'}-v${version.version_number}.txt`
  anchor.click()
  URL.revokeObjectURL(url)
}

export default function MarketingReports({ studio, workspace, saving, act, onRefresh }) {
  const records = useMemo(() => marketingReportRecords(workspace), [workspace])
  const [artifactId, setArtifactId] = useState('')
  const [versionId, setVersionId] = useState('')
  const [creating, setCreating] = useState(records.length === 0)
  const [form, setForm] = useState(emptyMarketingReportDraft())
  const [localError, setLocalError] = useState('')

  const selection = creating ? { record: null, version: null } : marketingReportVersion(records, artifactId, versionId)
  const artifact = selection.record?.artifact || null
  const version = selection.version
  const approval = version ? workspace.approvals.find(item => item.artifact_version_id === version.id) || null : null
  const reviewState = marketingReportReviewState(version, workspace.approvals)
  const evidenceState = marketingReportEvidenceState(version)

  useEffect(() => {
    if (!records.length) {
      setCreating(true); setArtifactId(''); setVersionId(''); setForm(emptyMarketingReportDraft())
      return
    }
    if (creating) return
    const next = marketingReportVersion(records, artifactId, versionId)
    setArtifactId(next.record.artifact.id)
    setVersionId(next.version.id)
    setForm(marketingReportDraft(next.record.artifact, next.version))
  }, [records, artifactId, versionId, creating])

  function chooseReport(nextArtifactId) {
    const next = marketingReportVersion(records, nextArtifactId)
    setCreating(false); setArtifactId(next.record?.artifact.id || ''); setVersionId(next.version?.id || '')
    setForm(marketingReportDraft(next.record?.artifact, next.version)); setLocalError('')
  }

  function chooseVersion(nextVersionId) {
    const next = marketingReportVersion(records, artifactId, nextVersionId)
    setVersionId(next.version?.id || '')
    setForm(marketingReportDraft(next.record?.artifact, next.version)); setLocalError('')
  }

  function startReport() {
    setCreating(true); setArtifactId(''); setVersionId(''); setForm(emptyMarketingReportDraft()); setLocalError('')
  }

  async function save(event) {
    event.preventDefault()
    try {
      const validated = validateMarketingReportDraft(form)
      const result = await act(() => studio.saveArtifact({
        engagement_id: workspace.engagement.id,
        artifact_id: artifact?.id || null,
        artifact_type: 'marketing_report',
        title: validated.title,
        content: validated.content,
        change_summary: artifact ? `Report revision from exact version ${version.version_number}` : 'Initial Marketing report version',
        ai_use_allowed: false,
      }), 'Marketing report saved as a new unapproved immutable version.', '', true)
      if (result) {
        setCreating(false)
      }
    } catch (error) {
      setLocalError(error.message)
    }
  }

  return <section className="space-y-5">
    <div className="flex flex-wrap items-start justify-between gap-4 rounded-2xl border border-slate-800 bg-slate-900/70 p-5">
      <div><p className="text-xs font-semibold uppercase tracking-[0.14em] text-emerald-400">Report editor</p><h2 className="mt-1 text-xl font-semibold">Exact saved reports and versions</h2><p className="mt-2 max-w-3xl text-sm leading-6 text-slate-400">Create an unapproved report from explicitly named stored evidence, or inspect one immutable saved version. This view does not refresh providers or invent missing metrics.</p></div>
      <button type="button" onClick={startReport} className={BUTTON}>New report draft</button>
    </div>

    <div className="grid gap-4 rounded-2xl border border-slate-800 bg-slate-900/70 p-5 md:grid-cols-2">
      <Field label="Saved report"><select className={INPUT} value={creating ? '' : artifact?.id || ''} onChange={event => event.target.value ? chooseReport(event.target.value) : startReport()}><option value="">New unapproved report</option>{records.map(item => <option key={item.artifact.id} value={item.artifact.id}>{item.artifact.title}</option>)}</select></Field>
      <Field label="Exact version" hint={creating ? 'Available after saving' : ''}><select disabled={creating} className={INPUT} value={version?.id || ''} onChange={event => chooseVersion(event.target.value)}>{selection.record?.versions.map(item => <option key={item.id} value={item.id}>Version {item.version_number}{workspace.approvals.some(approvalItem => approvalItem.artifact_version_id === item.id) ? ' - approved' : ' - draft'}</option>)}</select></Field>
    </div>

    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(360px,0.85fr)]">
      <form onSubmit={save} className="space-y-5 rounded-2xl border border-slate-800 bg-slate-900/70 p-5">
        <div><h3 className="font-semibold">{creating ? 'New report draft' : `Edit from version ${version?.version_number}`}</h3><p className="mt-1 text-xs leading-5 text-slate-500">Saving always creates a new unapproved immutable version. It never changes an approved version.</p></div>
        {localError && <p role="alert" className="rounded-xl border border-red-900/60 bg-red-950/40 px-3 py-2 text-sm text-red-300">{localError}</p>}
        <Field label="Title"><input required className={INPUT} value={form.title} onChange={event => setForm({ ...form, title: event.target.value })} /></Field>
        <Field label="Brand" hint="Fixed by the active engagement"><input readOnly className={INPUT} value={workspace.engagement.brands?.name || 'Current engagement brand'} /></Field>
        <div className="grid gap-4 sm:grid-cols-2"><Field label="Period start"><input required type="date" className={INPUT} value={form.period_start} onChange={event => setForm({ ...form, period_start: event.target.value })} /></Field><Field label="Period end"><input required type="date" className={INPUT} value={form.period_end} onChange={event => setForm({ ...form, period_end: event.target.value })} /></Field></div>
        <Field label="Selected source notes" hint="One explicit source or exact saved evidence version per line"><textarea required rows="4" className={INPUT} value={editorValue(form.sources)} onChange={event => setForm({ ...form, sources: event.target.value })} /></Field>
        <Field label="Executive summary"><textarea required rows="5" className={INPUT} value={form.executive_summary} onChange={event => setForm({ ...form, executive_summary: event.target.value })} /></Field>
        <Field label="Insights" hint="One evidenced interpretation per line"><textarea required rows="5" className={INPUT} value={editorValue(form.insights)} onChange={event => setForm({ ...form, insights: event.target.value })} /></Field>
        <Field label="Recommended actions" hint="One proposed action per line"><textarea required rows="5" className={INPUT} value={editorValue(form.recommended_actions)} onChange={event => setForm({ ...form, recommended_actions: event.target.value })} /></Field>
        <div className="flex justify-end border-t border-slate-800 pt-5"><button disabled={saving} className={PRIMARY}>{saving ? 'Saving report...' : artifact ? 'Save new draft version' : 'Save first draft version'}</button></div>
      </form>

      <div className="space-y-4">
        <article className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5">
          <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs font-semibold uppercase tracking-[0.14em] text-emerald-400">Exact version preview</p><h3 className="mt-1 text-lg font-semibold">{version ? artifact.title : 'No saved version selected'}</h3></div>{version && <span className={`rounded-full px-3 py-1 text-xs font-semibold ${reviewState === 'approved' ? 'bg-emerald-950 text-emerald-300' : 'bg-amber-950 text-amber-200'}`}>{reviewState === 'approved' ? 'Approved exact version' : 'Draft - not approved'}</span>}</div>
          {!version ? <p className="mt-5 text-sm text-slate-500">Save a draft or choose an existing report to preview its persisted content.</p> : <div className="mt-5 space-y-5">
            <p className="text-sm text-slate-400">{version.content.period_start} to {version.content.period_end} · Version {version.version_number}</p>
            <div className="rounded-xl border border-amber-900/50 bg-amber-950/20 p-3 text-xs leading-5 text-amber-200">{evidenceState.message}</div>
            <div><h4 className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Selected source notes</h4>{list(version.content.sources)}</div>
            <div><h4 className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Executive summary</h4><p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-300">{version.content.executive_summary || 'Unavailable'}</p></div>
            <div><h4 className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Insights</h4>{list(version.content.insights)}</div>
            <div><h4 className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Recommended actions</h4>{list(version.content.recommended_actions)}</div>
            <button type="button" onClick={() => downloadExactVersion(artifact, version, approval, workspace.engagement.brands?.name || 'Brand')} className={BUTTON}>Export exact version as text</button>
            <p className="text-xs leading-5 text-slate-500">The download is a local presentation of this authorized version. It does not approve, release, publish, refresh, or share the report.</p>
          </div>}
        </article>
        {version && <ArtifactApprovalPanel version={version} approval={approval} theme="emerald" minimumApprovers={2} requestLabel="Submit exact report version for review" onChanged={onRefresh} />}
      </div>
    </div>
  </section>
}
