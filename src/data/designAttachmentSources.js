// Presentation allowlist only; the server rechecks current authority and immutable bytes.
export function officialDesignImageSources(workspace, organizationId, engagementId) {
  if (!organizationId || !engagementId || workspace?.engagement?.id !== engagementId || workspace.engagement.organization_id !== organizationId) return []
  const roots = new Map((workspace.designAssets || []).filter(a => a.organization_id === organizationId && a.engagement_id === engagementId && a.brand_id === workspace.engagement.brand_id && !a.archived_at).map(a => [a.id, a]))
  return (workspace.designAssetVersions || []).filter(v => roots.has(v.asset_id) && v.organization_id === organizationId && v.mime_type === 'image/png' && v.storage_bucket === 'design-generated-media' && v.storage_path?.startsWith(organizationId + '/assets/') && /^[a-f0-9]{64}$/.test(v.content_checksum || '')).map(v => ({kind:'design_asset_version',id:v.id,checksum:v.content_checksum,mime_type:v.mime_type,label:roots.get(v.asset_id).name+' · v'+v.version_number+' · project PNG'}))
}
