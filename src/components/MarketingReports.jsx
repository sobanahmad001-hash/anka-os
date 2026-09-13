import { useEffect, useMemo, useRef, useState } from 'react'

import ArtifactApprovalPanel from './ArtifactApprovalPanel.jsx' // eslint-disable-line no-unused-vars
import {
  buildMarketingReportExport,
  emptyMarketingReportDraft,
  marketingReportContentChecksum,
  marketingReportDraft,
  marketingReportEvidenceState,
  marketingReportRecords,
  marketingReportReviewState,
  marketingReportVersion,
  reconcileMarketingReportSave,
  reportLines,
  validateMarketingReportDraft,
} from '../data/marketingReports.js'

const INPUT = 'w-full rounded-xl border border-slate-700 bg-slate-950 px-3.5 py-2.5 text-sm text-white outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20'
const BUTTON = 'rounded-xl border border-slate-700 px-4 py-2 text-sm font-semibold text-slate-200 transition hover:border-emerald-500 hover:text-white disabled:cursor-not-allowed disabled:opacity-50'
const PRIMARY = 'rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50'
const unresolvedReportSaves = new Map()

function pendingStorageKey(scopeKey) {
  return `anka:marketing-report-save:${scopeKey}`
}

function normalizedPendingSave(value) {
  if (!value || !/^[0-9a-f]{64}$/i.test(String(value.contentChecksum || ''))) return null
  return {
    artifactId: typeof value.artifactId === 'string' ? value.artifactId.slice(0, 80) : '',
    contentChecksum: value.contentChecksum,
    knownVersionIds: Array.isArray(value.knownVersionIds)
      ? value.knownVersionIds.filter(item => typeof item === 'string').slice(0, 10000)
      : [],
  }
}

function readPendingSave(scopeKey) {
  if (unresolvedReportSaves.has(scopeKey)) return unresolvedReportSaves.get(scopeKey)
  try {
    const stored = globalThis.sessionStorage?.getItem(pendingStorageKey(scopeKey))
    const parsed = normalizedPendingSave(stored ? JSON.parse(stored) : null)
    if (parsed) unresolvedReportSaves.set(scopeKey, parsed)
    return parsed
  } catch { return null }
}

function writePendingSave(scopeKey, intent) {
  unresolvedReportSaves.set(scopeKey, intent)
  try { globalThis.sessionStorage?.setItem(pendingStorageKey(scopeKey), JSON.stringify(intent)) } catch { /* in-memory lock remains */ }
}

function clearPendingSave(scopeKey) {
  unresolvedReportSaves.delete(scopeKey)
  try { globalThis.sessionStorage?.removeItem(pendingStorageKey(scopeKey)) } catch { /* in-memory lock is already clear */ }
}

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

