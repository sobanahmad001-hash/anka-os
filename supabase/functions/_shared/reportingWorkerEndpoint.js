import {runReportingVerification,reportingVerificationRpcStore} from './reportingVerificationWorker.js'
import {runReportingRefreshJob,reportingRefreshRpcStore} from './reportingRefreshWorker.js'
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const cors={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization,apikey,x-client-info,content-type','Access-Control-Allow-Methods':'POST, OPTIONS'}
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{...cors,'Content-Type':'application/json','Cache-Control':'no-store'}})
const exact=(body,keys)=>body&&typeof body==='object'&&!Array.isArray(body)&&Object.keys(body).length===keys.length&&keys.every(k=>Object.hasOwn(body,k))
const id=value=>typeof value==='string'&&UUID.test(value)
const day=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value+'T00:00:00Z'))&&new Date(value+'T00:00:00Z').toISOString().slice(0,10)===value
async function boundedBody(request){
 if(!request.body)throw new Error('Body required')
 const reader=request.body.getReader();const chunks=[];let total=0
 try{for(;;){const {done,value}=await reader.read();if(done)break;total+=value.byteLength;if(total>8192)throw new Error('Body too large');chunks.push(value)}}finally{await reader.cancel().catch(()=>{});reader.releaseLock()}
 const bytes=new Uint8Array(total);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength}return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes))
}
export async function reportingMachineAuthenticated(request,secret){
 const supplied=request.headers.get('x-anka-reporting-worker')||''
 if(typeof secret!=='string'||secret.length<32||secret.length>512||supplied.length<32||supplied.length>512)return false
 const digest=async value=>new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)))
 const [a,b]=await Promise.all([digest(secret),digest(supplied)]);let difference=0;for(let i=0;i<a.length;i++)difference|=a[i]^b[i];return difference===0
}
export function reportingScheduleConfiguration(encoded){
 const parsed=JSON.parse(encoded||'[]')
 if(!Array.isArray(parsed)||parsed.length>25)throw new Error('Explicit bounded schedules required')
 const seen=new Set()
 for(const entry of parsed){
  if(!exact(entry,['organization_id','policy_ids','max_jobs'])||!id(entry.organization_id)||seen.has(entry.organization_id)||!Array.isArray(entry.policy_ids)||entry.policy_ids.length<1||entry.policy_ids.length>25||entry.policy_ids.some(x=>!id(x))||new Set(entry.policy_ids).size!==entry.policy_ids.length||!Number.isInteger(entry.max_jobs)||entry.max_jobs<1||entry.max_jobs>4)throw new Error('Exact schedule configuration required')
  seen.add(entry.organization_id)
 }
 return parsed
}
/** @returns {Array<{organization_id:string,policy_ids:string[],max_jobs:number}>} */
const noSchedules=()=>[]
export function createReportingWorkerHandler({getUserClient,getAdminClient,adapters,machineSecret=()=>'',schedules=noSchedules,uuid=()=>crypto.randomUUID()}){
 return async request=>{
  if(request.method==='OPTIONS')return new Response(null,{status:204,headers:cors})
  if(request.method!=='POST')return json({error:'Method not allowed'},405)
  let body;try{body=await boundedBody(request)}catch{return json({error:'Invalid bounded request'},400)}
  if(body?.action==='tick'){
   if(!exact(body,['action','organization_id'])||!id(body.organization_id))return json({error:'Exact scheduled organization required'},400)
   if(!await reportingMachineAuthenticated(request,machineSecret()))return json({error:'Trusted scheduler required'},401)
   let config;try{config=schedules().find(x=>x.organization_id===body.organization_id)}catch{return json({error:'Schedule configuration invalid'},503)}
   if(!config)return json({error:'No schedule activated for this organization'},403)
   if(!Array.isArray(adapters)||adapters.length===0)return json({state:'adapter_unavailable',dispatch_authorized:false},503)
   try{
    const admin=await getAdminClient();const {data:admission,error}=await admin.rpc('schedule_project_reporting_refresh',{p_organization_id:body.organization_id,p_policy_ids:config.policy_ids})
    if(error)return json({error:'Scheduled policy review required'},403)
    // A lost enqueue acknowledgement stops here. A later wake reuses native deduplication.
    const {data:due,error:dueError}=await admin.rpc('list_due_project_reporting_refreshes',{p_organization_id:body.organization_id,p_limit:25})
    if(dueError||!Array.isArray(due?.items)||due.items.length>25)return json({error:'Due work could not be read'},503)
    const seen=new Set(),jobs=[]
    for(const job of due.items){if(id(job?.job_id)&&config.policy_ids.includes(job.policy_id)&&!seen.has(job.job_id)){seen.add(job.job_id);jobs.push(job)}}
    const outcomes=[]
    for(const job of jobs.slice(0,config.max_jobs))outcomes.push(await runReportingRefreshJob({jobId:job.job_id,claimId:uuid(),store:reportingRefreshRpcStore(admin),adapters}))
    return json({admission,outcomes,dispatch_authorized:false})
   }catch{return json({state:'outcome_unknown',dispatch_authorized:false,automatic_retry:false},503)}
  }
  const recovery=body?.action==='recover_verification'||body?.action==='recover_refresh'
  const verify=body?.action==='verify',refresh=body?.action==='refresh'
  const keys=recovery?['action','organization_id','project_id','request_id']:verify?['action','organization_id','project_id','binding_id','policy_id','request_id']:['action','organization_id','project_id','binding_id','policy_id','request_id','period_start','period_end']
  if((!recovery&&!verify&&!refresh)||!exact(body,keys)||keys.filter(k=>k.endsWith('_id')).some(k=>!id(body[k]))||(refresh&&(!day(body.period_start)||!day(body.period_end)||body.period_end<body.period_start)))return json({error:'Exact original reporting request required'},400)
  let user
  try{user=await getUserClient(request)}catch{return json({error:'Authentication required'},401)}
  const args={p_organization_id:body.organization_id,p_project_id:body.project_id,p_request_id:body.request_id}
  const recoverName=(verify||body.action==='recover_verification')?'get_project_reporting_verification_operation':'get_project_reporting_refresh_operation'
  try{
   if(recovery){const {data,error}=await user.rpc(recoverName,args);return error?json({error:'Original operation access denied'},403):json({data,dispatch_authorized:false})}
   if(!Array.isArray(adapters)||adapters.length===0)return json({state:'adapter_unavailable',dispatch_authorized:false},503)
   const startName=verify?'begin_project_reporting_verification':'request_project_reporting_refresh'
   const startArgs={...args,p_binding_id:body.binding_id,p_policy_id:body.policy_id,...(refresh?{p_period_start:body.period_start,p_period_end:body.period_end}:{})}
   const {data,error}=await user.rpc(startName,startArgs)
   if(error)return json({error:'Reporting request rejected; review current authority and configuration',code:typeof error.code==='string'&&/^[0-9A-Z]{5}$/.test(error.code)?error.code:null},403)
   if(data?.replayed===true){const {data:original,error:recoveryError}=await user.rpc(recoverName,args);return recoveryError?json({state:'outcome_unknown',dispatch_authorized:false,automatic_retry:false},503):json({data:original,dispatch_authorized:false,recovered:true})}
   if(verify?data?.challenge_id!==body.request_id:!id(data?.job_id))return json({state:'outcome_unknown',dispatch_authorized:false,automatic_retry:false},503)
   const admin=await getAdminClient()
   const result=verify?await runReportingVerification({challengeId:body.request_id,claimId:uuid(),store:reportingVerificationRpcStore(admin),adapters}):await runReportingRefreshJob({jobId:data.job_id,claimId:uuid(),store:reportingRefreshRpcStore(admin),adapters})
   return json({data:result,dispatch_authorized:false})
  }catch{return json({state:'outcome_unknown',dispatch_authorized:false,automatic_retry:false},503)}
 }
}
