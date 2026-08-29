export const OUTPUT_FAMILIES = Object.freeze([
  ['brand_identity', 'Brand identity'], ['website_design', 'Website design'],
  ['marketing_asset', 'Marketing asset'], ['video_motion', 'Video and motion'],
])

export function latestByVersion(rows = []) {
  return [...rows].sort((a, b) => b.version_number - a.version_number)[0] || null
}

export function approvalForVersion(approvals = [], versionId) {
  return approvals.find(item => item.artifact_version_id === versionId) || null
}
