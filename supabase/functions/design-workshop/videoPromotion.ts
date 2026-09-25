import { validateIdentityReferenceRows } from './creativeBriefs.ts'
type Json = Record<string, any>
const BUCKET = 'design-generated-video'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
function id(value: unknown) {
  if (typeof value !== 'string' || !UUID.test(value)) throw new Error('Exact promotion context ID required')
  return value
}
function args(admin: any, body: Json, actorId: string, confirm: boolean) {
  return { p_organization_id: admin.organizationId, p_actor_id: actorId,
    p_job_id: id(body.job_id), p_engagement_id: id(body.target_engagement_id),
    p_service_id: id(body.target_service_id),
    p_operation_key: confirm ? id(body.operation_key) : null,
    p_expected_checksum: confirm ? body.expected_checksum : null }
}

async function checkAccess(admin: any, caller: any, body: Json, actorId: string) {
  const { data: job, error } = await admin.rpc('get_design_video_job', {
    p_organization_id: admin.organizationId, p_job_id: id(body.job_id), p_actor_id: actorId,
  })
  if (error || job?.status !== 'ready' || job.requested_by !== actorId
    || job.organization_id !== admin.organizationId) throw new Error('Ready owner-private source is unavailable')
  const [source, target, service] = await Promise.all([
    caller.from('design_direction_versions').select('id,organization_id,creative_brief_version_id').eq('id', job.direction_version_id)
      .eq('organization_id', admin.organizationId).maybeSingle(),
    caller.from('engagements').select('id,organization_id,brand_id').eq('id', id(body.target_engagement_id))
      .eq('organization_id', admin.organizationId).maybeSingle(),
    caller.from('engagement_services').select('id,service_catalog!inner(department_id,is_active)')
      .eq('id', id(body.target_service_id)).eq('engagement_id', body.target_engagement_id)
      .eq('organization_id', admin.organizationId).eq('status','active').maybeSingle(),
  ])
  const catalog = Array.isArray(service.data?.service_catalog) ? service.data.service_catalog[0] : service.data?.service_catalog
  if (source.error || target.error || service.error || !source.data || !target.data || !service.data
    || catalog?.department_id !== 'design' || catalog?.is_active !== true) {
    throw new Error('Current source and target Design access is required')
  }
  const brief = await caller.from('design_creative_brief_versions').select('id,organization_id')
    .eq('id', source.data.creative_brief_version_id).eq('organization_id', admin.organizationId).maybeSingle()
  const pinned = await caller.from('design_creative_brief_version_sources').select('artifact_version_id')
    .eq('creative_brief_version_id', source.data.creative_brief_version_id).eq('organization_id', admin.organizationId)
  if (brief.error || !brief.data || pinned.error || !Array.isArray(pinned.data)) throw new Error('Exact source brief unavailable')
  if (pinned.data.length) {
    const refs = await caller.from('artifact_versions')
      .select('id,organization_id,artifacts!inner(artifact_type,brand_id,organization_id)')
      .eq('organization_id', admin.organizationId).in('id', pinned.data.map((row: Json) => row.artifact_version_id))
    if (refs.error || refs.data?.length !== pinned.data.length) throw new Error('Pinned source access changed')
    const approvals = await caller.from('artifact_approvals').select('artifact_version_id,organization_id')
      .eq('organization_id', admin.organizationId).in('artifact_version_id', pinned.data.map((row: Json) => row.artifact_version_id))
    if (approvals.error) throw new Error('Source identity approval unavailable')
    validateIdentityReferenceRows(refs.data, approvals.data || [], admin.organizationId, target.data.brand_id)
  }
}

function publicPreview(data: Json) {
  return { job_id: data.job_id, target_engagement_id: data.target_engagement_id,
    target_service_id: data.target_service_id, brand_id: data.brand_id,
    name: data.name, rights_notes: data.rights_notes, checksum: data.checksum,
    mime_type: data.mime_type, byte_length: data.byte_length, status: 'draft' }
}

export async function previewVideoPromotion(admin: any, caller: any, body: Json, actorId: string) {
  await checkAccess(admin, caller, body, actorId)
  const { data, error } = await admin.rpc('prepare_design_video_promotion', args(admin, body, actorId, false))
  if (error || !data?.checksum) throw new Error('Video promotion preview unavailable')
  return publicPreview(data)
}

async function checkedBytes(blob: Blob | null, prepared: Json) {
  if (!blob || blob.size !== prepared.byte_length || blob.type.split(';')[0].toLowerCase() !== prepared.mime_type) {
    throw new Error('Exact saved video bytes are unavailable')
  }
  const bytes = await blob.arrayBuffer()
  const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))]
    .map(byte => byte.toString(16).padStart(2, '0')).join('')
  if (hash !== prepared.sha256) throw new Error('Saved video checksum conflict')
  return bytes
}

export async function promotePrivateVideo(admin: any, caller: any, body: Json, actorId: string) {
  if (typeof body.expected_checksum !== 'string' || !/^[a-f0-9]{64}$/.test(body.expected_checksum)) {
    throw new Error('Exact preview checksum required')
  }
  await checkAccess(admin, caller, body, actorId)
  const parameters = args(admin, body, actorId, true)
  const { data: prepared, error } = await admin.rpc('prepare_design_video_promotion', parameters)
  if (error || !prepared || prepared.checksum !== body.expected_checksum) throw new Error('Promotion context changed or unavailable')
  id(prepared.asset_id); id(prepared.version_id); id(prepared.direction_version_id)
  const format = prepared.format
  if (!['mp4','mov'].includes(format) || prepared.source_path !==
    `${admin.organizationId}/${prepared.direction_version_id}/${body.job_id}/output.${format}`) {
    throw new Error('Private video source identity mismatch')
  }
  const path = `${admin.organizationId}/assets/${prepared.asset_id}/${prepared.version_id}/file.${format}`
  const bucket = admin.storage.from(BUCKET)
  const source = await bucket.download(prepared.source_path)
  if (source.error) throw new Error('Private source video is unavailable')
  const bytes = await checkedBytes(source.data, prepared)
  // No overwrite, regeneration or cleanup of a possibly committed destination.
  const uploaded = await bucket.upload(path, bytes, { contentType: prepared.mime_type, upsert: false })
  if (uploaded.error) {
    const existing = await bucket.download(path)
    if (existing.error) throw new Error('Draft copy pending; retry the same operation')
    await checkedBytes(existing.data, prepared)
  }
  // Access may have changed while transferring bytes. No canonical draft is
  // published until both caller-visible contexts and server receipt are rechecked.
  await checkAccess(admin, caller, body, actorId)
  const completed = await admin.rpc('complete_design_video_promotion', parameters)
  if (completed.error || completed.data?.status !== 'draft') throw new Error('Draft registration pending; retry the same operation')
  return completed.data
}
