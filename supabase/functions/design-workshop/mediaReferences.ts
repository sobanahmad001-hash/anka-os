type Json = Record<string, unknown>
export type MediaReference = { kind: 'design_asset_version', id: string }
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// A typed reference is never coerced into an artifact version, job, or URL.
export function normalizeMediaReferences(value: unknown): MediaReference[] {
  if (value === undefined) return []
  if (!Array.isArray(value) || value.length > 50) throw new Error('At most 50 exact media references are supported')
  const references = new Map<string, MediaReference>()
  for (const item of value) {
    if (!item || typeof item !== 'object' || Array.isArray(item)
      || Object.keys(item).some(key => !['kind', 'id'].includes(key))
      || item.kind !== 'design_asset_version' || typeof item.id !== 'string' || !UUID.test(item.id)) {
      throw new Error('An exact typed Design asset version is required')
    }
    references.set(item.id.toLowerCase(), { kind: 'design_asset_version', id: item.id.toLowerCase() })
  }
  return [...references.values()].sort((left, right) => left.id.localeCompare(right.id))
}

export async function validateMediaReferences(client: any, references: MediaReference[],
  organizationId: string, engagementId: string | null, brandId: string | null) {
  if (!references.length) return
  const { data, error } = await client.from('design_asset_versions')
    .select('id,organization_id,asset_id,mime_type,storage_bucket,storage_path,design_assets!inner(id,organization_id,engagement_id,brand_id,archived_at)')
    .eq('organization_id', organizationId).in('id', references.map(ref => ref.id))
  if (error || !Array.isArray(data) || data.length !== references.length) {
    throw new Error('One or more exact media versions are unavailable')
  }
  for (const row of data as Json[]) {
    const asset = (Array.isArray(row.design_assets) ? row.design_assets[0] : row.design_assets) as Json
    const video = ['video/mp4', 'video/quicktime'].includes(String(row.mime_type))
    if (!asset || asset.organization_id !== organizationId || row.organization_id !== organizationId
      || asset.id !== row.asset_id || asset.archived_at
      || (engagementId && (asset.engagement_id !== engagementId || asset.brand_id !== brandId))
      || (!video && row.mime_type !== 'image/png')
      || row.storage_bucket !== (video ? 'design-generated-video' : 'design-generated-media')
      || !String(row.storage_path || '').startsWith(`${organizationId}/`)) {
      throw new Error('Exact media version is outside this brief scope or unavailable')
    }
  }
}
