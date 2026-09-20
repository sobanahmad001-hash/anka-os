import { keywordTargetsChanged } from './contentStudio.js'

export function keywordDownstreamImpact(previous = {}, next = {}, latest = null, workspace = {}) {
  const targetsChanged = keywordTargetsChanged(previous.keywords || [], next.keywords || [])
  const sourceChanged = (previous.source_architecture_version_id || null) !== (next.source_architecture_version_id || null)
  if (!latest || (!targetsChanged && !sourceChanged)) return null
  const sameRootIds = new Set((workspace.versions || [])
    .filter(version => version.artifact_id === latest.artifact_id)
    .map(version => version.id))
  sameRootIds.add(latest.id)
  const linkedPages = []
  for (const version of workspace.versions || []) {
    const artifact = (workspace.artifacts || []).find(item => item.id === version.artifact_id)
    if (artifact?.artifact_type !== 'website_architecture') continue
    for (const page of version.content?.pages || []) {
      if (!sameRootIds.has(page.keyword_strategy_version_id)) continue
      linkedPages.push({
        versionId: version.id,
        versionNumber: version.version_number,
        pageKey: page.page_key || page.slug,
        title: page.title || page.slug || 'Untitled page',
      })
    }
  }
  return { linkedPages, targetsChanged, sourceChanged }
}
