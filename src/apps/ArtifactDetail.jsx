import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import ArtifactRelationsPanel from '../components/ArtifactRelationsPanel.jsx'
import { artifactTypeLabel, owningWorkspacePath } from '../data/artifactRelations.js'
import { artifactRelations } from '../data/artifactRelationsRepository.js'

export default function ArtifactDetail() {
  const { artifactId } = useParams()
  const [artifact, setArtifact] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    setLoading(true); setError('')
    artifactRelations.getArtifact(artifactId).then(row => { if (active) setArtifact(row) })
      .catch(reason => { if (active) setError(reason.message) })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [artifactId])

  return <main className="min-h-full bg-slate-950 px-5 py-7 text-white lg:px-8">
    <div className="mx-auto max-w-5xl">
      <Link to={artifact ? owningWorkspacePath(artifact) : '/sphere/engagements'} className="text-sm text-slate-500 hover:text-white">← Back to owning workspace</Link>
      {loading ? <div className="py-24 text-center text-sm text-slate-500">Loading artifact…</div> : error ? <div className="mt-6 rounded-xl border border-red-900/50 bg-red-950/30 p-4 text-sm text-red-300">{error}</div> : artifact && <>
        <header className="mt-6 rounded-2xl border border-slate-800 bg-slate-900/70 p-6">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-cyan-300">Canonical artifact</p>
          <h1 className="mt-2 text-3xl font-semibold">{artifact.title}</h1>
          <div className="mt-4 flex flex-wrap gap-2 text-xs text-slate-400"><span className="rounded-full bg-slate-950 px-3 py-1.5">{artifactTypeLabel(artifact.artifact_type)}</span><span className="rounded-full bg-slate-950 px-3 py-1.5">Created {new Date(artifact.created_at).toLocaleString()}</span></div>
        </header>
        <ArtifactRelationsPanel artifact={artifact} />
      </>}
    </div>
  </main>
}
