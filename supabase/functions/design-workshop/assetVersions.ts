import { Buffer } from 'node:buffer'
import { PNG } from 'npm:pngjs@7.0.0'
import { stableJson } from '../_shared/approvedArtifactContext.ts'

type Json = Record<string, unknown>
type AssetAdmin = any

export const DESIGN_ASSET_BUCKET = 'design-generated-media'
export const DESIGN_ASSET_MIME = 'image/png'
export const DESIGN_ASSET_MAX_BYTES = 10 * 1024 * 1024

const text = (value: unknown, max = 4000) => typeof value === 'string' ? value.trim().slice(0, max) : ''

async function sha256Bytes(bytes: Uint8Array) {
  const digest = await crypto.subtle.digest('SHA-256', Uint8Array.from(bytes).buffer)
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('')
}

async function sha256Text(value: string) {
  return sha256Bytes(new TextEncoder().encode(value))
}

export function designAssetStoragePath(organizationId: string, assetId: string, versionId: string) {
  return `${organizationId}/assets/${assetId}/${versionId}/file.png`
}

export async function parseDesignAssetPng(body: Json) {
  const mimeType = text(body.mime_type, 100)
  const originalFilename = text(body.original_filename, 240)
  const rawBase64 = typeof body.file_base64 === 'string' ? body.file_base64.trim() : ''
  if (rawBase64.length > Math.ceil(DESIGN_ASSET_MAX_BYTES * 4 / 3) + 4) {
    throw new Error('PNG uploads must be no larger than 10 MiB')
  }
  const base64 = rawBase64
  if (mimeType !== DESIGN_ASSET_MIME || !/\.png$/i.test(originalFilename)) {
    throw new Error('Only PNG uploads are supported by the configured Design asset bucket')
  }
  if (!base64 || base64.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) {
    throw new Error('The PNG upload encoding is invalid')
  }
  const bytes = new Uint8Array(Buffer.from(base64, 'base64'))
  if (!bytes.byteLength || bytes.byteLength > DESIGN_ASSET_MAX_BYTES) {
    throw new Error('PNG uploads must be no larger than 10 MiB')
  }
  const signature = [137, 80, 78, 71, 13, 10, 26, 10]
  if (signature.some((value, index) => bytes[index] !== value)) throw new Error('The uploaded file is not a PNG')
  let decoded
  try {
    decoded = PNG.sync.read(Buffer.from(bytes), { checkCRC: true })
  } catch {
    throw new Error('The uploaded PNG content is unreadable')
  }
  if (!decoded.width || !decoded.height) throw new Error('The uploaded PNG has invalid dimensions')
  return {
    bytes,
    mimeType,
    originalFilename,
    byteSize: bytes.byteLength,
    width: decoded.width,
    height: decoded.height,
    contentChecksum: await sha256Bytes(bytes),
  }
}

async function existingOperation(admin: AssetAdmin, actorId: string, operationKey: string) {
  const { data, error } = await admin.from('design_asset_versions').select('*')
    .eq('organization_id', admin.organizationId).eq('created_by', actorId)
    .eq('operation_key', operationKey).maybeSingle()
  if (error) throw error
  return data
}

async function removeUploadedObject(admin: AssetAdmin, storagePath: string) {
  const { error } = await admin.storage.from(DESIGN_ASSET_BUCKET).remove([storagePath])
  if (error) throw new Error(`The unused upload could not be removed: ${error.message || 'Storage cleanup failed'}`)
}

