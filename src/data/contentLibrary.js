const REVIEW_STAGES = new Set(['draft', 'in_review', 'changes_requested', 'approved'])

function clean(value) { return String(value || '').trim() }
function relation(value) { return Array.isArray(value) ? value[0] || null : value || null }

export function contentReviewStage(versionId, approvals = [], requests = [], comments = []) {
  if (approvals.some(item => item.artifact_version_id === versionId)) return 'approved'
  const request = requests.find(item => item.artifact_version_id === versionId)
  if (request?.status === 'pending') return comments.some(item => item.artifact_version_id === versionId && !item.resolved)
    ? 'changes_requested' : 'in_review'
  return 'draft'
}

export function recordedSourceReferences(content) {
  const found = []
  const seen = new Set()
  function visit(value, path = []) {
    if (Array.isArray(value)) return value.forEach((item, index) => visit(item, [...path, String(index)]))
    if (!value || typeof value !== 'object') return
    for (const [key, child] of Object.entries(value)) {
      const nextPath = [...path, key]
      const sourceContext = nextPath.some(part => /source|manifest/i.test(part))
      if (sourceContext && /(?:^|_)version_id$/i.test(key) && typeof child === 'string' && clean(child)) {
        const id = clean(child)
        const identity = `${nextPath.join('.')}:${id}`
        if (!seen.has(identity)) { seen.add(identity); found.push({ id, path: nextPath.join('.') }) }
      } else visit(child, nextPath)
    }
  }
  visit(content)
  return found
}

export function recordedSourceVersionIds(versions = []) {
  return [...new Set(versions.flatMap(version => recordedSourceReferences(version.content).map(item => item.id)))]
}

export function buildContentLibrary({ artifacts = [], versions = [], approvals = [], requests = [], comments = [], profiles = [] } = {}) {
  const profileById = new Map(profiles.map(profile => [profile.id, profile]))
  return artifacts.map(artifact => {
    const engagement = relation(artifact.engagements)
    const project = relation(engagement?.projects)
    const artifactVersions = versions.filter(version => version.artifact_id === artifact.id)
      .sort((left, right) => Number(right.version_number) - Number(left.version_number))
    const latest = artifactVersions[0] || null
    return { artifact, engagement, project, creator: profileById.get(artifact.created_by) || null,
      versions: artifactVersions, latest,
      reviewStage: latest ? contentReviewStage(latest.id, approvals, requests, comments) : 'draft' }
  }).sort((left, right) => String(right.latest?.created_at || right.artifact.created_at)
    .localeCompare(String(left.latest?.created_at || left.artifact.created_at)))
}

export function filterContentLibrary(entries = [], filters = {}) {
  const query = clean(filters.query).toLowerCase()
  const type = clean(filters.type)
  const projectId = clean(filters.projectId)
  const creatorId = clean(filters.creatorId)
  const reviewStage = REVIEW_STAGES.has(filters.reviewStage) ? filters.reviewStage : ''
  return entries.filter(entry => {
    if (type && entry.artifact.artifact_type !== type) return false
    if (projectId && entry.engagement?.project_id !== projectId) return false
    if (creatorId && entry.artifact.created_by !== creatorId) return false
    if (reviewStage && entry.reviewStage !== reviewStage) return false
    if (!query) return true
    return [entry.artifact.title, entry.artifact.artifact_type, entry.engagement?.name, entry.project?.name,
      entry.creator?.full_name, entry.creator?.email].map(clean).join(' ').toLowerCase().includes(query)
  })
}

export function sourceReferenceDetails(version, accessibleVersions = []) {
  const versionById = new Map(accessibleVersions.map(item => [item.id, item]))
  return recordedSourceReferences(version?.content).map(reference => {
    const sourceVersion = versionById.get(reference.id) || null
    return { ...reference, version: sourceVersion, artifact: relation(sourceVersion?.artifacts), accessible: Boolean(sourceVersion) }
  })
}
