export const brandingGroups = [
  {title:'Brand strategy & messaging', items:[
    {key:'brand_statement',label:'Brand statement'},
    {key:'messaging_guide',label:'Messaging guide'},
    {key:'tone_of_voice',label:'Tone of voice'},
  ]},
  {title:'Visual identity', items:[
    {key:'mood_board',label:'Mood board'},
    {key:'logo_suite',label:'Logo suite',example:'Primary logo'},
    {key:'visual_identity_guide',label:'Visual identity guide'},
  ]},
]
export const brandKinds = brandingGroups.flatMap(group=>group.items)
export const brandingServiceSlugs = new Set([
  'setup_design_logo_design','setup_design_brand_guidelines','setup_design_visual_identity','brand_visual_identity','setup_design_moodboard',
  'setup_content_brand_positioning','setup_content_value_proposition','setup_content_tone_of_voice','vision_positioning',
])
export function approvedBrandVersion(deliverable,id) {
  const v=deliverable?.versions.find(row=>row.id===id)
  if(!v||v.withdrawn_at)return null
  const required=v.client_approval_required?'client_approval':'internal_quality'
  const allowed=['client_approved','delivered_published'].includes(v.review_status)||
    (!v.client_approval_required&&['ready_for_client_review','client_reviewing'].includes(v.review_status))
  return allowed && v.approvals.some(a=>a.decision==='approved' && a.approval_type===required)?v:null
}