export async function uploadDesignAssetVersion(admin: AssetAdmin, body: Json, actorId: string) {
  const engagementId = text(body.engagement_id, 80)
  const brandId = text(body.brand_id, 80)
  const operationKey = text(body.operation_key, 200)
  const name = text(body.name, 180)
  const placement = text(body.placement, 500)
  const rightsNotes = text(body.rights_notes, 2000)
  const changeSummary = text(body.change_summary, 1000)
  const sourceDirectionVersionId = text(body.source_direction_version_id, 80) || null
  const expectedLatestVersionId = text(body.expected_latest_version_id, 80) || null
  const requestedAssetId = text(body.asset_id, 80) || null
  if (!engagementId || !brandId || !name) throw new Error('Engagement, brand, and asset name are required')
  if (operationKey.length < 8) throw new Error('A stable upload operation key of at least 8 characters is required')
  if (requestedAssetId && !expectedLatestVersionId) throw new Error('Replacing an asset requires its expected latest version')
  if (!requestedAssetId && expectedLatestVersionId) throw new Error('A new asset cannot name an existing latest version')

  const file = await parseDesignAssetPng(body)
  const requestChecksum = await sha256Text(stableJson({
    engagement_id: engagementId, brand_id: brandId, asset_id: requestedAssetId,
    expected_latest_version_id: expectedLatestVersionId, source_direction_version_id: sourceDirectionVersionId,
    name, placement, rights_notes: rightsNotes, change_summary: changeSummary,
    original_filename: file.originalFilename, mime_type: file.mimeType, content_checksum: file.contentChecksum,
  }))
  const existing = await existingOperation(admin, actorId, operationKey)
  if (existing) {
    if (existing.request_checksum !== requestChecksum) throw new Error('Operation key was already used for a different upload')
    const { data: asset, error } = await admin.from('design_assets').select('*')
      .eq('id', existing.asset_id).eq('organization_id', admin.organizationId).single()
    if (error) throw error
    return { asset, version: existing, idempotent_replay: true }
  }

  const assetId = requestedAssetId || crypto.randomUUID()
  const versionId = crypto.randomUUID()
  const storagePath = designAssetStoragePath(admin.organizationId, assetId, versionId)
  let uploadedHere = false
  const { error: uploadError } = await admin.storage.from(DESIGN_ASSET_BUCKET).upload(storagePath, file.bytes, {
    contentType: file.mimeType,
    upsert: false,
  })
  if (uploadError) {
    const { data: stored, error: downloadError } = await admin.storage.from(DESIGN_ASSET_BUCKET).download(storagePath)
    if (downloadError || !stored || await sha256Bytes(new Uint8Array(await stored.arrayBuffer())) !== file.contentChecksum) {
      throw uploadError
    }
  } else {
    uploadedHere = true
  }

  const { data, error } = await admin.rpc('register_design_asset_upload', {
    p_organization_id: admin.organizationId,
    p_engagement_id: engagementId,
    p_brand_id: brandId,
    p_asset_id: assetId,
    p_version_id: versionId,
    p_expected_latest_version_id: expectedLatestVersionId,
    p_source_direction_version_id: sourceDirectionVersionId,
    p_name: name,
    p_output_type: 'static_image',
    p_placement: placement,
    p_rights_notes: rightsNotes,
    p_original_filename: file.originalFilename,
    p_storage_path: storagePath,
    p_mime_type: file.mimeType,
    p_byte_size: file.byteSize,
    p_width: file.width,
    p_height: file.height,
    p_content_checksum: file.contentChecksum,
    p_change_summary: changeSummary,
    p_operation_key: operationKey,
    p_request_checksum: requestChecksum,
    p_actor_id: actorId,
  })
  if (!error && data) {
    const savedVersion = data.version as Json | undefined
    if (uploadedHere && data.idempotent_replay === true && savedVersion?.storage_path !== storagePath) {
      await removeUploadedObject(admin, storagePath)
    }
    return data
  }

  const replay = await existingOperation(admin, actorId, operationKey)
  if (replay?.request_checksum === requestChecksum) {
    if (uploadedHere && replay.storage_path !== storagePath) await removeUploadedObject(admin, storagePath)
    const { data: asset, error: assetError } = await admin.from('design_assets').select('*')
      .eq('id', replay.asset_id).eq('organization_id', admin.organizationId).single()
    if (assetError) throw assetError
    return { asset, version: replay, idempotent_replay: true }
  }
  if (uploadedHere) await removeUploadedObject(admin, storagePath)
  throw error
}

export async function archiveDesignAsset(admin: AssetAdmin, body: Json, actorId: string) {
  const assetId = text(body.asset_id, 80)
  const expectedLatestVersionId = text(body.expected_latest_version_id, 80)
  const operationKey = text(body.operation_key, 200)
  const reason = text(body.reason, 500)
  if (!assetId || !expectedLatestVersionId) throw new Error('Asset and expected latest version are required')
  if (operationKey.length < 8) throw new Error('A stable archive operation key of at least 8 characters is required')
  if (!reason) throw new Error('An archive reason is required')
  const { data, error } = await admin.rpc('archive_design_asset', {
    p_organization_id: admin.organizationId, p_asset_id: assetId,
    p_expected_latest_version_id: expectedLatestVersionId, p_operation_key: operationKey,
    p_reason: reason, p_actor_id: actorId,
  })
  if (error) throw error
  return data
}
