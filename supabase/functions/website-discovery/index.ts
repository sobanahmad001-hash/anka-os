import {createClient} from 'npm:@supabase/supabase-js@2.112.4'
import {siteOrigin,pinSite,readPinned} from './publicSite.ts'
import {discover} from './discover.js'
const headers={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'POST, OPTIONS','Access-Control-Allow-Headers':'authorization,apikey,content-type,x-client-info','Cache-Control':'no-store'}
const reply=(body:unknown,status=200)=>Response.json(body,{status,headers})
export async function handle(req:Request){
 if(req.method==='OPTIONS')return new Response(null,{headers})
 if(req.method!=='POST')return reply({error:'POST required'},405)
 const authorization=req.headers.get('authorization')
 if(!authorization?.startsWith('Bearer '))return reply({error:'Sign in required'},401)
 try{
  const {domain,organization,project}=await req.json()
  if(typeof domain!=='string'||domain.length>255)return reply({error:'Enter a public HTTPS domain.'},400)
  const origin=siteOrigin(domain)
  const db=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_ANON_KEY')!,{global:{headers:{Authorization:authorization}},auth:{persistSession:false}})
  const auth=await db.rpc('website_import_context',{p_org:organization,p_project:project})
  if(auth.error)return reply({error:'Website management access required.'},403)
  const ip=await pinSite(new URL(origin).hostname)
  const report=await discover(origin,(url:URL,timeout:number)=>readPinned(url,ip,timeout))
  return reply(report)
 }catch{return reply({error:'Discovery could not read this public HTTPS site. No pages were saved.'},422)}
}
if(import.meta.main)Deno.serve(handle)
