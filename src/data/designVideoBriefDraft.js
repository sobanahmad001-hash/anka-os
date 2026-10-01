import { VIDEO_BRIEF_FIELDS, validateVideoBrief } from '../../supabase/functions/_shared/designVideoBrief.js'
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i
const SETTINGS=['mode','duration_seconds','aspect_ratio','resolution','output_format','generate_audio']
const KEYS=[...VIDEO_BRIEF_FIELDS.map(([key])=>key),...SETTINGS]
export const VIDEO_DRAFT_TTL_MS=60*60*1000
export function videoBriefScopeKey(actorId,organizationId,context) {
 const entries=Object.entries(context || {}).filter(([,value])=>value)
 if (![actorId,organizationId].every(value=>UUID.test(value || '')) || entries.length!==1 || Object.keys(context).length!==1 || !['private_conversation_id','direction_version_id'].includes(entries[0][0]) || !UUID.test(entries[0][1])) throw new Error('One exact actor, organization and video context is required')
 return `${actorId}:${organizationId}:${entries[0][0]}:${entries[0][1]}`
}
function boundedDraft(value) {
 if (!value || typeof value!=='object' || Array.isArray(value) || Object.keys(value).length!==KEYS.length || Object.keys(value).some(key=>!KEYS.includes(key))) throw new Error('Stored video draft has unexpected fields')
 for (const [key,,limit] of VIDEO_BRIEF_FIELDS) if (typeof value[key]!=='string' || value[key].length>limit) throw new Error('Stored video draft exceeds its field bounds')
 if (!['explore','production'].includes(value.mode) || !(value.duration_seconds==='' || Number.isInteger(value.duration_seconds) && value.duration_seconds>=4 && value.duration_seconds<=30) || !['','480p','720p'].includes(value.resolution) || !['16:9','4:3','1:1','3:4','9:16','21:9'].includes(value.aspect_ratio) || !['mp4','mov'].includes(value.output_format) || typeof value.generate_audio!=='boolean') throw new Error('Stored video draft has invalid settings')
 return structuredClone(value)
}
export function writeVideoBriefDraft(storage,key,draft,now=Date.now()) {
 const value=boundedDraft(draft),encoded=JSON.stringify({draft:value,savedAt:now})
 storage.setItem(`anka-video-brief-draft:${key}`,encoded)
 if (storage.getItem(`anka-video-brief-draft:${key}`)!==encoded) throw new Error('Scoped video draft storage is unavailable')
}
export function readVideoBriefDraft(storage,key,now=Date.now()) {
 const raw=storage.getItem(`anka-video-brief-draft:${key}`);if (!raw) return null
 const record=JSON.parse(raw)
 if (!Number.isFinite(record.savedAt) || record.savedAt>now || now-record.savedAt>=VIDEO_DRAFT_TTL_MS) { storage.removeItem(`anka-video-brief-draft:${key}`);return null }
 return boundedDraft(record.draft)
}
export function clearVideoBriefDraft(storage,key) {storage.removeItem(`anka-video-brief-draft:${key}`)}
export function exactVideoBriefAttempt(record,context) {
 const input=record?.input
 if (!input || Object.keys(record).some(key=>!['operation_key','input'].includes(key)) || !UUID.test(record.operation_key || '') || input.operation_key!==record.operation_key || Object.keys(input).some(key=>![...Object.keys(context),'creative_brief_id','expected_revision','operation_key','video_brief'].includes(key)) || Object.keys(input).length!==Object.keys(context).length+4 || Object.keys(context).some(key=>input[key]!==context[key]) || !Number.isInteger(input.expected_revision) || input.expected_revision<0 || !(input.creative_brief_id===null || UUID.test(input.creative_brief_id || '')) || !validateVideoBrief(input.video_brief).valid) throw new Error('Original brief confirmation data is unavailable; read exact saved history before proceeding')
 return structuredClone(input)
}
