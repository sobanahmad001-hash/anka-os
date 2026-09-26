const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="650"><rect width="1000" height="650" fill="#ede6da"/><rect x="580" y="80" width="330" height="490" rx="160" fill="#746751"/><circle cx="745" cy="255" r="92" fill="#d6c6a8"/><text x="80" y="180" font-family="Georgia" font-size="32" fill="#403728">STUDIO / OFFLINE FIXTURE</text><text x="80" y="320" font-family="Georgia" font-size="82" fill="#403728">A quieter</text><text x="80" y="410" font-family="Georgia" font-size="82" fill="#403728">perspective.</text><text x="80" y="550" font-family="Arial" font-size="20" fill="#403728">Illustrative layout — not generated client media</text></svg>`
export const engagement = { id: 'preview-engagement', project_id: 'preview-project', organization_id: 'preview-org', name: 'Brand exploration · fixture' }
export const organization = { activeOrganizationId:'preview-org', scopeRevision:1, activeMembership:{departmentId:'design'}, requestSignal:new AbortController().signal, handleOrganizationAccessError() {}, selectOrganization() {} }
const conversation = { id:'preview-conversation', owner_id:'preview-user',title:'Quiet editorial · offline fixture',state:'active',access_role:'owner',last_activity_at:'2026-09-26T10:00:00Z' }
export const chatRepository = {
  searchConversations:async()=>({items:[conversation],next_cursor:null}), listConversations:async()=>[conversation],
  getConversation:async()=>({conversation,messages:[{id:'fixture-message',role:'user',author_id:'preview-user',status:'completed',body:'Let’s explore the quiet editorial reference. This is an offline fixture, not a live saved conversation.',created_at:'2026-09-26T10:00:00Z'}],sharing:{can_manage:false,recipients:[]}}),
  getCapabilities:async()=>({provider:'openai',approved_models:[],attachments:{supported:false},answer_readiness:{paid_execution_enabled:false,spend_tracking_configured:false,model_price_available:[]}}),
  listAttachments:async()=>[],listSourceVersions:async()=>[],listConversationShareCandidates:async()=>[],getUnsentDraft:async()=>null,
  createConversation:async()=>conversation,saveUnsentDraft:async()=>({}),discardUnsentDraft:async()=>true,
  answer:async()=>{throw new Error('Offline fixture: AI calls disabled')},
}
const version = { id: 'preview-version-1', direction_id: 'preview-direction', organization_id: 'preview-org', is_experimental: false, version_number: 1, content: { title: 'Quiet editorial', creative_thesis: 'Warm neutrals, generous spacing and a restrained editorial composition.', imagery_direction: 'An illustrative studio composition — offline fixture only.' } }
const data = { engagement, designServices: [{ id:'preview-service', engagement_id:engagement.id, status:'active', service_catalog:{ department_id:'design',is_active:true } }], sessions:[{id:'preview-session',engagement_id:engagement.id,organization_id:'preview-org',engagement_service_id:'preview-service'}], directions:[{id:'preview-direction',session_id:'preview-session',organization_id:'preview-org'}], directionVersions:[version], models:[{id:'preview-model',display_name:'Offline fixture · generation disabled',is_active:true,supported_output_types:['image']}], imageGenerationJobs:[], mediaAssets:[{id:'preview-image-1',design_direction_version_id:version.id,media_type:'image',status:'ready',prompt:'Editorial composition · fixture',signed_url:'data:image/svg+xml;charset=utf-8,'+encodeURIComponent(svg)}] }
let videoUrl = ''
export function setVideoFixture(url) { videoUrl = url }
export const studio = {
  load: async () => structuredClone(data),
  generateImage: async () => { throw new Error('Offline preview: generation disabled; no request was sent.') },
  generateVideo: async () => { throw new Error('Offline preview: generation disabled; no request was sent.') },
  listVideoJobs: async () => [{id:'preview-job',status:'ready',mode:'explore',duration_seconds:1,resolution:'720p',created_at:'2026-09-26T10:00:00Z'}],
  getVideoQuote: async () => ({ paid_execution_enabled:false, quote:null }),
  signVideoOutput: async () => { if (!videoUrl) throw new Error('Local clip unavailable'); return {signed_url:videoUrl} },
  listEngagements: async () => [{...engagement,engagement_services:[{id:'preview-service',status:'active',service_catalog:{department_id:'design',is_active:true,name:'Design · fixture'}}]}],
  previewVideoPromotion: async () => ({checksum:'fixture-checksum',name:'Local animation fixture',mime_type:'video/webm',rights_notes:'Offline illustration; no production rights record.'}),
  promotePrivateVideo: async () => ({version_id:'SIMULATED-NOT-SAVED',status:'draft'}),
}
