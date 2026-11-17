import {createClient} from 'npm:@supabase/supabase-js@2.112.4'
import {googleAccessToken} from '../_shared/googleOAuthTokens.ts'
import {dateWindow,fetchBatch} from './provider.ts'
const headers={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization,apikey,x-client-info,content-type','Cache-Control':'no-store'}
const reply=(value:unknown,status=200)=>Response.json(value,{status,headers})
Deno.serve(async req=>{
 if(req.method==='OPTIONS')return new Response(null,{headers})
 if(req.method!=='POST')return reply({error:'POST required'},405)
 const auth=req.headers.get('Authorization')
 if(!auth?.startsWith('Bearer '))return reply({error:'Sign in required'},401)
 try{
  const url=Deno.env.get('SUPABASE_URL')!, db=createClient(url,Deno.env.get('SUPABASE_ANON_KEY')!,{global:{headers:{Authorization:auth}}})
  const body=await req.json(),{org,project,binding}=body
  const admin=createClient(url,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  if(body.action==='bind'){
   const {data:settings}=await db.rpc('gsc_settings',{p_org:org,p_project:project})
   if(settings?.revision!==body.revision||!settings?.choices.some((c:{connection:string,site:string})=>c.connection===body.connection&&c.site===body.site))return reply({error:'Property unavailable'},403)
   const token=await googleAccessToken(admin,body.connection,'google_search_console')
   const res=await fetch('https://www.googleapis.com/webmasters/v3/sites/'+encodeURIComponent(body.site),{headers:{Authorization:'Bearer '+token},redirect:'error',signal:AbortSignal.timeout(15000)})
   if(!res.ok)return reply({error:'Google denied property access'},403)
   const site=await res.json()
   if(site.siteUrl!==body.site||!['siteOwner','siteFullUser','siteRestrictedUser'].includes(site.permissionLevel))return reply({error:'Property access unverified'},403)
   const saved=await db.rpc('gsc_bind',{p_org:org,p_project:project,p_connection:body.connection,p_site:body.site,p_revision:body.revision})
   return saved.error?reply({error:'Binding changed'},409):reply(saved.data)
  }
  const {data:job,error}=await db.rpc('gsc_import_progress',{p_org:org,p_project:project,p_binding:binding,p_end:dateWindow().end})
  if(error||!job)return reply({error:'Project management and an active, authorized Website property binding are required.'},403)
  if(job.phase==='done')return reply({phase:'done'})
  const token=await googleAccessToken(admin,job.connection,'google_search_console')
  const rows=await fetchBatch(job.site,token,job.start_date,job.end_date,job.phase,job.cursor_offset)
  const saved=await admin.rpc('commit_gsc_batch',{p_org:org,p_project:project,p_run:job.id,p_phase:job.phase,p_offset:job.cursor_offset,p_rows:rows})
  if(saved.error)return reply({error:'Batch was not confirmed. Check the property binding and resume.'},409)
  return reply({phase:saved.data})
 }catch(e){return reply({error:e instanceof Error&&/^(Google returned HTTP|Search Console property access|Google did not confirm)/.test(e.message)?e.message:'Google authorization or import unavailable. Restore access and resume.'},503)}
})
