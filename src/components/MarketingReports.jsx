import { useEffect, useMemo, useRef, useState } from 'react'

import ArtifactApprovalPanel from './ArtifactApprovalPanel.jsx' // eslint-disable-line no-unused-vars
import {
  buildMarketingReportExport,
  emptyMarketingReportDraft,
  marketingReportActorHash,
  marketingReportContentChecksum,
  marketingReportDraft,
  marketingReportEvidenceState,
  marketingReportMetricCandidates,
  marketingReportMetricFreshness,
  marketingReportRecords,
  marketingReportReviewState,
  marketingReportVersion,
  reportLines,
  validateMarketingReportDraft,
} from '../data/marketingReports.js'

const INPUT = 'w-full rounded-xl border border-slate-700 bg-slate-950 px-3.5 py-2.5 text-sm text-white outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20'
const BUTTON = 'rounded-xl border border-slate-700 px-4 py-2 text-sm font-semibold text-slate-200 transition hover:border-emerald-500 hover:text-white disabled:cursor-not-allowed disabled:opacity-50'
const PRIMARY = 'rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50'

function pendingStorageKey(actorHash, storageScope) {
  return `anka:marketing-report-save:${actorHash}:${storageScope}`
}

function normalizedPendingSave(value) {
  if (!value || !/^[0-9a-f-]{36}$/i.test(String(value.operationId || '')) || !/^[0-9a-f]{64}$/i.test(String(value.actorHash || '')) || !/^[0-9a-f]{64}$/i.test(String(value.contentChecksum || ''))) return null
  return {
    operationId: value.operationId,
    actorHash: value.actorHash,
    artifactId: typeof value.artifactId === 'string' ? value.artifactId.slice(0, 80) : '',
    versionId: typeof value.versionId === 'string' ? value.versionId.slice(0, 80) : '',
    contentChecksum: value.contentChecksum,
    payloadChecksum: /^[0-9a-f]{64}$/i.test(String(value.payloadChecksum || '')) ? value.payloadChecksum : null,
    payload: value.payload && typeof value.payload === 'object' && !Array.isArray(value.payload) && value.payload.request_id === value.operationId
      ? value.payload : null,
    knownVersionIds: Array.isArray(value.knownVersionIds)
      ? value.knownVersionIds.filter(item => typeof item === 'string').slice(0, 10000)
      : [],
  }
}

async function receiptContentMatches(version, inputChecksum) {
  if (!version?.content || !version.content_checksum) return false
  const savedChecksum = await marketingReportContentChecksum(version.content)
  if (savedChecksum !== version.content_checksum) return false
  const rawContent = { ...version.content }
  delete rawContent.metric_snapshots
  return await marketingReportContentChecksum(rawContent) === inputChecksum
}

function readPendingSave(storageKey, actorHash) {
  const storage = globalThis.sessionStorage
  if (!storage) throw new Error('Durable browser-session recovery is unavailable; report saving is disabled')
  const stored = storage.getItem(storageKey)
  const parsed = normalizedPendingSave(stored ? JSON.parse(stored) : null)
  return parsed?.actorHash === actorHash ? parsed : null
}

function writePendingSave(storageKey, intent) {
  const storage = globalThis.sessionStorage
  if (!storage) throw new Error('Durable browser-session recovery is unavailable; report saving is disabled')
  const serialized = JSON.stringify(intent)
  storage.setItem(storageKey, serialized)
  if (storage.getItem(storageKey) !== serialized) throw new Error('The report recovery lock could not be verified; report saving is disabled')
}

