const types = {'image/png':['png'],'image/jpeg':['jpg','jpeg'],'video/mp4':['mp4'],'video/quicktime':['mov']}
const stable = value => JSON.stringify(value, (_key, item) => item && typeof item==='object' && !Array.isArray(item) ? Object.fromEntries(Object.entries(item).sort(([a],[b])=>a.localeCompare(b))) : item)
const uuid = value => typeof value==='string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value)
function url(value){const parsed=new URL(value);if(!['https:','http:'].includes(parsed.protocol)||parsed.username||parsed.password)throw Error('Original URL is invalid');return value}
export function validateGeneratedOriginal(expected, actual, {organizationId,conversationId=null,download=false}={}) {
 if(!uuid(expected?.id)||!uuid(expected?.operation_key)||actual?.id!==expected.id||actual.operation_key!==expected.operation_key||actual.status!=='ready'||actual.request?.organization_id!==organizationId||stable(actual.request)!==stable(expected.request))throw Error('Original request identity changed')
 if(conversationId && (expected.conversation_id!==conversationId||actual.conversation_id!==conversationId))throw Error('Original conversation changed')
 if(expected.conversation_id && actual.conversation_id!==expected.conversation_id)throw Error('Original conversation association changed')
 if(!Array.isArray(actual.outputs)||actual.outputs.length!==actual.request.output_count||actual.outputs.length<1||actual.outputs.length>10)throw Error('Complete original output set required')
 for(const [index,output] of actual.outputs.entries()){
  const source=(expected.outputs||[]).find(row=>row.id===output.id)
  if(output.id!==actual.id+':'+index||!types[output.mime_type]?.includes(output.extension)||output.filename!==index+'.'+output.extension||!Number.isSafeInteger(output.byte_length)||output.byte_length<1||!/^[a-f0-9]{64}$/.test(output.checksum||''))throw Error('Original metadata changed')
  if((expected.outputs||[]).length && (!source||source.checksum!==output.checksum||source.mime_type!==output.mime_type||(source.byte_length!=null&&source.byte_length!==output.byte_length)||(source.extension&&source.extension!==output.extension)))throw Error('Original output checksum or format changed')
  url(download?output.download_url:output.signed_url)
  if(!Number.isFinite(Date.parse(output.expires_at))||Date.parse(output.expires_at)<=Date.now())throw Error('Original URL lifetime unavailable')
 }
 return actual
}
export function createGeneratedOriginalAccess({studio,organizationId,userId,signal}) {
 const inflight=new Map()
 return {read(job,{conversationId=null,download=false}={}){
  if(signal?.aborted||!uuid(job?.id)||!uuid(job?.operation_key)||job.request?.organization_id!==organizationId||(conversationId&&job.conversation_id!==conversationId))return Promise.reject(Error('Design access changed'))
  const key=stable([organizationId,userId,conversationId,job.id,job.operation_key,job.request,job.outputs?.map(row=>[row.id,row.checksum]),download])
  if(inflight.has(key))return inflight.get(key)
  const request=Promise.resolve().then(()=>studio.signMediaGeneration({operation_key:job.operation_key,...(conversationId?{conversation_id:conversationId}:{}),...(download?{download:true}:{})})).then(result=>{if(signal?.aborted)throw Error('Design access changed');return validateGeneratedOriginal(job,result,{organizationId,conversationId,download})}).finally(()=>inflight.delete(key))
  inflight.set(key,request);return request
 }}
}
export function freshGeneratedPreview(job,scope){try{if(job.outputs?.every(row=>Date.parse(row.expires_at)>Date.now()+5000))return validateGeneratedOriginal(job,job,scope)}catch{/* Expired or incomplete metadata requires a new authorized read. */}return null}
