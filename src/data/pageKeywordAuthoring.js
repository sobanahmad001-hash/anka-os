import {websitePageKey} from './contentStudio.js'

export function keywordRequestIdentity(asset, requestId) {
  return {request_id:requestId, project_id:asset.projectId, engagement_id:asset.engagementId,
    page_id:asset.id, page_key:asset.pageKey, architecture_version_id:asset.sourceVersionId}
}

export function matchesKeywordAttempt(attempt, asset, actorId) {
  if (attempt?.contractVersion !== 1 || !attempt.id || attempt.actorId !== actorId ||
      attempt.organizationId !== asset.organizationId) return false
  const expected = keywordRequestIdentity(asset, attempt.id)
  return Object.entries(expected).every(([key,value]) => attempt.identity?.[key] === value)
}

export function verifyKeywordReceipt(receipt, attempt, asset, actorId) {
  const version = receipt?.version
  if (!matchesKeywordAttempt(attempt, asset, actorId) ||
      !Object.entries(attempt.identity).every(([key,value]) => receipt?.[key] === value) ||
      !receipt?.artifact_id || !version?.id || version.artifact_id !== receipt.artifact_id ||
      version.organization_id !== asset.organizationId || version.created_by !== actorId ||
      version.version_number !== 1 || version.parent_version_id !== null ||
      version.content?.source_architecture_version_id !== asset.sourceVersionId ||
      !version.content?.keywords?.some(row => row.target_page_key === asset.pageKey) ||
      !Array.isArray(receipt.warnings) || receipt.warnings.some(warning => typeof warning !== 'string')) throw Error('The original strategy receipt could not be verified.')
  return receipt
}

export function keywordAuthoringKeys(asset, actorId) {
  const scope = [actorId, asset.organizationId, asset.projectId, asset.engagementId].join(':')
  return {
    draft: ['anka:page-strategy-draft', scope, asset.id, asset.sourceVersionId].join(':'),
    attempt: 'anka:project-strategy-attempt:' + scope,
  }
}

export async function readKeywordPage(asset, studio, pages, signal) {
  if (asset.kind !== 'website_page' || !asset.pageKey || !asset.id || !asset.sourceVersionId ||
      asset.architectureVersionId !== asset.sourceVersionId || studio.organizationId !== asset.organizationId) {
    throw Error('Reopen the registered Website page in its project.')
  }
  const workspace = await studio.load(asset.engagementId)
  const engagement = workspace.engagement
  if (engagement?.id !== asset.engagementId || engagement.project_id !== asset.projectId ||
      engagement.organization_id !== asset.organizationId || !workspace.contentServices?.length) {
    throw Error('An active Content service in this page’s project and engagement is required.')
  }
  const version = workspace.versions.find(v => v.id === asset.sourceVersionId && v.organization_id === asset.organizationId)
  const root = workspace.artifacts.find(a => a.id === version?.artifact_id && a.artifact_type === 'website_architecture' &&
    a.organization_id === asset.organizationId && a.project_id === asset.projectId && a.engagement_id === asset.engagementId)
  const matches = version?.content?.pages?.filter(p => websitePageKey(p) === asset.pageKey)
  if (!root || matches?.length !== 1) throw Error('The exact page key and architecture version could not be verified.')
  const scope = {organizationId: asset.organizationId, projectId: asset.projectId, architectureVersionId: version.id}
  for (let offset = 0; offset <= 10000; offset += 100) {
    const result = await pages.list({...scope, search: asset.pageKey.slice(0,240), offset, limit: 100}, {signal})
    if (result.reference?.artifact_version_id !== version.id || result.reference.artifact_id !== root.id) break
    if (result.pages.some(row => row.page_id === asset.id && row.source?.page_key === asset.pageKey)) {
      return {workspace, page: matches[0], version, strategy: workspace.artifacts.find(a => a.artifact_type === 'keyword_strategy')}
    }
    if (offset + 100 >= result.counts.filtered_total || !result.pages.length) break
  }
  throw Error('The page is unavailable in the selected approved architecture.')
}
