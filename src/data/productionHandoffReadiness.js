const rows = value => Array.isArray(value) ? value : []
const text = value => typeof value === 'string' ? value.trim() : ''

export function productionHandoffContextKey(release) {
  return [text(release?.id), text(release?.direction_version_id)].join(':')
}

export function productionHandoffReadiness({
  release,
  directionVersions = [],
  mediaAssets = [],
  variants = [],
} = {}) {
  const exactVersionId = text(release?.direction_version_id)
  const version = rows(directionVersions).find(item => item.id === exactVersionId) || null
  const assets = rows(mediaAssets)
    .filter(item => item.design_direction_version_id === exactVersionId && !item.content_request_id)
    .sort((left, right) => new Date(left.created_at || 0) - new Date(right.created_at || 0))
  const releaseVariants = rows(variants)
    .filter(item => item.source_direction_version_id === exactVersionId)
    .sort((left, right) => text(left.variant_format).localeCompare(text(right.variant_format)))
  const blockers = []

  if (!release?.id) blockers.push('released direction')
  if (!exactVersionId || !version) blockers.push('exact released direction version')
  for (const asset of assets) {
    if (asset.media_type === 'video' && asset.status === 'unavailable') continue
    if (asset.status !== 'ready') blockers.push(`ready source asset ${text(asset.id).slice(0, 8) || 'unknown'}`)
    else if (!text(asset.storage_path)) blockers.push(`stored source object ${text(asset.id).slice(0, 8) || 'unknown'}`)
  }
  for (const variant of releaseVariants) {
    const linkedAsset = assets.find(asset => asset.id === variant.design_media_asset_id)
    if (variant.status !== 'ready' || !variant.design_media_asset_id) {
      blockers.push(`ready variant ${text(variant.variant_format) || text(variant.id).slice(0, 8) || 'unknown'}`)
    } else if (!linkedAsset) {
      blockers.push(`variant source asset ${text(variant.design_media_asset_id).slice(0, 8)}`)
    }
  }

  return {
    ready: blockers.length === 0,
    blockers: [...new Set(blockers)],
    exactVersionId,
    version,
    assets,
    variants: releaseVariants,
  }
}

export function productionHandoffPackageEvidence(packageRow, assets = []) {
  const includedIds = [...new Set(rows(packageRow?.included_asset_ids).map(text).filter(Boolean))]
  const visible = includedIds.flatMap(assetId => {
    const asset = rows(assets).find(item => item.id === assetId)
    return asset ? [asset] : []
  })
  const visibleIds = new Set(visible.map(item => item.id))
  return {
    includedIds,
    visible,
    unavailableIds: includedIds.filter(assetId => !visibleIds.has(assetId)),
    canDownload: packageRow?.status === 'ready',
  }
}
