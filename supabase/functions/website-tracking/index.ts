import {createClient} from 'npm:@supabase/supabase-js@2.112.4'
import {createDailyGscAdapter} from '../_shared/dailyGscAdapter.js'
import {dailyGscTokenReader} from '../_shared/dailyGscCredentials.ts'
import {runReportingRefreshJob,reportingRefreshRpcStore} from '../_shared/reportingRefreshWorker.js'
import {runReportingVerification,reportingVerificationRpcStore} from '../_shared/reportingVerificationWorker.js'
import {observeTrackedPage} from '../_shared/observeTrackedPage.ts'
import {runTrackingBatch} from '../_shared/websiteTrackingBatch.js'
import manifest from './manifest.json' with {type:'json'}
const headers={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization,apikey,x-client-info,content-type','Cache-Control':'no-store'}
const reply=(body:unknown,status=200)=>Response.json(body,{status,headers})
Deno.serve(async req=>{
 if(req.method==='OPTIONS')return new Response(null,{headers})
 if(req.method!=='POST')return reply({error:'POST required'},405)
 try{
  if(Number(req.headers.get('content-length'))>8192)return reply({error:'Request too large'},413)
  const body=await req.json(),url=Deno.env.get('SUPABASE_URL')!
  const admin=createClient(url,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false,autoRefreshToken:false}})
  const adapter=createDailyGscAdapter({getToken:dailyGscTokenReader(admin),manifestSha256:manifest.adapter.manifestSha256})
  if(body.action==='tick'){
   const key=req.headers.get('x-anka-website-worker')||''
   if(key.length<32||key.length>128)return reply({error:'Scheduler authentication required'},401)
   const checked=await admin.rpc('website_tracking_machine_key',{p_key:key})
   if(checked.error||checked.data!==true)return reply({error:'Scheduler authentication required'},401)
   const due=await admin.rpc('website_tracking_due',{p_limit:4})
   if(due.error)return reply({error:'Tracking queue unavailable'},503)
   const reporting=await Promise.all((due.data||[]).map((job:{job_id:string})=>runTrackingBatch({run:()=>runReportingRefreshJob({jobId:job.job_id,claimId:crypto.randomUUID(),store:reportingRefreshRpcStore(admin),adapters:[adapter]})})))
   const pages=await admin.rpc('claim_website_observations',{p_limit:4})
   if(pages.error)return reply({error:'Observation queue unavailable'},503)
   const outcomes=await Promise.all((pages.data||[]).map(async(page:{url:string,project:string,page:string,claim:string})=>{
    const snapshot=await observeTrackedPage(page.url)
    const saved=await admin.rpc('commit_website_observation',{p_project:page.project,p_page:page.page,p_claim:page.claim,p_snapshot:snapshot})
    return !saved.error
   }))
   return reply({reporting,observed:outcomes.filter(Boolean).length})
  }
  const authorization=req.headers.get('authorization')||''
  const user=createClient(url,Deno.env.get('SUPABASE_ANON_KEY')!,{global:{headers:{Authorization:authorization}}})
  const identity=await user.auth.getUser();if(identity.error||!identity.data.user)return reply({error:'Sign in required'},401)
  if(body.action==='recheck'){
   const saved=await user.rpc('request_website_observation',{p_org:body.org,p_project:body.project,p_page:body.page})
   return saved.error?reply({error:saved.error.message},403):reply({queued:saved.data})
  }
  if(body.action==='observations'){
   const saved=await user.rpc('configure_website_observations',{p_org:body.org,p_project:body.project,p_enabled:body.enabled})
   return saved.error?reply({error:saved.error.message},403):reply({enabled:body.enabled})
  }
  if(body.action!=='configure')return reply({error:'Unknown action'},400)
  const configured=await user.rpc('configure_website_tracking',{p_org:body.org,p_project:body.project,p_engagement:body.engagement,p_department:body.department,p_enabled:body.enabled})
  if(configured.error)return reply({error:configured.error.message},403)
  if(!body.enabled)return reply(configured.data)
  const request=crypto.randomUUID(),started=await user.rpc('begin_project_reporting_verification',{p_organization_id:body.org,p_project_id:body.project,p_binding_id:configured.data.binding,p_policy_id:configured.data.policy,p_request_id:request})
  if(started.error)return reply({error:'Tracking configured; exact property verification is required. Retry enable.'},409)
  const verified=await runReportingVerification({challengeId:request,claimId:crypto.randomUUID(),store:reportingVerificationRpcStore(admin),adapters:[adapter]})
  return reply({...configured.data,verification:verified})
 }catch{return reply({error:'Tracking unavailable. Check current property access and retry.'},503)}
})
