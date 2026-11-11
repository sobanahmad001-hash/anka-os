import {scanChunk} from './scan.js'
import {createClient} from 'npm:@supabase/supabase-js@2.112.4'
import {siteOrigin,pinSite,readPinned} from './publicSite.ts'
import {discover} from './discover.js'
const headers={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'POST, OPTIONS','Access-Control-Allow-Headers':'authorization,apikey,content-type,x-client-info','Cache-Control':'no-store'}
const reply=(body:unknown,status=200)=>Response.json(body,{status,headers})
export async function handle(req:Request,transport={pin:pinSite,read:readPinned}){
 if(req.method==='OPTIONS')return new Response(null,{headers})
 if(req.method!=='POST')return reply({error:'POST required'},405)
 const authorization=req.headers.get('authorization')
 if(!authorization?.startsWith('Bearer '))return reply({error:'Sign in required'},401)
 try{
  const {domain,organization,project,job}=await req.json()
  if(!job && (typeof domain!=='string'||domain.length>255))return reply({error:'Enter a public HTTPS domain.'},400)
  const db=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_ANON_KEY')!,{global:{headers:{Authorization:authorization}},auth:{persistSession:false}})
  if(job){
   const scope={p_org:organization,p_project:project,p_job:job}
   const {data:state,error}=await db.rpc('website_scan_status',scope)
   if(error||!state)return reply({error:'Scan unavailable.'},403)
   const origin=siteOrigin(state.origin)
   if(!state.tasks.length)return reply({remaining:0})
   const ip=await transport.pin(new URL(origin).hostname)
   const results=await scanChunk(state,(url:URL,timeout:number)=>transport.read(url,ip,timeout))
   if(!results.length)return reply({error:'No discovery progress. Resume this scan.'},503)
   const writer=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false,autoRefreshToken:false}})
   const saved=await writer.rpc('website_scan_checkpoint',{...scope,p_actor:state.actor,p_revision:state.revision,p_results:results})
   if(saved.error)return reply({error:'Check saved progress before resuming.'},409)
   return reply({revision:saved.data})
  }
  const origin=siteOrigin(domain)
  const auth=await db.rpc('website_import_context',{p_org:organization,p_project:project})
  if(auth.error)return reply({error:'Website management access required.'},403)
  const ip=await transport.pin(new URL(origin).hostname)
  const report=await discover(origin,(url:URL,timeout:number)=>transport.read(url,ip,timeout))
  return reply(report)
 }catch{return reply({error:'Discovery could not read this public HTTPS site. No pages were saved.'},422)}
}
if(import.meta.main)Deno.serve(req=>handle(req))
