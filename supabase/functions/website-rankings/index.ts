import {createClient} from 'npm:@supabase/supabase-js@2.112.4'

const cors={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization,apikey,x-client-info,content-type','Access-Control-Allow-Methods':'POST, OPTIONS'}
const reply=(data:unknown,status=200)=>Response.json(data,{status,headers:{...cors,'Cache-Control':'no-store'}})
const iso=(n:number)=>new Date(n).toISOString().slice(0,10)
const uuid=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i
type Binding={organization:string,account:string,site:string,key:string}
type Page={id:string,url:string,targets:{query:string}[],sourceTargets:{source:{term:string}}[],mode:string}
function belongs(page:string,site:string) {
  try {
    const url=new URL(page)
    if(!['http:','https:'].includes(url.protocol)||url.username||url.password)return false
    if(site.startsWith('sc-domain:')){
      const domain=site.slice(10).toLowerCase()
      return !!domain&&(url.hostname===domain||url.hostname.endsWith('.'+domain))
    }
    const base=new URL(site)
    return url.origin===base.origin && url.href.startsWith(base.href)
  }catch{return false}
}
const metric=(v:unknown)=>typeof v==='number' || (typeof v==='string' && v.trim()!=='') ? Number(v) : NaN
export async function handle(req:Request, env=(key:string)=>Deno.env.get(key), get:typeof fetch=fetch) {
  if(req.method==='OPTIONS')return new Response(null,{headers:cors})
  if(req.method!=='POST')return reply({error:'POST required'},405)
  const auth=req.headers.get('Authorization')
  if(!auth?.startsWith('Bearer '))return reply({error:'Sign in required'},401)
  try{
    const {organization,project,page,start,end,country='',device=''}=await req.json()
    const first=Date.parse(start+'T00:00:00Z'),last=Date.parse(end+'T00:00:00Z')
    if(![organization,project,page].every(v=>typeof v==='string'&&uuid.test(v))||!Number.isFinite(first)||!Number.isFinite(last)||iso(first)!==start||iso(last)!==end||last<first||last-first>=93*86400000||typeof country!=='string'||country.length>80||typeof device!=='string'||device.length>40)return reply({error:'Invalid reporting scope'},400)
    const db=createClient(env('SUPABASE_URL')!,env('SUPABASE_ANON_KEY')!,{global:{headers:{Authorization:auth},fetch:get},auth:{persistSession:false}})
    const inventory=()=>db.rpc('website_manual_inventory',{p_org:organization,p_project:project})
    const result=await inventory()
    if(result.error)return reply({error:'Project unavailable'},403)
    const selected=(result.data as Page[]).find(p=>p.id===page)
    if(!selected)return reply({error:'Page unavailable'},404)
    const binding:Binding|undefined=JSON.parse(env('WINDSOR_GSC_PROJECTS')||'{}')[project]
    if(!binding||binding.organization!==organization||!binding.key||!binding.account||!binding.site)return reply({state:'unconfigured',rows:[]})
    if(!belongs(selected.url,binding.site))return reply({state:'outside_property',rows:[]})
    const previous=iso(first-(last-first+86400000))
    const params=new URLSearchParams({api_key:binding.key,_select_accounts:binding.account,date_from:previous,date_to:end,fields:'account_id,site,date,page,query,country,device,clicks,impressions,position',_renderer:'json'})
    const res=await get('https://connectors.windsor.ai/searchconsole?'+params,{redirect:'error',signal:AbortSignal.timeout(25000)})
    if(!res.ok)return reply({state:'provider_unavailable',rows:[]})
    const payload=await res.json()
    if(!Array.isArray(payload.data)||payload.next||payload.next_page||payload.error||payload.data.length>50000)return reply({state:'incomplete',rows:[]})
    const terms=new Set(selected.mode==='undecided'?selected.sourceTargets.map(t=>t.source.term):selected.targets.map(t=>t.query))
    const rows=[]
    for(const row of payload.data){
      if(row.account_id!==binding.account||row.site!==binding.site||!belongs(row.page,binding.site))continue
      if(row.page!==selected.url&&!terms.has(row.query))continue
      if(typeof row.query!=='string'||typeof row.date!=='string'||typeof row.country!=='string'||typeof row.device!=='string')return reply({state:'incomplete',rows:[]})
      if(row.date<previous||row.date>end||(country&&country!==row.country)||(device&&device!==row.device))continue
      const clicks=metric(row.clicks),impressions=metric(row.impressions),position=metric(row.position)
      if(!Number.isSafeInteger(clicks)||!Number.isSafeInteger(impressions)||clicks<0||impressions<clicks||!Number.isFinite(position)||position<0)return reply({state:'incomplete',rows:[]})
      rows.push({page:row.page,query:row.query,date:row.date,country:row.country,device:row.device,clicks,impressions,position})
    }
    const check=await inventory()
    if(check.error||JSON.stringify((check.data as Page[]).find(p=>p.id===page))!==JSON.stringify(selected))return reply({error:'Page changed. Reopen the report.'},409)
    return reply({state:'ready',rows})
  }catch{return reply({state:'unavailable',rows:[]},503)}
}
if(import.meta.main)Deno.serve(req=>handle(req))
