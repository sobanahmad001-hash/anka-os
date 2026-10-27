const uuid=x=>typeof x==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(x)
export function createProjectWorkshopResultsRepository(client){
 return Object.freeze({async read({organizationId,projectId,engagementId},signal){
  if(![organizationId,projectId,engagementId].every(uuid)||signal?.aborted)throw Error('Exact project result context required')
  let limited=false
  async function rows(table,fields,filter){let q=client.from(table).select(fields).eq('organization_id',organizationId);for(const [key,value]of Object.entries(filter))q=Array.isArray(value)?q.in(key,value):q.eq(key,value);q=q.order(table==='wordpress_export_jobs'?'requested_at':'created_at',{ascending:false}).limit(101);if(signal&&q.abortSignal)q=q.abortSignal(signal);const{data,error}=await q;if(error)throw Error('Workshop result access unavailable; use its owning Workshop');if(signal?.aborted)throw Error('Result context changed');if(!Array.isArray(data)||data.some(r=>r.organization_id!==organizationId||Object.entries(filter).some(([k,v])=>Array.isArray(v)?!v.includes(r[k]):r[k]!==v)))throw Error('Workshop result scope differs');if(data.length>100)limited=true;return data.slice(0,100)}
  const engagement=await rows('engagements','id, organization_id, project_id',{id:engagementId,project_id:projectId});if(engagement.length!==1)throw Error('Exact project engagement is unavailable')
  const sessions=await rows('design_workshop_sessions','id, organization_id, engagement_id, project_task_id, engagement_work_item_id, created_at',{engagement_id:engagementId})
  if(!sessions.length)return {rows:[],limited:false}
  const directions=await rows('design_directions','id, organization_id, session_id, created_at',{session_id:sessions.map(s=>s.id)})
  const versions=directions.length?await rows('design_direction_versions','id, organization_id, direction_id, version_number, is_experimental, created_at',{direction_id:directions.map(d=>d.id),is_experimental:false}):[]
  const designs=versions.length?await rows('website_page_designs','id, organization_id, design_direction_version_id, slug, status, created_at',{design_direction_version_id:versions.map(v=>v.id)}):[]
  const jobs=designs.length?await rows('wordpress_export_jobs','id, organization_id, website_page_design_id, status, requested_at',{website_page_design_id:designs.map(d=>d.id)}):[]
  const output=designs.map(d=>{const version=versions.find(v=>v.id===d.design_direction_version_id),direction=directions.find(x=>x.id===version.direction_id),session=sessions.find(s=>s.id===direction.session_id);return {kind:'website_page_design',id:d.id,label:d.slug||'Saved Website design',status:d.status,versionId:version.id,versionNumber:version.version_number,sessionId:session.id,workRecord:session.project_task_id?{kind:'project_task',id:session.project_task_id}:session.engagement_work_item_id?{kind:'engagement_work_item',id:session.engagement_work_item_id}:null,jobs:jobs.filter(j=>j.website_page_design_id===d.id)}})
  return {organizationId,projectId,engagementId,rows:output,limited}
 }})
}
