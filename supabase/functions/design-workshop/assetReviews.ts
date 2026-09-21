import { createClient } from 'npm:@supabase/supabase-js@2.112.4'
import { DESIGN_ASSET_BUCKET } from './assetVersions.ts'

type Client = ReturnType<typeof createClient<any>>
type ScopedClient = Client & { organizationId: string }
type Json = Record<string, unknown>

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const text = (value: unknown, max: number) => typeof value === 'string' ? value.trim().slice(0, max) : ''
const conflict = (message: string) => Object.assign(new Error(message), { status: 409 })

async function exactReadableVersion(admin: ScopedClient, userClient: Client, versionId: string) {
  const { data, error } = await userClient.from('design_asset_versions').select('*')
    .eq('id', versionId).eq('organization_id', admin.organizationId).maybeSingle()
  if (error) throw error
  if (!data || data.storage_bucket !== DESIGN_ASSET_BUCKET
    || !String(data.storage_path || '').startsWith(`${admin.organizationId}/`)) {
    throw Object.assign(new Error('The exact Design asset version is unavailable'), { status: 404 })
  }
  return data
}

async function verifyStoredVersion(admin: ScopedClient, version: Json) {
  const { data, error } = await admin.storage.from(DESIGN_ASSET_BUCKET).download(String(version.storage_path))
  if (error || !data) throw conflict('The exact Design asset object is unavailable; refresh before review')
  const bytes = new Uint8Array(await data.arrayBuffer())
  if (!bytes.length || bytes.length > 10 * 1024 * 1024
    || [137, 80, 78, 71, 13, 10, 26, 10].some((part, index) => bytes[index] !== part)) {
    throw conflict('The exact Design asset object is not a readable PNG')
  }
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  const checksum = [...new Uint8Array(digest)].map(part => part.toString(16).padStart(2, '0')).join('')
  if (version.content_checksum && checksum !== version.content_checksum) {
    throw conflict('The exact Design asset object no longer matches its recorded checksum')
  }
  return checksum
}

async function replay(admin: ScopedClient, actorId: string, key: string) {
  const { data, error } = await admin.from('design_asset_review_events').select('*')
    .eq('organization_id', admin.organizationId).eq('actor_id', actorId)
    .eq('operation_key', key).maybeSingle()
  if (error) throw error
  return data
}

export async function recordAssetReview(admin: ScopedClient, userClient: Client, body: Json, actorId: string) {
  const versionId = text(body.asset_version_id, 80)
  const eventType = text(body.event_type, 32)
  const key = text(body.operation_key, 80)
  const note = text(body.note, 2000)
  if (!uuid.test(versionId) || !uuid.test(key)) throw new Error('An exact asset version and stable UUID request key are required')
  if (!['submitted', 'approved', 'changes_requested'].includes(eventType)) throw new Error('Unsupported Design asset review action')
  if ((body.action === 'submit_asset_review' && eventType !== 'submitted')
    || (body.action === 'decide_asset_review' && !['approved', 'changes_requested'].includes(eventType))) {
    throw new Error('Design asset review action does not match its requested event')
  }
  if (eventType === 'changes_requested' && !note) throw new Error('Explain the requested changes')
  const version = await exactReadableVersion(admin, userClient, versionId)
  const existing = await replay(admin, actorId, key)
  if (existing) {
    if (existing.asset_version_id !== versionId || existing.asset_id !== version.asset_id
      || existing.event_type !== eventType || existing.note !== note) {
      throw conflict('This review request key belongs to a different exact action')
    }
    return { event: existing, idempotent_replay: true }
  }
  const objectChecksum = eventType === 'changes_requested' ? null : await verifyStoredVersion(admin, version)
  const identity = { organization_id: admin.organizationId, asset_id: version.asset_id,
    asset_version_id: versionId, event_type: eventType, actor_id: actorId,
    operation_key: key, note, object_checksum: objectChecksum }
  const { data: inserted, error } = await admin.from('design_asset_review_events')
    .insert(identity).select('*').single()
  if (!error && inserted) return { event: inserted, idempotent_replay: false }
  if (error?.code === '23505') {
    const raced = await replay(admin, actorId, key)
    if (raced?.asset_version_id === versionId && raced.asset_id === version.asset_id
      && raced.event_type === eventType && raced.note === note) {
      return { event: raced, idempotent_replay: true }
    }
    throw conflict('This exact asset version already has a review action; refresh its history')
  }
  throw error || new Error('Design asset review was not recorded')
}