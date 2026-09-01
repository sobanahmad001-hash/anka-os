import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  ARTIFACT_RELATION_TYPES,
  artifactSurfacePath,
  artifactTypeLabel,
  relationTypeLabel,
  requestSummary,
  splitArtifactRelations,
} from '../data/artifactRelations.js'
import { artifactRelations } from '../data/artifactRelationsRepository.js'

const INPUT = 'w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm text-white outline-none focus:border-cyan-500'

export default function ArtifactRelationsPanel({ artifact, requestContext }) {
  const [relations, setRelations] = useState([])
  const [candidates, setCandidates] = useState([])
  const [requestCandidates, setRequestCandidates] = useState([])
  const [releasedDesignSystemVersions, setReleasedDesignSystemVersions] = useState({})
  const [targetKind, setTargetKind] = useState('artifact')
  const [targetId, setTargetId] = useState('')
  const [relationType, setRelationType] = useState('feeds_into')
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const isRequestTargetMode = Boolean(requestContext?.id)

  const load = useCallback(async () => {
    const sourceArtifactId = artifact?.id
    const requestTargetId = requestContext?.id
    const organizationId = requestContext?.organizationId

    if (!isRequestTargetMode && !sourceArtifactId) return
    if (isRequestTargetMode && (!requestTargetId || !organizationId)) return

    setLoading(true)
    setError('')
    try {
      if (isRequestTargetMode) {
        const [relationRows, artifactRows, releasedRows] = await Promise.all([
          artifactRelations.listForRequest(requestTargetId),
          artifactRelations.sourceCandidates({ organizationId }),
          artifactRelations.releasedDesignSystemVersions(),
        ])

        setRelations(relationRows || [])
        setCandidates(artifactRows || [])
        setRequestCandidates([])
        setReleasedDesignSystemVersions((releasedRows || []).reduce((latest, approval) => {
          const version = Array.isArray(approval.artifact_versions) ? approval.artifact_versions[0] : approval.artifact_versions
          const number = Number(version?.version_number || 0)
          return { ...latest, [approval.artifact_id]: Math.max(Number(latest[approval.artifact_id] || 0), number) }
        }, {}))
      } else {
        const [relationRows, artifactRows, requestRows, releasedRows] = await Promise.all([
          artifactRelations.list(sourceArtifactId),
          artifactRelations.candidates(artifact),
          artifactRelations.requestCandidates(artifact),
          artifactRelations.releasedDesignSystemVersions(),
        ])
        setRelations(relationRows || [])
        setCandidates(artifactRows || [])
        setRequestCandidates(requestRows || [])
        setReleasedDesignSystemVersions((releasedRows || []).reduce((latest, approval) => {
          const version = Array.isArray(approval.artifact_versions) ? approval.artifact_versions[0] : approval.artifact_versions
          const number = Number(version?.version_number || 0)
          return { ...latest, [approval.artifact_id]: Math.max(Number(latest[approval.artifact_id] || 0), number) }
        }, {}))
      }
    } catch (reason) {
      setError(reason.message)
    } finally {
      setLoading(false)
    }
  }, [artifact, isRequestTargetMode, requestContext])

  useEffect(() => {
    load()
  }, [load])

  const filteredCandidates = useMemo(() => {
    const query = search.trim().toLowerCase()
    return candidates.filter(candidate => {
      if (candidate.artifact_type === 'design_system' && !releasedDesignSystemVersions[candidate.id]) return false
      return !query || `${candidate.title} ${candidate.artifact_type}`.toLowerCase().includes(query)
    })
  }, [candidates, search, releasedDesignSystemVersions])

  const filteredRequests = useMemo(() => {
    const query = search.trim().toLowerCase()
    return requestCandidates.filter(request => {
      return !query || `${request.format || ''} ${request.status || ''} ${request.brief || ''}`.toLowerCase().includes(query)
    })
  }, [requestCandidates, search])

  const groupedRelations = useMemo(() => {
    if (isRequestTargetMode) {
      return {
        outgoing: relations.filter(relation => relation.target_content_request_id && relation.source),
      }
    }
    return splitArtifactRelations(artifact?.id, relations)
  }, [isRequestTargetMode, artifact?.id, relations])

  const requestSourceRelations = isRequestTargetMode
    ? groupedRelations.outgoing.map(relation => ({
      ...relation,
      relatedArtifact: relation.source,
    }))
    : []

  async function create(event) {
    event.preventDefault()
    if (!targetId) return

    const sourceArtifactId = isRequestTargetMode ? targetId : artifact.id
    const targetArtifactId = isRequestTargetMode
      ? ''
      : targetKind === 'artifact'
        ? targetId
        : ''
    const targetContentRequestId = isRequestTargetMode
      ? requestContext.id
      : targetKind === 'content_request'
        ? targetId
        : ''

    setLoading(true)
    setError('')

    try {
      await artifactRelations.create(
        sourceArtifactId,
        targetArtifactId,
        relationType,
        targetContentRequestId,
      )
      setTargetId('')
      setSearch('')
      await load()
    } catch (reason) {
      setError(reason.message)
      setLoading(false)
    }
  }

  async function remove(relationId) {
    setLoading(true)
    setError('')
    try {
      await artifactRelations.remove(relationId)
      await load()
    } catch (reason) {
      setError(reason.message)
      setLoading(false)
    }
  }

  if (!artifact?.id && !isRequestTargetMode) return null

  return <section className="mt-6 rounded-2xl border border-cyan-500/20 bg-slate-950/55 p-5">
    <div>
      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-cyan-300">Used in / related</p>
      <h3 className="mt-1 font-semibold text-white">Artifact relations</h3>
      <p className="mt-1 text-xs leading-5 text-slate-500">Live links only. Both artifacts and requests must remain visible to you for a relation to appear.</p>
    </div>
    {error && <div className="mt-4 rounded-xl border border-red-900/50 bg-red-950/30 px-3 py-2 text-sm text-red-300">{error}</div>}

    {isRequestTargetMode ? (
      <RelationList
        title="This request links from"
        direction="Incoming source artifacts"
        items={requestSourceRelations}
        loading={loading}
        onRemove={remove}
      />
    ) : (
      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <RelationList title="This artifact relates to" direction="Outgoing" items={groupedRelations.outgoing} loading={loading} onRemove={remove} />
        <RelationList title="Artifacts relating here" direction="Incoming" items={groupedRelations.incoming} loading={loading} onRemove={remove} />
      </div>
    )}

    <form onSubmit={create} className="mt-5 border-t border-slate-800 pt-5">
      <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Add a new {isRequestTargetMode ? 'source artifact relation' : 'relation target'}</p>
      <div className="mt-3 grid gap-3 lg:grid-cols-[180px_1fr_180px_auto]">
        {isRequestTargetMode ? null : (
          <select className={INPUT} value={targetKind} onChange={event => { setTargetKind(event.target.value); setTargetId('') }}>
            <option value="artifact">Artifact</option>
            <option value="content_request">Content request</option>
          </select>
        )}
        <div className="space-y-2">
          <input
            className={INPUT}
            value={search}
            onChange={event => setSearch(event.target.value)}
            placeholder={isRequestTargetMode || targetKind === 'artifact'
              ? 'Search visible artifacts by title or type'
              : 'Search visible requests by format or status'}
          />
          <select
            required
            className={INPUT}
            value={targetId}
            onChange={event => setTargetId(event.target.value)}
          >
            <option value="">Select a {isRequestTargetMode || targetKind === 'artifact' ? 'artifact' : 'content request'}</option>
            {(isRequestTargetMode || targetKind === 'artifact')
              ? filteredCandidates.map(artifact => <option key={artifact.id} value={artifact.id}>{artifact.title} · {artifactTypeLabel(artifact.artifact_type)}{artifact.artifact_type === 'design_system' ? ` · Released v${releasedDesignSystemVersions[artifact.id]}` : ''}</option>)
              : filteredRequests.map(request => <option key={request.id} value={request.id}>{requestSummary(request)} · {request.brief?.slice(0, 36).trim()}</option>)}
          </select>
        </div>
        <select className={INPUT} value={relationType} onChange={event => setRelationType(event.target.value)}>
          {ARTIFACT_RELATION_TYPES.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
        </select>
        <button disabled={loading || !targetId} className="h-fit rounded-xl bg-cyan-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-cyan-600 disabled:opacity-50">{loading ? 'Saving…' : 'Save link'}</button>
      </div>
    </form>
  </section>
}

function RelationList({ title, direction, items, loading, onRemove }) {
  return <div>
    <div className="flex items-center justify-between gap-3"><h4 className="text-sm font-semibold text-slate-200">{title}</h4><span className="text-[10px] uppercase tracking-[0.12em] text-slate-600">{direction}</span></div>
    <div className="mt-3 space-y-2">
      {items.map(item => <article key={item.id} className="rounded-xl border border-slate-800 bg-slate-900/60 p-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            {item.relatedArtifact ? <>
              <Link to={artifactSurfacePath(item.relatedArtifact)} className="text-sm font-semibold text-white hover:text-cyan-300">{item.relatedArtifact.title}</Link>
              <p className="mt-1 text-[11px] text-slate-500">{item.relatedArtifact.artifact_type === 'design_system' ? `Design System · ${relationTypeLabel(item.relation_type)}` : `${artifactTypeLabel(item.relatedArtifact.artifact_type)} · ${relationTypeLabel(item.relation_type)}`}</p>
            </> : item.relatedRequest ? <>
              <p className="text-sm font-semibold text-white">{item.relatedRequest.title || 'Unnamed content request'}</p>
              <p className="mt-1 text-[11px] text-slate-500">{requestSummary(item.relatedRequest)} · {relationTypeLabel(item.relation_type)}</p>
            </> : <p className="text-sm font-semibold text-white">Relation target is not visible</p>}
          </div>
          <button type="button" disabled={loading} onClick={() => onRemove(item.id)} className="text-[11px] font-semibold text-slate-500 hover:text-red-300">Unlink</button>
        </div>
      </article>)}
      {!items.length && <p className="rounded-xl border border-dashed border-slate-800 px-3 py-5 text-center text-xs text-slate-600">{loading ? 'Loading relations…' : 'None yet.'}</p>}
    </div>
  </div>
}
