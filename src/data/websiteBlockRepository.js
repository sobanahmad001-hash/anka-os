const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
function id(v){if(typeof v!=='string'||!UUID.test(v))throw Error('Exact native build identity required');return v}
const context=s=>({p_organization_id:id(s.organizationId),p_project_id:id(s.projectId),p_engagement_id:id(s.engagementId)})
const same=(v,s)=>v?.organization_id===s.organizationId&&v?.project_id===s.projectId&&v?.engagement_id===s.engagementId
export function createWebsiteBlockRepository(client){
 async function read(name,args,signal){if(signal?.aborted)throw Error('Build context changed');let q=client.rpc(name,args);if(signal&&q.abortSignal)q=q.abortSignal(signal);const{data,error}=await q;if(error)throw Error(error.message);if(signal?.aborted)throw Error('Build context changed');return data}
 async function invoke(body,signal){if(signal?.aborted)throw Error('Build context changed');const{data,error}=await client.functions.invoke('website-native-build',{body,signal});let detail=data;if(error?.context?.clone)try{detail=await error.context.clone().json()}catch{/* Uncertain request must recover. */}
  if(error||detail?.error)throw Object.assign(Error(detail?.error||error?.message||'Build outcome could not be verified'),{knownRollback:detail?.rollback_verified===true})
  if(signal?.aborted)throw Error('Build context changed');return data?.data}
 const bodyScope=s=>({organization_id:id(s.organizationId),project_id:id(s.projectId),engagement_id:id(s.engagementId)})
 return Object.freeze({
  async workspace(s,{designId=null,requestId=null,offset=0,signal}={}){const d=await read('get_website_block_workspace',{...context(s),p_design_id:designId?id(designId):null,p_request_id:requestId?id(requestId):null,p_offset:offset},signal);if(!same(d,s)||!Array.isArray(d.designs)||!Array.isArray(d.jobs)||d.jobs.some(j=>!same(j,s)))throw Error('Native build history belongs to another context');return d},
  async review(s,designId,{signal}={}){const d=await read('get_website_block_review',{...context(s),p_design_id:id(designId)},signal);if(!same(d,s)||d.design_id!==designId||!same(d.manifest?.scope,s)||!/^[a-f0-9]{64}$/.test(d.review_sha256||''))throw Error('Native source review differs from exact selection');return d},
  async build(s,{designId,requestId,reviewSha256,signal}){if(!/^[a-f0-9]{64}$/.test(reviewSha256||''))throw Error('Review the exact saved native design');const d=await invoke({action:'build',...bodyScope(s),design_id:id(designId),request_id:id(requestId),review_sha256:reviewSha256},signal);if(!same(d,s)||d.request_id!==requestId||d.website_page_design_id!==designId)throw Error('Build receipt differs; recover the original request');return d},
  async download(s,job,kind,{signal}={}){if(!['package','source'].includes(kind))throw Error('Exact artifact kind required');const d=await invoke({action:'download',...bodyScope(s),job_id:id(job.id),kind},signal);if(!same(d,s)||d.id!==job.id||!d.checksum_verified)throw Error('Artifact differs from original package')
   const url=new URL(d.download_url),origin=new URL(client.supabaseUrl).origin,base='/storage/v1/object/sign/wordpress-theme-exports/'+s.organizationId+'/'+job.website_page_design_id+'/'+job.id+'/'
   if(url.protocol!=='https:'||url.origin!==origin||url.pathname!==base+(kind==='source'?'source.zip':'native-block.zip')||d.download_expires_in!==300)throw Error('Native artifact destination differs');return d}
 })
}
