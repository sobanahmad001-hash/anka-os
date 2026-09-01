import { useCallback, useEffect, useState } from 'react'
import { artifactRelations } from '../data/artifactRelationsRepository.js'
import { ARTIFACT_RELATION_TYPES, artifactSurfacePath, artifactTypeLabel, relationTypeLabel } from '../data/artifactRelations.js'
import VersionProofingPanel from './VersionProofingPanel.jsx'

const INPUT = 'w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm text-white outline-none focus:border-cyan-500'

export default function ContentRequestReviewPanels({ request }) {
  const requestId = request?.id || ''
  const organizationId = request?.organization_id || ''
  const [relations, setRelations] = useState([])
  const [sourceArtifacts, setSourceArtifacts] = useState([])
  const [sourceArtifactId, setSourceArtifactId] = useState('')
  const [relationType, setRelationType] = useState('feeds_into')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    if (!requestId || !organizationId) return
    setLoading(true); setError('')
    try {
      const [relationRows, artifactRows] = await Promise.all([
        artifactRelations.listForRequest(requestId),
        artifactRelations.sourceCandidates({ organizationId }),
      ])
      setRelations(relationRows || [])
      setSourceArtifacts(artifactRows || [])
    } catch (reason) { setError(reason.message) }
    finally { setLoading(false) }
  }, [organizationId, requestId])

  useEffect(() => { load() }, [load])

  async function createRelation(event) {
    event.preventDefault()
    if (!sourceArtifactId) return
    setLoading(true); setError('')
    try {
      await artifactRelations.create(sourceArtifactId, '', relationType, requestId)
      setSourceArtifactId('')
      await load()
    } catch (reason) { setError(reason.message); setLoading(false) }
  }

  return <section className="mt-5 space-y-3">
    <VersionProofingPanel
      targetKind="content_request"
      versions={[{ id: requestId, version_number: 1 }]}
      initialVersionId={requestId}
      department="content"
      theme="amber"
    />
    <div className="rounded-2xl border border-cyan-500/20 bg-slate-950/55 p-5">
      <div><p className="text-xs font-semibold uppercase tracking-[0.14em] text-cyan-300">Request-linked artifacts</p><h3 className="mt-1 font-semibold text-white">Related source artifacts</h3><p className="mt-1 text-xs leading-5 text-slate-500">A relation starts from a visible artifact and targets this request. Content requests are target-only; they never become relation sources.</p></div>
      {error && <div className="mt-4 rounded-xl border border-red-900/50 bg-red-950/30 px-3 py-2 text-sm text-red-300">{error}</div>}
      <div className="mt-4 space-y-2">
        {loading && !relations.length && <p className="rounded-xl border border-dashed border-slate-800 px-3 py-4 text-center text-xs text-slate-600">Loading related artifacts…</p>}
        {!loading && !relations.length && <p className="rounded-xl border border-dashed border-slate-800 px-3 py-4 text-center text-xs text-slate-600">No visible artifact links target this request yet.</p>}
        {relations.map(relation => <article key={relation.id} className="rounded-xl border border-slate-800 bg-slate-900/60 p-3"><a href={artifactSurfacePath(relation.source || {})} className="text-sm font-semibold text-white hover:text-cyan-300">{relation.source?.title || 'Source artifact'}</a><p className="mt-1 text-[11px] text-slate-500">{artifactTypeLabel(relation.source?.artifact_type)} · {relationTypeLabel(relation.relation_type)}</p></article>)}
      </div>
      <form onSubmit={createRelation} className="mt-5 grid gap-3 border-t border-slate-800 pt-5 lg:grid-cols-[1fr_180px_auto]">
        <select required className={INPUT} value={sourceArtifactId} onChange={event => setSourceArtifactId(event.target.value)}>
          <option value="">Select a visible source artifact</option>
          {sourceArtifacts.map(artifact => <option key={artifact.id} value={artifact.id}>{artifact.title} · {artifactTypeLabel(artifact.artifact_type)}</option>)}
        </select>
        <select className={INPUT} value={relationType} onChange={event => setRelationType(event.target.value)}>
          {ARTIFACT_RELATION_TYPES.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
        </select>
        <button disabled={loading || !sourceArtifactId} className="rounded-xl bg-cyan-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-cyan-600 disabled:opacity-50">{loading ? 'Saving…' : 'Link artifact'}</button>
      </form>
    </div>
  </section>
}