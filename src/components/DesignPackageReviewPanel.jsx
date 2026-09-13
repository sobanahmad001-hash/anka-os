import { useEffect, useMemo, useRef, useState } from 'react'

import {
  designPackageReviewEntries,
  designPackageReviewReadiness,
} from '../data/designDeliveryPackages.js'
import ArtifactApprovalPanel from './ArtifactApprovalPanel.jsx'
import VersionProofingPanel from './VersionProofingPanel.jsx'

const SECONDARY = 'rounded-xl border border-slate-700 px-3 py-2 text-xs font-semibold text-slate-200 hover:border-slate-500 disabled:cursor-not-allowed disabled:opacity-40'

function workLabel(context) {
  if (context?.project_task_id) return `Project task · ${context.project_task_id}`
  if (context?.engagement_work_item_id) return `Engagement work item · ${context.engagement_work_item_id}`
  return 'Stored work unavailable'
}

function assetDetails(reference, workspace) {
  const version = workspace.designAssetVersions.find(item =>
    item.id === reference.design_asset_version_id && item.asset_id === reference.design_asset_id)
  const asset = workspace.designAssets.find(item => item.id === reference.design_asset_id)
  return { reference, version, asset }
}

export default function DesignPackageReviewPanel({
  workspace,
  reviewAvailable,
  snapshotFresh,
  onRefresh,
}) {
  const entries = useMemo(() => designPackageReviewEntries(workspace), [workspace])
  const [selectedVersionId, setSelectedVersionId] = useState(entries[0]?.version.id || '')
  const [reviewEpoch, setReviewEpoch] = useState(0)
  const [refreshing, setRefreshing] = useState(false)
  const [refreshError, setRefreshError] = useState('')
  const [submissionLocks, setSubmissionLocks] = useState([])
  const [reviewChangedTarget, setReviewChangedTarget] = useState('')
  const refreshLock = useRef(false)
  const submissionLocksRef = useRef(new Set())
  const selectedVersionRef = useRef(entries[0]?.version.id || '')
  const mountedRef = useRef(true)
  const selected = entries.find(entry => entry.version.id === selectedVersionId) || entries[0] || null
  const readiness = designPackageReviewReadiness(selected, workspace)
  const selectedAssets = selected?.references.map(reference => assetDetails(reference, workspace)) || []
  selectedVersionRef.current = selected?.version.id || ''

  useEffect(() => {
    if (!selected && selectedVersionId) setSelectedVersionId('')
    else if (selected && selected.version.id !== selectedVersionId) setSelectedVersionId(selected.version.id)
  }, [selected, selectedVersionId])
  useEffect(() => () => { mountedRef.current = false }, [])

  function setSubmissionLocked(targetId, locked) {
    const next = new Set(submissionLocksRef.current)
    if (locked) next.add(targetId); else next.delete(targetId)
    submissionLocksRef.current = next
    if (mountedRef.current) setSubmissionLocks([...next])
  }

  function captureApprovalSubmit(event) {
    const button = event.target?.closest?.('button') || event.target
    if (button?.textContent?.trim() !== 'Submit exact package version for review') return
    const targetId = selected?.version.id
    if (targetId && !submissionLocksRef.current.has(targetId)) setSubmissionLocked(targetId, true)
  }

  function approvalChanged(targetId) {
    setSubmissionLocked(targetId, false)
    if (!mountedRef.current || selectedVersionRef.current !== targetId) return
    setReviewChangedTarget(targetId)
  }

  function proofingChanged(targetId) {
    if (!mountedRef.current || selectedVersionRef.current !== targetId) return
    setReviewChangedTarget(targetId)
  }

  async function refreshReviewStatus() {
    if (refreshLock.current) return
    const targetId = selected?.version.id
    if (!targetId) return
    refreshLock.current = true
    setRefreshing(true)
    setRefreshError('')
    try {
      await onRefresh()
      if (mountedRef.current && selectedVersionRef.current === targetId) {
        setSubmissionLocked(targetId, false)
        setReviewChangedTarget('')
        setReviewEpoch(value => value + 1)
      }
    } catch (reason) {
      setRefreshError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      refreshLock.current = false
      setRefreshing(false)
    }
  }

  if (!entries.length) return <section className="mt-6 rounded-2xl border border-dashed border-slate-700 p-8 text-center">
    <p className="text-xs font-semibold uppercase tracking-wider text-violet-300">Design S07 · Submit and review</p>
    <h2 className="mt-2 text-xl font-semibold">No saved package version yet</h2>
    <p className="mt-2 text-sm text-slate-500">Preview and save an unapproved package above before selecting an exact immutable version for review.</p>
  </section>

  const status = selected.approval ? 'Approved' : 'Unapproved'
  const storedContent = selected.version.content || {}
  const submissionLocked = submissionLocks.includes(selected.version.id)
  return <section aria-labelledby="design-package-review-title" className="mt-6 rounded-2xl border border-blue-400/20 bg-slate-900/70 p-5">
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div>
        <p className="text-xs font-semibold uppercase tracking-wider text-blue-300">Design S07 · Submit and review</p>
        <h2 id="design-package-review-title" className="mt-2 text-xl font-semibold">Exact package version review</h2>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-400">Select one immutable package version, route it through the existing named-approver policy, and keep feedback pinned to that same version. Submission never releases or publishes it.</p>
      </div>
      <span className={`rounded-full px-3 py-1 text-xs font-semibold ${selected.approval ? 'bg-emerald-500/15 text-emerald-200' : 'bg-amber-500/15 text-amber-200'}`}>{status}</span>
    </div>

    <div className="mt-5 flex flex-wrap items-end gap-3">
      <label className="min-w-72 flex-1 text-xs font-semibold uppercase tracking-wider text-slate-500">Exact saved package version
        <select aria-label="Exact saved package version" value={selected.version.id} onChange={event => { setSelectedVersionId(event.target.value); setRefreshError(''); setReviewChangedTarget('') }} className="mt-2 w-full rounded-xl border border-white/10 bg-slate-950/70 px-3 py-2.5 text-sm font-normal normal-case tracking-normal text-white">
          {entries.map(entry => <option key={entry.version.id} value={entry.version.id}>{entry.artifact.title} · version {entry.version.version_number} · {new Date(entry.version.created_at).toLocaleString()}</option>)}
        </select>
      </label>
      <button type="button" disabled={refreshing} onClick={refreshReviewStatus} className={SECONDARY}>{refreshing ? 'Refreshing…' : 'Refresh review status'}</button>
    </div>
    <p className="mt-2 text-xs text-slate-500">If a submission response was interrupted, refresh first. The existing exact-version request is read back before another action is offered.</p>
    {refreshError && <p role="alert" className="mt-3 rounded-xl border border-red-900/60 bg-red-950/30 p-3 text-sm text-red-300">{refreshError}</p>}
    {submissionLocked && <p role="status" className="mt-3 rounded-xl border border-blue-900/60 bg-blue-950/30 p-3 text-sm text-blue-200">This exact-version submission is being confirmed and remains locked. Lost response or delayed confirmation can mean the server already holds the request; refresh review status before submitting again.</p>}
    {reviewChangedTarget === selected.version.id && <p role="status" className="mt-3 text-xs text-slate-400">Review state changed. The panel is current; refresh when you want to reconcile the package-level approval badge.</p>}

    <article className="mt-5 rounded-2xl border border-slate-800 bg-slate-950/45 p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div><p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Read-only exact snapshot</p><h3 className="mt-1 text-lg font-semibold text-white">{selected.artifact.title} · version {selected.version.version_number}</h3></div>
        <span className="text-xs text-slate-500">Saved {new Date(selected.version.created_at).toLocaleString()}</span>
      </div>
      <dl className="mt-4 grid gap-3 text-xs md:grid-cols-2">
        <Meta label="Version ID" value={selected.version.id} />
        <Meta label="Checksum" value={selected.version.content_checksum || 'Unavailable'} />
        <Meta label="Stored work" value={workLabel(selected.context)} />
        <Meta label="Destination" value={`${storedContent.destination_type || 'Unavailable'} · ${storedContent.placement_label || 'Placement unavailable'}`} />
      </dl>
      <div className="mt-5 border-t border-slate-800 pt-4">
        <h4 className="text-sm font-semibold text-white">Pinned Design outputs</h4>
        <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {selectedAssets.map(({ reference, asset, version }) => <figure key={reference.design_asset_version_id} className="rounded-xl border border-slate-800 bg-slate-950/60 p-3">
            {version?.signed_url ? <img className="aspect-video w-full rounded-lg object-cover" src={version.signed_url} alt={`Exact review output ${asset?.name || reference.design_asset_id}`} /> : <div className="flex aspect-video items-center justify-center rounded-lg border border-dashed border-slate-700 text-xs text-slate-600">Preview unavailable</div>}
            <figcaption className="mt-2 text-xs text-slate-400"><span className="font-semibold text-slate-200">{asset?.name || 'Design asset'}</span> · version {version?.version_number || '?'}<span className="mt-1 block break-all text-[10px] text-slate-600">{reference.design_asset_version_id}</span></figcaption>
          </figure>)}
        </div>
      </div>
    </article>

    {!snapshotFresh && <p role="alert" className="mt-4 rounded-xl border border-red-900/60 bg-red-950/30 p-3 text-sm text-red-300">The current access snapshot is stale. Refresh successfully before review or feedback actions.</p>}
    {snapshotFresh && !readiness.ready && <p role="alert" className="mt-4 rounded-xl border border-amber-900/60 bg-amber-950/30 p-3 text-sm text-amber-200">Review submission is blocked locally: {readiness.missing.join(', ')}. The server also rechecks package context, services, work, exact versions, and objects.</p>}
    {snapshotFresh && readiness.ready && !reviewAvailable && <p className="mt-4 rounded-xl border border-amber-900/60 bg-amber-950/30 p-3 text-sm text-amber-200">Review submission is unavailable until the current official work context and existing server capability are valid.</p>}

    {snapshotFresh && readiness.ready && reviewAvailable && !submissionLocked && <div onClickCapture={captureApprovalSubmit}>
      <ArtifactApprovalPanel
        key={`design-package-approval:${selected.version.id}:${reviewEpoch}`}
        version={selected.version}
        approval={selected.approval}
        theme="blue"
        requestLabel="Submit exact package version for review"
        onChanged={() => approvalChanged(selected.version.id)}
      />
    </div>}
    {snapshotFresh && <VersionProofingPanel
      key={`design-package-proofing:${selected.version.id}:${reviewEpoch}`}
      targetKind="artifact"
      versions={[selected.version]}
      initialVersionId={selected.version.id}
      department="design"
      theme="violet"
      onChanged={() => proofingChanged(selected.version.id)}
    />}
  </section>
}

function Meta({ label, value }) {
  return <div className="rounded-xl bg-slate-900/70 p-3"><dt className="text-[10px] font-semibold uppercase tracking-wider text-slate-600">{label}</dt><dd className="mt-1 break-all text-xs text-slate-300">{value}</dd></div>
}
