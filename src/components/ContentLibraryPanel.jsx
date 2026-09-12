import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import ArtifactApprovalPanel from './ArtifactApprovalPanel.jsx'
import VersionProofingPanel from './VersionProofingPanel.jsx'
import { CONTENT_ARTIFACT_FORMS } from '../data/contentStudio.js'
import {
  buildContentLibrary,
  contentReviewStage,
  filterContentLibrary,
  sourceReferenceDetails,
} from '../data/contentLibrary.js'

const INPUT = 'w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm text-white outline-none focus:border-amber-500'
const SECONDARY = 'rounded-xl border border-slate-700 px-3 py-2 text-xs font-semibold text-slate-200 hover:border-amber-500 disabled:opacity-50'
const STAGE = {
  draft: ['Draft', 'bg-slate-800 text-slate-300'],
  in_review: ['In review', 'bg-amber-950 text-amber-300'],
  approved: ['Approved', 'bg-emerald-950 text-emerald-300'],
}

function displayName(profile) {
  return profile?.full_name || profile?.email || 'Team member'
}

function typeLabel(type) {
  return CONTENT_ARTIFACT_FORMS[type]?.label || String(type || '').replaceAll('_', ' ')
}

function contentValue(value) {
  if (value === null || value === undefined || value === '') return <span className="text-slate-600">Not recorded</span>
  if (typeof value === 'boolean') return value ? 'Yes' : 'No'
  if (Array.isArray(value)) return value.length
    ? <ul className="space-y-1">{value.map((item, index) => <li key={index} className="rounded-lg bg-slate-950/70 px-3 py-2">{typeof item === 'object' ? <pre className="overflow-x-auto whitespace-pre-wrap text-xs">{JSON.stringify(item, null, 2)}</pre> : String(item)}</li>)}</ul>
    : <span className="text-slate-600">None recorded</span>
  if (typeof value === 'object') return <pre className="overflow-x-auto whitespace-pre-wrap rounded-lg bg-slate-950/70 p-3 text-xs leading-5 text-slate-300">{JSON.stringify(value, null, 2)}</pre>
  return <span className="whitespace-pre-wrap">{String(value)}</span>
}