function reportScopeKey(workspace) {
  const engagement = workspace?.engagement || {}
  return [engagement.organization_id, engagement.id, engagement.brand_id].join(':')
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

export default function MarketingReports({ studio, workspace, saving, act, onRefresh, onDirtyChange, requestedOutput = null }) {
  const records = useMemo(() => marketingReportRecords(workspace), [workspace])
  const requestedArtifactId = requestedOutput?.kind === 'artifact' ? requestedOutput.id || '' : ''
  const requestedVersionId = requestedOutput?.kind === 'artifact' ? requestedOutput.versionId || '' : ''
  const scopeKey = reportScopeKey(workspace)
  const [artifactId, setArtifactId] = useState(requestedArtifactId)
  const [versionId, setVersionId] = useState(requestedVersionId)
  const [creating, setCreating] = useState(!requestedArtifactId && records.length === 0)
  const [form, setForm] = useState(emptyMarketingReportDraft())
  const [localError, setLocalError] = useState('')
  const [dirty, setDirty] = useState(false)
  const [pendingSave, setPendingSave] = useState(() => readPendingSave(scopeKey))
  const loadedSelection = useRef('')
  const activeScope = useRef(scopeKey)
  const activeVersionId = useRef(versionId)
  activeVersionId.current = versionId

  const selection = creating ? { record: null, version: null } : marketingReportVersion(records, artifactId, versionId)
  const artifact = selection.record?.artifact || null
  const version = selection.version
  const approval = version ? (workspace.approvals || []).find(item => item.artifact_version_id === version.id) || null : null
  const reviewState = marketingReportReviewState(version, workspace.approvals || [])
  const evidenceState = marketingReportEvidenceState(version)

  useEffect(() => {
    if (activeScope.current === scopeKey) return
    activeScope.current = scopeKey
    loadedSelection.current = ''
    setArtifactId(requestedArtifactId); setVersionId(requestedVersionId)
    setCreating(!requestedArtifactId && records.length === 0)
    setForm(emptyMarketingReportDraft()); setDirty(false); setLocalError('')
    setPendingSave(readPendingSave(scopeKey))
  }, [records.length, requestedArtifactId, requestedVersionId, scopeKey])

  useEffect(() => {
    onDirtyChange?.(dirty)
    return () => onDirtyChange?.(false)
  }, [dirty, onDirtyChange])

  useEffect(() => () => { activeScope.current = '' }, [])

  useEffect(() => {
    if (creating) return
    const next = marketingReportVersion(records, artifactId, versionId)
    if (!next.record || !next.version) {
      if (artifactId || versionId) {
        loadedSelection.current = ''
        setForm(emptyMarketingReportDraft()); setDirty(false)
      }
      return
    }
    const nextSelection = `${next.record.artifact.id}:${next.version.id}`
    if (loadedSelection.current === nextSelection) return
    setArtifactId(next.record.artifact.id)
    setVersionId(next.version.id)
    setForm(marketingReportDraft(next.record.artifact, next.version))
    setDirty(false)
    loadedSelection.current = nextSelection
  }, [records, artifactId, versionId, creating])

  useEffect(() => {
    if (!pendingSave) return
    const reconciled = reconcileMarketingReportSave(records, pendingSave)
    if (!reconciled) return
    clearPendingSave(scopeKey)
    loadedSelection.current = ''
    setPendingSave(null); setCreating(false); setDirty(false)
    setArtifactId(reconciled.record.artifact.id); setVersionId(reconciled.version.id)
    setLocalError('The authoritative workspace contains the saved exact version. The ambiguous save lock was cleared.')
  }, [pendingSave, records, scopeKey])

  function confirmDiscard() {
    return !dirty || globalThis.confirm?.('Discard the unsaved report changes and change the exact selection?') === true
  }

  function updateForm(patch) {
    setForm(current => ({ ...current, ...patch })); setDirty(true); setLocalError('')
  }

  function chooseReport(nextArtifactId) {
    if (!confirmDiscard()) return
    const next = marketingReportVersion(records, nextArtifactId)
    setCreating(false); setArtifactId(next.record?.artifact.id || ''); setVersionId(next.version?.id || '')
    setForm(marketingReportDraft(next.record?.artifact, next.version)); setDirty(false); setLocalError('')
    loadedSelection.current = next.record && next.version ? `${next.record.artifact.id}:${next.version.id}` : ''
  }

  function chooseVersion(nextVersionId) {
    if (!confirmDiscard()) return
    const next = marketingReportVersion(records, artifactId, nextVersionId)
    setVersionId(next.version?.id || '')
    setForm(marketingReportDraft(next.record?.artifact, next.version)); setDirty(false); setLocalError('')
    loadedSelection.current = next.record && next.version ? `${next.record.artifact.id}:${next.version.id}` : ''
  }

  function startReport() {
    if (!confirmDiscard()) return
    setCreating(true); setArtifactId(''); setVersionId(''); setForm(emptyMarketingReportDraft()); setDirty(false); setLocalError('')
    loadedSelection.current = ''
  }

  async function save(event) {
    event.preventDefault()
    if (saving || pendingSave) return
    let attempted = false
    let intent = null
    try {
      const validated = validateMarketingReportDraft(form)
      const contentChecksum = await marketingReportContentChecksum(validated.content)
      intent = {
        artifactId: artifact?.id || '', contentChecksum,
        knownVersionIds: records.flatMap(record => record.versions.map(item => item.id)),
      }
      writePendingSave(scopeKey, intent)
      setPendingSave(intent)
      const result = await act(() => {
        attempted = true
        return studio.saveArtifact({
          engagement_id: workspace.engagement.id,
          artifact_id: artifact?.id || null,
          artifact_type: 'marketing_report',
          title: validated.title,
          content: validated.content,
          change_summary: artifact ? `Report revision from exact version ${version.version_number}` : 'Initial Marketing report version',
          ai_use_allowed: false,
        })
      }, 'Marketing report saved as a new unapproved immutable version.', '', true)
      if (!attempted) {
        clearPendingSave(scopeKey); setPendingSave(null)
        return
      }
      const savedVersion = result?.version || result
      const savedArtifactId = savedVersion?.artifact_id || result?.artifact_id || ''
      const returnedChecksum = savedVersion?.content_checksum || (savedVersion?.content ? await marketingReportContentChecksum(savedVersion.content) : '')
      const resultMatchesIntent = savedArtifactId && savedVersion?.id &&
        savedVersion.organization_id === workspace.engagement.organization_id &&
        (!intent.artifactId || savedArtifactId === intent.artifactId) &&
        !intent.knownVersionIds.includes(savedVersion.id) && returnedChecksum === intent.contentChecksum
      if (!resultMatchesIntent) {
        setLocalError('The save outcome is unknown. Do not save again; refresh authoritative data to reconcile the exact version.')
        return
      }
      clearPendingSave(scopeKey); setPendingSave(null)
      loadedSelection.current = ''
      setCreating(false); setArtifactId(savedArtifactId); setVersionId(savedVersion.id); setDirty(false)
    } catch (error) {
      if (attempted && intent) {
        setLocalError('The save response was not authoritative. Do not retry: check the authoritative workspace for the exact saved version.')
      } else {
        if (intent) { clearPendingSave(scopeKey); setPendingSave(null) }
        setLocalError(error.message)
      }
    }
  }

  return <section className="space-y-5">
    <div className="flex flex-wrap items-start justify-between gap-4 rounded-2xl border border-slate-800 bg-slate-900/70 p-5">
      <div><p className="text-xs font-semibold uppercase tracking-[0.14em] text-emerald-400">Report editor</p><h2 className="mt-1 text-xl font-semibold">Exact saved reports and versions</h2><p className="mt-2 max-w-3xl text-sm leading-6 text-slate-400">Create an unapproved report from explicitly named stored evidence, or inspect one immutable saved version. This view does not refresh providers or invent missing metrics.</p></div>
      <button type="button" disabled={Boolean(pendingSave)} onClick={startReport} className={BUTTON}>New report draft</button>
    </div>

    {pendingSave && <div role="alert" className="rounded-2xl border border-amber-600/50 bg-amber-950/30 p-4 text-sm leading-6 text-amber-100"><p className="font-semibold">Report save outcome requires reconciliation</p><p className="mt-1">Do not submit this report again. The earlier request may already have committed even though its response was unavailable.</p><button type="button" disabled={saving || !onRefresh} onClick={() => onRefresh?.()} className={`${BUTTON} mt-3`}>{saving ? 'Checking authoritative workspace…' : 'Check authoritative workspace'}</button></div>}

    <div className="grid gap-4 rounded-2xl border border-slate-800 bg-slate-900/70 p-5 md:grid-cols-2">
      <Field label="Saved report"><select disabled={Boolean(pendingSave)} className={INPUT} value={creating ? '' : artifact?.id || ''} onChange={event => event.target.value ? chooseReport(event.target.value) : startReport()}><option value="">{!creating && !artifact ? 'Requested report unavailable — choose deliberately' : 'New unapproved report'}</option>{records.map(item => <option key={item.artifact.id} value={item.artifact.id}>{item.artifact.title}</option>)}</select></Field>
      <Field label="Exact version" hint={creating ? 'Available after saving' : ''}><select disabled={creating || Boolean(pendingSave)} className={INPUT} value={version?.id || ''} onChange={event => chooseVersion(event.target.value)}>{!version && <option value="">Exact version unavailable — choose deliberately</option>}{selection.record?.versions.map(item => <option key={item.id} value={item.id}>Version {item.version_number}{(workspace.approvals || []).some(approvalItem => approvalItem.artifact_version_id === item.id) ? ' - approved' : ' - draft'}</option>)}</select></Field>
    </div>

    {!creating && (!artifact || !version) && <div role="alert" className="rounded-2xl border border-amber-500/40 px-5 py-4 text-sm text-amber-100">The requested exact report or version is unavailable in this authorized workspace. Nothing else was selected automatically; choose an available report and exact version deliberately.</div>}

    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(360px,0.85fr)]">
      <form onSubmit={save} className="space-y-5 rounded-2xl border border-slate-800 bg-slate-900/70 p-5">
        <div><h3 className="font-semibold">{creating ? 'New report draft' : `Edit from version ${version?.version_number}`}</h3><p className="mt-1 text-xs leading-5 text-slate-500">Saving always creates a new unapproved immutable version. It never changes an approved version.</p></div>
        {localError && <p role="alert" className="rounded-xl border border-red-900/60 bg-red-950/40 px-3 py-2 text-sm text-red-300">{localError}</p>}
        <Field label="Title"><input required className={INPUT} value={form.title} onChange={event => updateForm({ title: event.target.value })} /></Field>
        <Field label="Brand" hint="Fixed by the active engagement"><input readOnly className={INPUT} value={workspace.engagement.brands?.name || 'Current engagement brand'} /></Field>
        <div className="grid gap-4 sm:grid-cols-2"><Field label="Period start"><input required type="date" className={INPUT} value={form.period_start} onChange={event => updateForm({ period_start: event.target.value })} /></Field><Field label="Period end"><input required type="date" className={INPUT} value={form.period_end} onChange={event => updateForm({ period_end: event.target.value })} /></Field></div>
        <Field label="Selected source notes" hint="One explicit source or exact saved evidence version per line"><textarea required rows="4" className={INPUT} value={editorValue(form.sources)} onChange={event => updateForm({ sources: event.target.value })} /></Field>
        <Field label="Executive summary"><textarea required rows="5" className={INPUT} value={form.executive_summary} onChange={event => updateForm({ executive_summary: event.target.value })} /></Field>
        <Field label="Insights" hint="One evidenced interpretation per line"><textarea required rows="5" className={INPUT} value={editorValue(form.insights)} onChange={event => updateForm({ insights: event.target.value })} /></Field>
        <Field label="Recommended actions" hint="One proposed action per line"><textarea required rows="5" className={INPUT} value={editorValue(form.recommended_actions)} onChange={event => updateForm({ recommended_actions: event.target.value })} /></Field>
        <div className="flex justify-end border-t border-slate-800 pt-5"><button disabled={saving || Boolean(pendingSave) || (!creating && !version)} className={PRIMARY}>{pendingSave ? 'Save locked — reconcile earlier request' : saving ? 'Saving report...' : artifact ? 'Save new draft version' : 'Save first draft version'}</button></div>
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
        {version && <ArtifactApprovalPanel version={version} approval={approval} theme="emerald" minimumApprovers={2} requestLabel="Submit exact report version for review" onChanged={() => activeScope.current === scopeKey && activeVersionId.current === version.id ? onRefresh?.() : undefined} />}
      </div>
    </div>
  </section>
}