function clearPendingSave(storageKey, operationId) {
  const storage = globalThis.sessionStorage
  if (!storage) return false
  const current = normalizedPendingSave(JSON.parse(storage.getItem(storageKey) || 'null'))
  if (current?.operationId !== operationId) return false
  storage.removeItem(storageKey)
  return true
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

function reportScopeKey(workspace, actorId) {
  const engagement = workspace?.engagement || {}
  return [actorId, engagement.organization_id, engagement.id, engagement.brand_id].join(':')
}

function reportStorageScope(workspace) {
  const engagement = workspace?.engagement || {}
  return [engagement.organization_id, engagement.id, engagement.brand_id].join(':')
}

function downloadExactVersion(artifact, version, approval, brandName) {
  const body = buildMarketingReportExport({ artifact, version, approval, brandName })
  const blob = new Blob([body], { type: 'text/plain;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `${String(version.content?.report_title || artifact.title || 'marketing-report').replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase() || 'marketing-report'}-v${version.version_number}.txt`
  anchor.click()
  URL.revokeObjectURL(url)
}

export default function MarketingReports({ studio, workspace, saving, act, actorId = '', onRefresh, onDirtyChange, requestedOutput = null }) {
  const records = useMemo(() => marketingReportRecords(workspace), [workspace])
  const requestedArtifactId = requestedOutput?.kind === 'artifact' ? requestedOutput.id || '' : ''
  const requestedVersionId = requestedOutput?.kind === 'artifact' ? requestedOutput.versionId || '' : ''
  const scopeKey = reportScopeKey(workspace, actorId)
  const storageScope = reportStorageScope(workspace)
  const [artifactId, setArtifactId] = useState(requestedArtifactId)
  const [versionId, setVersionId] = useState(requestedVersionId)
  const [creating, setCreating] = useState(!requestedArtifactId && records.length === 0)
  const [form, setForm] = useState(emptyMarketingReportDraft())
  const [localError, setLocalError] = useState('')
  const [dirty, setDirty] = useState(false)
  const [pendingSave, setPendingSave] = useState(null)
  const [retrying, setRetrying] = useState(false)
  const [metricCandidates, setMetricCandidates] = useState([])
  const [metricLoading, setMetricLoading] = useState(false)
  const [metricError, setMetricError] = useState('')
  const [recovery, setRecovery] = useState({ ready: false, storageKey: '', actorHash: '', error: '' })
  const loadedSelection = useRef('')
  const activeScope = useRef(scopeKey)
  const activeVersionId = useRef(versionId)
  const activeTarget = useRef(null)
  const inFlightSave = useRef('')
  const draftRevision = useRef(0)
  activeVersionId.current = versionId
  activeTarget.current = { scopeKey, actorId, artifactId, versionId, creating, draftRevision: draftRevision.current }

  const selection = creating ? { record: null, version: null } : marketingReportVersion(records, artifactId, versionId)
  const artifact = selection.record?.artifact || null
  const version = selection.version
  const approval = version ? (workspace.approvals || []).find(item => item.artifact_version_id === version.id) || null : null
  const reviewState = marketingReportReviewState(version, workspace.approvals || [])
  const evidenceState = marketingReportEvidenceState(version)

  function invalidateDraftSnapshot() {
    draftRevision.current += 1
    if (activeTarget.current) activeTarget.current = { ...activeTarget.current, draftRevision: draftRevision.current }
  }

  useEffect(() => {
    if (activeScope.current === scopeKey) return
    activeScope.current = scopeKey
    draftRevision.current += 1
    if (activeTarget.current) activeTarget.current = { ...activeTarget.current, draftRevision: draftRevision.current }
    loadedSelection.current = ''
    setArtifactId(requestedArtifactId); setVersionId(requestedVersionId)
    setCreating(!requestedArtifactId && records.length === 0)
    setForm(emptyMarketingReportDraft()); setDirty(false); setLocalError('')
    setPendingSave(null)
  }, [records.length, requestedArtifactId, requestedVersionId, scopeKey])

  useEffect(() => {
    let current = true
    setRecovery({ ready: false, storageKey: '', actorHash: '', error: '' })
    setPendingSave(null)
    if (!actorId) {
      setRecovery({ ready: false, storageKey: '', actorHash: '', error: 'Authenticated actor identity is unavailable; report saving is disabled.' })
      return () => { current = false }
    }
    marketingReportActorHash(actorId).then(actorHash => {
      if (!current || activeScope.current !== scopeKey) return
      const storageKey = pendingStorageKey(actorHash, storageScope)
      const pending = readPendingSave(storageKey, actorHash)
      setPendingSave(pending)
      setRecovery({ ready: true, storageKey, actorHash, error: '' })
    }).catch(error => {
      if (current && activeScope.current === scopeKey) setRecovery({ ready: false, storageKey: '', actorHash: '', error: error.message })
    })
    return () => { current = false }
  }, [actorId, scopeKey, storageScope])

  useEffect(() => {
    if (!studio.listReportMetricSources || !/^\d{4}-\d{2}-\d{2}$/.test(form.period_start) ||
      !/^\d{4}-\d{2}-\d{2}$/.test(form.period_end) || form.period_start > form.period_end) {
      setMetricCandidates([]); setMetricError(''); setMetricLoading(false)
      return
    }
    let current = true
    setMetricLoading(true); setMetricError('')
    const brand = { id: workspace.engagement.brand_id, organization_id: workspace.engagement.organization_id,
      name: workspace.engagement.brands?.name || 'Brand' }
    studio.listReportMetricSources(brand, { start: form.period_start, end: form.period_end })
      .then(rows => { if (current && activeScope.current === scopeKey) setMetricCandidates(marketingReportMetricCandidates(rows)) })
      .catch(error => { if (current && activeScope.current === scopeKey) { setMetricCandidates([]); setMetricError(error.message || 'Stored metrics unavailable') } })
      .finally(() => { if (current && activeScope.current === scopeKey) setMetricLoading(false) })
    return () => { current = false }
  }, [studio, scopeKey, workspace.engagement.brand_id, workspace.engagement.organization_id,
    workspace.engagement.brands?.name, form.period_start, form.period_end])

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
    draftRevision.current += 1
    if (activeTarget.current) activeTarget.current = { ...activeTarget.current, draftRevision: draftRevision.current }
    setDirty(false)
    loadedSelection.current = nextSelection
  }, [records, artifactId, versionId, creating])

  function confirmDiscard() {
    return !dirty || globalThis.confirm?.('Discard the unsaved report changes and change the exact selection?') === true
  }

  function updateForm(patch) {
    invalidateDraftSnapshot()
    setForm(current => ({ ...current, ...patch,
      ...('period_start' in patch || 'period_end' in patch ? { metric_snapshot_refs: [] } : {}) }))
    setDirty(true); setLocalError('')
  }

  function chooseReport(nextArtifactId) {
    if (!confirmDiscard()) return
    const next = marketingReportVersion(records, nextArtifactId)
    invalidateDraftSnapshot()
    setCreating(false); setArtifactId(next.record?.artifact.id || ''); setVersionId(next.version?.id || '')
    setForm(marketingReportDraft(next.record?.artifact, next.version)); setDirty(false); setLocalError('')
    loadedSelection.current = next.record && next.version ? `${next.record.artifact.id}:${next.version.id}` : ''
  }

  function chooseVersion(nextVersionId) {
    if (!confirmDiscard()) return
    const next = marketingReportVersion(records, artifactId, nextVersionId)
    invalidateDraftSnapshot()
    setVersionId(next.version?.id || '')
    setForm(marketingReportDraft(next.record?.artifact, next.version)); setDirty(false); setLocalError('')
    loadedSelection.current = next.record && next.version ? `${next.record.artifact.id}:${next.version.id}` : ''
  }

  function startReport() {
    if (!confirmDiscard()) return
    invalidateDraftSnapshot()
    setCreating(true); setArtifactId(''); setVersionId(''); setForm(emptyMarketingReportDraft()); setDirty(false); setLocalError('')
    loadedSelection.current = ''
  }

  async function save(event) {
    event.preventDefault()
    if (saving || pendingSave || inFlightSave.current) return
    if (!recovery.ready || !recovery.storageKey || !recovery.actorHash) {
      setLocalError(recovery.error || 'Verified browser-session recovery is not ready; report saving is disabled.')
      return
    }
    const operationId = globalThis.crypto?.randomUUID?.()
    if (!operationId) {
      setLocalError('A secure report operation identity is unavailable; report saving is disabled.')
      return
    }
    inFlightSave.current = operationId
    const captured = { ...activeTarget.current }
    let attempted = false
    let intent = null
    let persisted = false
    try {
      const validated = validateMarketingReportDraft(form)
      const contentChecksum = await marketingReportContentChecksum(validated.content)
      const currentTarget = activeTarget.current
      const targetStillCurrent = inFlightSave.current === operationId && activeScope.current === captured.scopeKey &&
        currentTarget?.scopeKey === captured.scopeKey && currentTarget.actorId === captured.actorId &&
        currentTarget.artifactId === captured.artifactId && currentTarget.versionId === captured.versionId &&
        currentTarget.creating === captured.creating && currentTarget.draftRevision === captured.draftRevision
      if (!targetStillCurrent) return
      const payload = {
        engagement_id: workspace.engagement.id, artifact_id: captured.artifactId || null,
        expected_latest_version_id: captured.versionId || null, request_id: operationId,
        title: validated.title, content: validated.content,
        change_summary: artifact ? `Report revision from exact version ${version.version_number}` : 'Initial Marketing report version',
        ai_use_allowed: false,
      }
      intent = {
        operationId, actorHash: recovery.actorHash,
        artifactId: captured.artifactId || '', versionId: captured.versionId || '', contentChecksum,
        payloadChecksum: await marketingReportContentChecksum(payload), payload,
        knownVersionIds: records.flatMap(record => record.versions.map(item => item.id)),
      }
      const beforePersist = activeTarget.current
      if (inFlightSave.current !== operationId || activeScope.current !== captured.scopeKey ||
        beforePersist?.scopeKey !== captured.scopeKey || beforePersist.actorId !== captured.actorId ||
        beforePersist.artifactId !== captured.artifactId || beforePersist.versionId !== captured.versionId ||
        beforePersist.creating !== captured.creating || beforePersist.draftRevision !== captured.draftRevision) return
      writePendingSave(recovery.storageKey, intent)
      persisted = true
      setPendingSave(intent)
      const result = await act(() => {
        attempted = true
        return studio.saveMarketingReport(intent.payload)
      }, 'Marketing report saved as a new unapproved immutable version.', '', true)
      if (!attempted) {
        if (clearPendingSave(recovery.storageKey, operationId) && activeScope.current === captured.scopeKey) setPendingSave(null)
        return
      }
      const savedVersion = result?.version || result
      const savedArtifactId = savedVersion?.artifact_id || result?.artifact_id || ''
      const resultMatchesIntent = savedArtifactId && savedVersion?.id &&
        savedVersion.organization_id === workspace.engagement.organization_id &&
        savedVersion.request_id === intent.operationId &&
        (!intent.artifactId || savedArtifactId === intent.artifactId) &&
        !intent.knownVersionIds.includes(savedVersion.id) &&
        await receiptContentMatches(savedVersion, intent.contentChecksum)
      if (!resultMatchesIntent) {
        if (activeScope.current === captured.scopeKey) setLocalError('The save outcome is unresolved. Retry the exact request to obtain its server receipt.')
        return
      }
      const cleared = clearPendingSave(recovery.storageKey, operationId)
      if (cleared && activeScope.current === captured.scopeKey) {
        setPendingSave(null)
        loadedSelection.current = ''
        setCreating(false); setArtifactId(savedArtifactId); setVersionId(savedVersion.id); setDirty(false)
      }
    } catch (error) {
      if (attempted && intent) {
        if (activeScope.current === captured.scopeKey) setLocalError('The report save outcome is unresolved. Retry the exact request; the server will return its receipt or make one atomic save.')
      } else {
        if (persisted && clearPendingSave(recovery.storageKey, operationId) && activeScope.current === captured.scopeKey) setPendingSave(null)
        if (activeScope.current === captured.scopeKey) setLocalError(error.message)
      }
    } finally {
      if (inFlightSave.current === operationId) inFlightSave.current = ''
    }
  }

  async function retryPendingSave() {
    const pending = pendingSave
    if (!pending?.payload || !pending.payloadChecksum || saving || inFlightSave.current || !recovery.ready) return
    const scope = activeScope.current
    inFlightSave.current = pending.operationId
    setRetrying(true)
    try {
      if (pending.payload.engagement_id !== workspace.engagement.id ||
        pending.payload.artifact_id !== (pending.artifactId || null) ||
        pending.payload.expected_latest_version_id !== (pending.versionId || null) ||
        await marketingReportContentChecksum(pending.payload) !== pending.payloadChecksum ||
        await marketingReportContentChecksum(pending.payload.content) !== pending.contentChecksum) {
        throw new Error('The stored exact request changed; recovery remains locked.')
      }
      const result = await studio.saveMarketingReport(pending.payload)
      const version = result?.version || result
      if (version?.request_id !== pending.operationId || version?.organization_id !== workspace.engagement.organization_id ||
        version?.artifact_id !== (pending.artifactId || version?.artifact_id) ||
        !version?.id || !version?.artifact_id || pending.knownVersionIds.includes(version.id) ||
        !await receiptContentMatches(version, pending.contentChecksum)) {
        throw new Error('The server receipt does not match the locked report request.')
      }
      if (scope !== activeScope.current) return
      if (!clearPendingSave(recovery.storageKey, pending.operationId)) throw new Error('The report recovery lock could not be cleared.')
      setPendingSave(null); setLocalError(''); setDirty(false)
      loadedSelection.current = ''
      setCreating(false); setArtifactId(version.artifact_id); setVersionId(version.id)
      await onRefresh?.()
    } catch (error) {
      if (scope === activeScope.current && Number(error?.status) === 412 && clearPendingSave(recovery.storageKey, pending.operationId)) {
        setPendingSave(null)
        setLocalError('The report changed before this request could save. Refresh the exact version, then start a new save.')
        await onRefresh?.()
      } else if (scope === activeScope.current) setLocalError(error.message || 'Exact report recovery failed; the lock remains.')
    } finally {
      if (inFlightSave.current === pending.operationId) inFlightSave.current = ''
      setRetrying(false)
    }
  }

  return <section className="space-y-5">
    <div className="flex flex-wrap items-start justify-between gap-4 rounded-2xl border border-slate-800 bg-slate-900/70 p-5">
      <div><p className="text-xs font-semibold uppercase tracking-[0.14em] text-emerald-400">Report editor</p><h2 className="mt-1 text-xl font-semibold">Exact saved reports and versions</h2><p className="mt-2 max-w-3xl text-sm leading-6 text-slate-400">Create an unapproved report from explicitly named stored evidence, or inspect one immutable saved version. This view does not refresh providers or invent missing metrics.</p></div>
      <button type="button" disabled={Boolean(pendingSave)} onClick={startReport} className={BUTTON}>New report draft</button>
    </div>

    {recovery.error && <div role="alert" className="rounded-2xl border border-red-700/50 bg-red-950/30 p-4 text-sm leading-6 text-red-200">{recovery.error}</div>}
    {pendingSave && <div role="alert" className="rounded-2xl border border-amber-600/50 bg-amber-950/30 p-4 text-sm leading-6 text-amber-100"><p className="font-semibold">Report save outcome is unresolved</p><p className="mt-1">The earlier request may have committed. Retry its exact saved request ID; the server will return the original version or make one atomic save. Matching content alone cannot clear this lock.</p><button type="button" disabled={saving || retrying || !pendingSave.payload || !pendingSave.payloadChecksum} onClick={retryPendingSave} className={`${BUTTON} mt-3`}>{retrying ? 'Reconciling exact request…' : 'Retry exact report request'}</button>{(!pendingSave.payload || !pendingSave.payloadChecksum) && <p className="mt-2 text-xs">This older lock has no exact payload and cannot be safely retried automatically.</p>}</div>}

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
        <div className="rounded-xl border border-slate-700 p-4">
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-400">Pin stored metric snapshots</p>
          <p className="mt-2 text-xs leading-5 text-slate-500">Select exact dated rows from this brand and period. Values and collection times are copied into the saved report version. No provider refresh occurs.</p>
          {metricLoading && <p className="mt-3 text-xs text-slate-400">Loading stored rows…</p>}
          {metricError && <p role="alert" className="mt-3 text-xs text-red-300">{metricError}</p>}
          <div className="mt-3 max-h-56 space-y-2 overflow-y-auto">
            {metricCandidates.slice(0, 200).map(item => {
              const checked = form.metric_snapshot_refs.some(ref => ref.source === item.source && ref.snapshot_id === item.snapshot_id)
              return <label key={`${item.source}:${item.snapshot_id}`} className="flex gap-2 text-xs text-slate-300">
                <input type="checkbox" checked={checked} disabled={Boolean(pendingSave) || (!checked && form.metric_snapshot_refs.length >= 30)}
                  onChange={() => updateForm({ metric_snapshot_refs: checked
                    ? form.metric_snapshot_refs.filter(ref => ref.source !== item.source || ref.snapshot_id !== item.snapshot_id)
                    : [...form.metric_snapshot_refs, { source: item.source, snapshot_id: item.snapshot_id }] })} />
                <span>{item.date} · {item.source.replaceAll('_', ' ')} · {item.label}</span>
              </label>
            })}
          </div>
          {!metricLoading && !metricError && metricCandidates.length === 0 && <p className="mt-3 text-xs text-slate-500">No stored metric rows for this brand and period. The report can still preserve source notes, but its metrics will be unpinned.</p>}
          {metricCandidates.length > 200 && <p className="mt-2 text-xs text-amber-200">Showing the latest 200 rows. Narrow the report period to select older rows.</p>}
          <p className="mt-2 text-xs text-slate-500">{form.metric_snapshot_refs.length} selected · maximum 30. Currency, timezone, and provider finality remain unknown where the stored source does not supply them.</p>
        </div>
        <Field label="Executive summary"><textarea required rows="5" className={INPUT} value={form.executive_summary} onChange={event => updateForm({ executive_summary: event.target.value })} /></Field>
        <Field label="Insights" hint="One evidenced interpretation per line"><textarea required rows="5" className={INPUT} value={editorValue(form.insights)} onChange={event => updateForm({ insights: event.target.value })} /></Field>
        <Field label="Recommended actions" hint="One proposed action per line"><textarea required rows="5" className={INPUT} value={editorValue(form.recommended_actions)} onChange={event => updateForm({ recommended_actions: event.target.value })} /></Field>
        <div className="flex justify-end border-t border-slate-800 pt-5"><button disabled={saving || !recovery.ready || Boolean(pendingSave) || (!creating && !version)} className={PRIMARY}>{pendingSave ? 'Save locked — retry exact request' : !recovery.ready ? 'Save unavailable — recovery not ready' : saving ? 'Saving report...' : artifact ? 'Save new draft version' : 'Save first draft version'}</button></div>
      </form>

      <div className="space-y-4">
        <article className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5">
          <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs font-semibold uppercase tracking-[0.14em] text-emerald-400">Exact version preview</p><h3 className="mt-1 text-lg font-semibold">{version ? (version.content?.report_title || artifact.title) : 'No saved version selected'}</h3></div>{version && <span className={`rounded-full px-3 py-1 text-xs font-semibold ${reviewState === 'approved' ? 'bg-emerald-950 text-emerald-300' : 'bg-amber-950 text-amber-200'}`}>{reviewState === 'approved' ? 'Approved exact version' : 'Draft - not approved'}</span>}</div>
          {!version ? <p className="mt-5 text-sm text-slate-500">Save a draft or choose an existing report to preview its persisted content.</p> : <div className="mt-5 space-y-5">
            <p className="text-sm text-slate-400">{version.content.period_start} to {version.content.period_end} · Version {version.version_number}</p>
            <div className="rounded-xl border border-amber-900/50 bg-amber-950/20 p-3 text-xs leading-5 text-amber-200">{evidenceState.message}</div>
            <div><h4 className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Selected source notes</h4>{list(version.content.sources)}</div>
            <div><h4 className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Pinned metric snapshots</h4>
              {Array.isArray(version.content.metric_snapshots) && version.content.metric_snapshots.length
                ? <ul className="mt-2 space-y-2 text-xs text-slate-300">{version.content.metric_snapshots.map(pin =>
                  <li key={`${pin.source}:${pin.source_record_id}`} className="rounded-lg border border-slate-800 p-2">{pin.snapshot_date} · {pin.source?.replaceAll('_', ' ')} · {pin.label} · collected {pin.retrieved_at || 'unknown'} · age at pin {marketingReportMetricFreshness(pin).age_hours === null ? 'unknown' : `${marketingReportMetricFreshness(pin).age_hours}h`} · {Object.entries(pin.metrics || {}).map(([key, value]) => `${key}: ${value ?? 'unknown'}`).join(' · ')}</li>)}</ul>
                : <p className="mt-2 text-xs text-slate-500">No metric rows pinned in this version.</p>}
            </div>
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