export default function ContentLibraryPanel({ repository }) {
  const [data, setData] = useState(null)
  const [filters, setFilters] = useState({ query: '', type: '', projectId: '', creatorId: '', reviewStage: '' })
  const [artifactId, setArtifactId] = useState('')
  const [versionId, setVersionId] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const [stale, setStale] = useState(false)
  const loadSequence = useRef(0)
  const mounted = useRef(true)
  const dataRef = useRef(data)
  dataRef.current = data
  const load = useCallback(async () => {
    const sequence = ++loadSequence.current
    setLoading(true); setError('')
    try {
      const next = await repository.loadLibrary()
      if (mounted.current && sequence === loadSequence.current) {
        setData(next); setStale(false)
      }
    } catch (reason) {
      if (reason?.name !== 'AbortError' && mounted.current && sequence === loadSequence.current) {
        const denied = [401, 403].includes(Number(reason?.status)) || reason?.membershipMismatch
        if (denied) { setData(null); setArtifactId(''); setVersionId('') }
        else setStale(Boolean(dataRef.current))
        setError(reason.message)
      }
    } finally {
      if (mounted.current && sequence === loadSequence.current) setLoading(false)
    }
  }, [repository])

  useEffect(() => {
    mounted.current = true
    load()
    return () => { mounted.current = false; loadSequence.current += 1 }
  }, [load])

  const entries = useMemo(() => buildContentLibrary({
    artifacts: data?.artifacts, versions: data?.versions, approvals: data?.approvals,
    requests: data?.approvalRequests, comments: data?.comments, profiles: data?.profiles,
  }), [data])
  const visible = useMemo(() => filterContentLibrary(entries, filters), [entries, filters])
  const selectedEntry = visible.find(item => item.artifact.id === artifactId) || visible[0] || null
  const selectedVersion = selectedEntry?.versions.find(item => item.id === versionId)
    || selectedEntry?.latest || null
  const approval = data?.approvals?.find(item => item.artifact_version_id === selectedVersion?.id) || null
  const request = data?.approvalRequests?.find(item => item.artifact_version_id === selectedVersion?.id) || null
  const reviewStage = selectedVersion ? contentReviewStage(selectedVersion.id, data?.approvals, data?.approvalRequests) : 'draft'
  const openCommentCount = (data?.comments || []).filter(item => item.artifact_version_id === selectedVersion?.id && !item.resolved).length
  const stage = STAGE[reviewStage] || STAGE.draft
  const artifactById = new Map((data?.artifacts || []).map(item => [item.id, item]))
  const accessibleVersions = [
    ...(data?.versions || []).map(item => ({ ...item, artifacts: artifactById.get(item.artifact_id) })),
    ...(data?.sourceVersions || []),
  ]
  const sourceReferences = sourceReferenceDetails(selectedVersion, accessibleVersions)
  const projects = [...new Map(entries.filter(item => item.engagement?.project_id)
    .map(item => [item.engagement.project_id, item.project?.name || item.engagement?.name || item.engagement.project_id])).entries()]
  const creators = [...new Map(entries.map(item => [item.artifact.created_by, displayName(item.creator)])).entries()]
  const types = [...new Set(entries.map(item => item.artifact.artifact_type))].sort()

  function updateFilter(key, value) {
    setFilters(current => ({ ...current, [key]: value }))
  }

  if (loading && !data) return <div className="py-20 text-center text-sm text-slate-500">Loading the authorized Content library...</div>
  if (error && !data) return <div className="rounded-2xl border border-red-900/60 bg-red-950/30 p-6 text-sm text-red-300"><p>{error}</p><button type="button" onClick={load} className={`${SECONDARY} mt-4`}>Try again</button></div>

  return <section className="space-y-6">
    <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-6">
      <div className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-xs font-semibold uppercase tracking-[0.14em] text-amber-400">Content B06a</p><h2 className="mt-1 text-2xl font-semibold">Content library and review</h2><p className="mt-2 max-w-3xl text-sm leading-6 text-slate-400">Find saved Content artifacts in your current authorized organization, open an exact immutable version, inspect its recorded sources, and use the existing review route. Submission is not approval.</p><p className="mt-2 max-w-3xl text-xs leading-5 text-amber-300">Owner filtering is unavailable because canonical artifacts do not record an owner. Creator is available as a factual filter; no ownership has been inferred.</p></div><button type="button" onClick={load} disabled={loading} className={SECONDARY}>{loading ? 'Refreshing...' : 'Refresh'}</button></div>
      <div className="mt-6 grid gap-3 md:grid-cols-2 xl:grid-cols-5">
        <label className="text-xs text-slate-500">Search<input className={`${INPUT} mt-1`} value={filters.query} onChange={event => updateFilter('query', event.target.value)} placeholder="Title, project, owner" /></label>
        <label className="text-xs text-slate-500">Type<select className={`${INPUT} mt-1`} value={filters.type} onChange={event => updateFilter('type', event.target.value)}><option value="">All types</option>{types.map(type => <option key={type} value={type}>{typeLabel(type)}</option>)}</select></label>
        <label className="text-xs text-slate-500">Project<select className={`${INPUT} mt-1`} value={filters.projectId} onChange={event => updateFilter('projectId', event.target.value)}><option value="">All projects</option>{projects.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label>
        <label className="text-xs text-slate-500">Creator<select className={`${INPUT} mt-1`} value={filters.creatorId} onChange={event => updateFilter('creatorId', event.target.value)}><option value="">All creators</option>{creators.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label>
        <label className="text-xs text-slate-500">Review state<select className={`${INPUT} mt-1`} value={filters.reviewStage} onChange={event => updateFilter('reviewStage', event.target.value)}><option value="">All states</option>{Object.entries(STAGE).map(([id, [label]]) => <option key={id} value={id}>{label}</option>)}</select></label>
      </div>
    </div>

    {error && data && <div className="rounded-2xl border border-red-900/60 bg-red-950/30 p-4 text-sm text-red-300"><p>{error}</p><p className="mt-1 text-xs text-red-200/80">The displayed library snapshot may be stale. Review and approval actions are unavailable until a refresh succeeds.</p><button type="button" onClick={load} className={`${SECONDARY} mt-3`}>Try again</button></div>}

    {!entries.length ? <div className="rounded-2xl border border-dashed border-slate-700 p-12 text-center text-sm text-slate-500">No saved Content artifacts are visible in this organization.</div> : !visible.length ? <div className="rounded-2xl border border-dashed border-slate-700 p-12 text-center text-sm text-slate-500">No Content artifacts match these filters. The library has not treated this as a loading error.</div> : <div className="grid gap-6 xl:grid-cols-[340px_minmax(0,1fr)]">
      <div className="space-y-3">{visible.map(entry => { const itemStage = STAGE[entry.reviewStage] || STAGE.draft; return <button type="button" key={entry.artifact.id} onClick={() => { setArtifactId(entry.artifact.id); setVersionId(entry.latest?.id || '') }} className={`w-full rounded-2xl border p-4 text-left ${selectedEntry?.artifact.id === entry.artifact.id ? 'border-amber-500/60 bg-amber-950/20' : 'border-slate-800 bg-slate-900/70 hover:border-slate-700'}`}>
        <div className="flex items-start justify-between gap-3"><h3 className="font-semibold text-white">{entry.artifact.title}</h3><span className={`shrink-0 rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase ${itemStage[1]}`}>{itemStage[0]}</span></div>
        <p className="mt-2 text-xs text-slate-400">{typeLabel(entry.artifact.artifact_type)} - {entry.latest ? `v${entry.latest.version_number}` : 'No saved version'}</p>
        <p className="mt-2 text-[11px] text-slate-600">{entry.project?.name || entry.engagement?.name || 'Project unavailable'} - created by {displayName(entry.creator)}</p>
      </button> })}</div>

      {selectedEntry && selectedVersion && <div>
        <article className="rounded-2xl border border-slate-800 bg-slate-900/70 p-6">
          <div className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-xs font-semibold uppercase tracking-[0.14em] text-amber-400">Read-only exact snapshot</p><h2 className="mt-1 text-2xl font-semibold">{selectedEntry.artifact.title}</h2><p className="mt-2 text-sm text-slate-400">{selectedEntry.project?.name || selectedEntry.engagement?.name || 'Project unavailable'} - created by {displayName(selectedEntry.creator)}</p></div><span className={`rounded-full px-3 py-1.5 text-xs font-semibold uppercase ${stage[1]}`}>{stage[0]}</span></div>
          <label className="mt-5 block text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Exact saved version<select className={`${INPUT} mt-2 normal-case tracking-normal`} value={selectedVersion.id} onChange={event => setVersionId(event.target.value)}>{selectedEntry.versions.map(version => <option key={version.id} value={version.id}>Version {version.version_number} - {new Date(version.created_at).toLocaleString()}</option>)}</select></label>
          <dl className="mt-5 grid gap-3 text-sm md:grid-cols-2"><Meta label="Version ID" value={selectedVersion.id} /><Meta label="Checksum" value={selectedVersion.content_checksum} /><Meta label="Change summary" value={selectedVersion.change_summary || 'No summary recorded'} /><Meta label="Classification" value={selectedVersion.data_classification} /></dl>
          <div className="mt-6 border-t border-slate-800 pt-5"><h3 className="font-semibold text-white">Saved content</h3><dl className="mt-4 space-y-4">{Object.entries(selectedVersion.content || {}).map(([key, value]) => <div key={key}><dt className="text-xs font-semibold uppercase tracking-[0.1em] text-slate-500">{key.replaceAll('_', ' ')}</dt><dd className="mt-1 text-sm leading-6 text-slate-300">{contentValue(value)}</dd></div>)}</dl></div>
          <div className="mt-6 border-t border-slate-800 pt-5"><h3 className="font-semibold text-white">Recorded source versions</h3>{sourceReferences.length ? <div className="mt-3 space-y-2">{sourceReferences.map(reference => <div key={`${reference.path}:${reference.id}`} className="rounded-xl border border-slate-800 bg-slate-950/60 p-3"><p className="text-sm font-semibold text-slate-200">{reference.accessible ? `${reference.artifact?.title || 'Source artifact'} - version ${reference.version.version_number}` : 'Recorded source is not accessible in the current scope'}</p><p className="mt-1 break-all text-[11px] text-slate-500">{reference.path} - {reference.id}</p></div>)}</div> : <p className="mt-3 rounded-xl border border-dashed border-slate-800 p-4 text-sm text-slate-500">This exact version records no source-version links. No newer source has been substituted.</p>}</div>
          {request?.status === 'pending' && <p className="mt-5 rounded-xl border border-amber-900/50 bg-amber-950/20 p-3 text-xs leading-5 text-amber-200">This exact version has a pending governed review request and {openCommentCount} open proofing comment{openCommentCount === 1 ? '' : 's'}. Open comments are feedback, not a formal review decision; later drafts inherit neither this request nor approval.</p>}
        </article>
        {!error && !stale && <ArtifactApprovalPanel key={`approval:${selectedVersion.id}`} version={selectedVersion} approval={approval} theme="amber" requestLabel="Submit exact version for review" singleApprovalLabel={`Use single-manager route for version ${selectedVersion.version_number}`} onSingleApprove={() => repository.approveArtifact(selectedVersion.id)} onChanged={load} />}
        {!error && !stale && <VersionProofingPanel key={`proofing:${selectedVersion.id}`} targetKind="artifact" versions={[selectedVersion]} initialVersionId={selectedVersion.id} department="content" theme="amber" onChanged={load} />}
      </div>}
    </div>}
  </section>
}

function Meta({ label, value }) {
  return <div className="rounded-xl bg-slate-950/60 p-3"><dt className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-600">{label}</dt><dd className="mt-1 break-all text-xs text-slate-300">{value}</dd></div>
}
