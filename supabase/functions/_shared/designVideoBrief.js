// T04 contract only. No provider capability, spending or confirmation is inferred.
export const VIDEO_BRIEF_MODEL = 'bytedance/seedance-2.5/text-to-video'
export const VIDEO_BRIEF_FIELDS = Object.freeze([
  ['purpose', 'Purpose', 1000], ['audience', 'Audience', 1000],
  ['channel', 'Channel / placement', 300], ['assets', 'Source assets / reuse plan', 1500],
  ['script_storyboard', 'Script / storyboard', 5000],
  ['brand_constraints', 'Brand constraints', 1500], ['required_text', 'Required text', 1000],
])
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i
const settings = ['mode', 'duration_seconds', 'aspect_ratio', 'resolution', 'output_format', 'generate_audio']
const keys = new Set([...VIDEO_BRIEF_FIELDS.map(([key]) => key), ...settings])
const ordered = value => Array.isArray(value) ? value.map(ordered) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, ordered(value[key])])) : value
const exact = value => JSON.stringify(ordered(value))
const clean = value => typeof value === 'string' ? value.trim() : ''
export function emptyVideoBrief() {
  return { ...Object.fromEntries(VIDEO_BRIEF_FIELDS.map(([key]) => [key, ''])),
    mode: 'explore', duration_seconds: 5, aspect_ratio: '16:9', resolution: '720p', output_format: 'mp4', generate_audio: false }
}
export function normalizeVideoBrief(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !keys.has(key))) throw new Error('Only the exact video brief fields and supported settings are allowed')
  return { ...Object.fromEntries(VIDEO_BRIEF_FIELDS.map(([key]) => [key, clean(value[key])])),
    mode: value.mode, duration_seconds: value.duration_seconds, aspect_ratio: value.aspect_ratio,
    resolution: value.resolution, output_format: value.output_format, generate_audio: value.generate_audio }
}
export function videoBriefPrompt(value) {
  const brief = normalizeVideoBrief(value)
  return VIDEO_BRIEF_FIELDS.map(([key, label]) => `${label}:\n${brief[key]}`).join('\n\n')
}
export function validateVideoBrief(value) {
  let brief
  try { brief = normalizeVideoBrief(value) } catch (error) { return { valid: false, missing: [], errors: [error.message] } }
  const missing = VIDEO_BRIEF_FIELDS.filter(([key]) => !brief[key]).map(([, label]) => label)
  const errors = VIDEO_BRIEF_FIELDS.filter(([key,, limit]) => brief[key].length > limit).map(([, label, limit]) => `${label} exceeds ${limit} characters`)
  if (!['explore', 'production'].includes(brief.mode)) errors.push('Choose a supported mode')
  if (!Number.isInteger(brief.duration_seconds) || brief.duration_seconds < 4 || brief.duration_seconds > 30 || (brief.mode === 'explore' && brief.duration_seconds > 5)) errors.push('Choose a supported duration explicitly')
  if (!['480p', '720p'].includes(brief.resolution) || (brief.mode === 'production' && brief.resolution !== '720p')) errors.push('Choose a supported resolution explicitly; 1080p and upscaling are unavailable')
  if (!['16:9', '4:3', '1:1', '3:4', '9:16', '21:9'].includes(brief.aspect_ratio)) errors.push('Choose a supported aspect ratio')
  if (!['mp4', 'mov'].includes(brief.output_format)) errors.push('Choose a supported output format')
  if (typeof brief.generate_audio !== 'boolean') errors.push('Confirm the audio setting explicitly')
  if (videoBriefPrompt(brief).length > 12000) errors.push('The complete provider prompt exceeds 12000 characters')
  return { valid: missing.length === 0 && errors.length === 0, missing, errors }
}
export function videoBriefSignature(value) { return JSON.stringify(normalizeVideoBrief(value)) }
export function videoBriefCreativeContent(value, context, title = '') {
  const brief = normalizeVideoBrief(value), validation = validateVideoBrief(brief)
  if (!validation.valid) throw new Error([...validation.missing.map(label => `${label} is required`), ...validation.errors].join('; '))
  const ids = [context?.private_conversation_id, context?.direction_version_id].filter(Boolean)
  if (ids.length !== 1 || Object.keys(context).some(key => !['private_conversation_id', 'direction_version_id'].includes(key)) || !ids.every(id => typeof id === 'string' && UUID.test(id))) throw new Error('One exact video context is required')
  const name = clean(title) || brief.purpose.slice(0, 160)
  if (!name || name.length > 200) throw new Error('A video brief title under 201 characters is required')
  return { schema_version: 1, title: name, output_type: 'video', purpose: brief.purpose,
    audience: brief.audience, placement_destination: brief.channel,
    instructions: videoBriefPrompt(brief), exclusions_constraints: brief.brand_constraints,
    rights_notes: brief.assets, requested_outputs: ['video'], video_brief: brief,
    video_context: { ...context }, video_provider: 'higgsfield', video_model_id: VIDEO_BRIEF_MODEL }
}
// Inspect one explicitly chosen immutable version. Never adopt a newer saved version silently.
function inspectVideoBriefVersion({ version, brief: root, organizationId, actorId, context, draft }, requireCurrent) {
  if (![version?.id, root?.id, organizationId, actorId].every(id => typeof id === 'string' && UUID.test(id)) || version.organization_id !== organizationId || root.organization_id !== organizationId
    || version.creative_brief_id !== root.id || root.created_by !== actorId || root.visibility !== 'private'
    || root.engagement_id || root.brand_id || root.engagement_service_id || root.project_task_id || root.engagement_work_item_id
    || (requireCurrent && root.frozen_version_id !== version.id) || version.created_by !== actorId || version.validation_snapshot?.valid !== true
    || version.validation_snapshot?.video_confirmation?.action !== 'confirm_video_brief'
    || version.validation_snapshot?.video_confirmation?.actor_id !== actorId
    || !Number.isInteger(version.validation_snapshot?.video_confirmation?.expected_revision)
    || version.validation_snapshot.video_confirmation.expected_revision < 0
    || (version.validation_snapshot.video_confirmation.requested_root_id !== null && version.validation_snapshot.video_confirmation.requested_root_id !== root.id)) throw new Error('An exact confirmed owner-private video brief version is required')
  const expected = videoBriefCreativeContent(draft, context, version.content?.title)
  // Compare all canonical values; a validation flag or displayed title is insufficient.
  if (Object.keys(version.content || {}).length !== Object.keys(expected).length
    || Object.keys(expected).some(key => exact(version.content[key]) !== exact(expected[key]))) throw new Error('The selected video brief differs from the confirmed settings or context')
  return version
}

export function requireVideoBriefVersion(input) {return inspectVideoBriefVersion(input,true)}
// Read-only settlement of an exact historic confirmation never grants Generate eligibility.
export function requireVideoBriefHistoryVersion(input) {return inspectVideoBriefVersion(input,false)}
