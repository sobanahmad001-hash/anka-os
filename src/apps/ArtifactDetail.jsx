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

  return <main className="workspace-page bg-[var(--anka-canvas)]">
    <div className="workspace-container">
      <Link to={artifact ? owningWorkspacePath(artifact) : '/sphere/engagements'} className="text-sm text-[var(--anka-muted)] hover:text-[var(--anka-ink)]">← Back to owning workspace</Link>
      {loading ? <div className="py-24 text-center text-sm text-[var(--anka-muted)]">Loading artifact…</div> : error ? <div className="mt-6 rounded-xl border border-[var(--anka-danger)] bg-[var(--anka-danger-soft)] p-4 text-sm text-[var(--anka-danger)]">{error}</div> : artifact && <>
        <header className="mt-6 workspace-card p-6">
          <p className="workspace-eyebrow">Canonical artifact</p>
          <h1 className="workspace-title">{artifact.title}</h1>
          <div className="mt-4 flex flex-wrap gap-2 text-xs text-[var(--anka-muted)]"><span className="rounded-full bg-[var(--anka-canvas)] px-3 py-1.5">{artifactTypeLabel(artifact.artifact_type)}</span><span className="rounded-full bg-[var(--anka-canvas)] px-3 py-1.5">Created {new Date(artifact.created_at).toLocaleString()}</span></div>
        </header>
        <ArtifactRelationsPanel artifact={artifact} />
      </>}
    </div>
  </main>
}
