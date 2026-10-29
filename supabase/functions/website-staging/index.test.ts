import {handler} from './index.ts'
import {buildWebsiteBlockSource} from '../_shared/websiteBlockBuild.js'
import {sha,publicAddress} from '../_shared/websiteStaging.js'
import {createStoredZip} from '../wordpress-export/theme.ts'
import {websiteNativeFixture} from '../../../tools/website-native-fixture.js'
const assert=(v:unknown,message='Staging assertion failed')=>{if(!v)throw Error(message)}
const id=(n:number)=>'a0000000-0000-4000-8000-'+String(n).padStart(12,'0'),origin='https://stage.example.test'
async function fixture(){
 const manifest=await websiteNativeFixture('home'),built=await buildWebsiteBlockSource(manifest),bytes=createStoredZip(Object.entries(built.files).sort(([a],[b])=>a.localeCompare(b)).map(([name,text])=>({name:built.directory+'/'+name,bytes:new TextEncoder().encode(text)}))),checksum=await sha(bytes)
 const scope={organization_id:id(1),project_id:id(2),engagement_id:id(3)},target={...scope,id:id(8),site_id:id(9),base_url:origin},connection={id:id(7),base_url:origin,revision:'2026-10-27T20:00:00Z',username:'fixture-user',secret_name:'ANKA_WORDPRESS_FIXTURE'}
 const job={id:id(6),organization_id:id(1),website_page_design_id:id(5),storage_path:id(1)+'/'+id(5)+'/'+id(6)+'/native-block.zip',artifact_sha256:checksum,seo_verification:{package_bytes:bytes.byteLength,file_hashes:built.file_hashes}},source={manifest,context:{page:{path:'fixture-home'}}},base={target,connection,job,source,page_id:id(4),review_sha256:'a'.repeat(64)}
 const state:any={calls:[],requests:[],run:null,result:null,remote:false,head:null,lost:false,badPreview:false,badIdentity:false,privateDns:false,disabledOrigin:false,revokeDispatch:false,corrupt:false,dispatches:0,role:'contributor',department:'development'}
 const admin:any={rpc:async(name:string,args:any)=>{
  state.calls.push(name)
  if(name==='get_website_staging_dispatch'){
   state.dispatches++;if(state.revokeDispatch&&state.run)return {error:{code:'42501',message:'Current authority revoked'}}
   return {data:{...base,remote_head:args.p_remote_head}}
  }
  if(name==='get_website_staging_recovery')return {data:state.run?{...base,run:state.run,result:state.result}:null}
  if(name==='start_website_staging_run'){
   const created=!state.run;state.run||={...scope,id:id(11),target_id:id(8),job_id:id(6),page_id:id(4),request_id:args.p_request_id,created_by:id(12),created_at:new Date().toISOString(),remote_head:args.p_remote_head,review_sha256:args.p_review_sha256,previous_run_id:args.p_previous_run_id};return {data:{created,run:state.run}}
  }
  if(name==='record_website_staging_result'){if(state.revokeDispatch)return {error:{code:'42501',message:'Current authority revoked'}};state.result={outcome:args.p_outcome,evidence:args.p_evidence};return {data:state.result}}
  if(name==='bind_website_staging_target')return {data:{...target,request_id:args.p_request_id,connection_id:id(7)}}
  throw Error('Unexpected RPC '+name)
 },storage:{from:()=>({download:async()=>({data:new Blob([state.corrupt?new Uint8Array([0]):bytes],{type:'application/zip'})})})}}
 const identity=()=>({protocol:'anka-stage-v1',wordpress_version:'7.1.3',php_version:'8.3.33',compiler:'anka-native-block-v1',environment:state.badIdentity?'production':'staging',site_id:id(9),base_url:origin,published:false})
 const receipt=()=>({...identity(),request_id:state.run.request_id,page_id:id(4),package_sha256:checksum,status:state.remote?'staged':'missing',preview_url:origin+'/?anka_staging_preview='+state.run.request_id,unresolved_paths:[]})
 const dependencies:any={resolveContext:async()=>({organizationId:id(1),projectId:id(2),engagementId:id(3),user:{id:id(12)},membership:{member_kind:'team',status:'active',role:state.role,department_id:state.department},admin}),env:(name:string)=>name==='WEBSITE_STAGING_ALLOWED_ORIGINS'?JSON.stringify(state.disabledOrigin?[]:[origin]):'private-fixture-app-password',resolver:async()=>[state.privateDns?'127.0.0.1':'93.184.216.34'],fetcher:async(url:string,options:any)=>{
  state.requests.push({url,method:options.method,body:options.body})
  let value:any
  if(url.endsWith('/identity'))value=identity()
  else if(url.includes('/head?'))value={...identity(),head:state.head,page_id:id(4)}
  else if(url.endsWith('/deploy')){state.remote=true;state.head=state.run.request_id;if(state.lost)throw Error('Synthetic response lost');value=receipt()}
  else if(url.includes('/requests/'))value=receipt()
  else if(url.includes('anka_staging_preview='))return new Response('<meta name="anka-staging-request" content="'+state.run.request_id+'"><meta name="anka-staging-site" content="'+id(9)+'"><meta name="anka-package-sha256" content="'+(state.badPreview?'f'.repeat(64):checksum)+'">',{headers:{'Content-Type':'text/html','Cache-Control':'private, no-store'}})
  else throw Error('Unexpected receiver route')
  return new Response(JSON.stringify(value),{headers:{'Content-Type':'application/json'}})
 }}
 const call=async(action:string,fields:any={})=>{const r=await handler(new Request('https://edge.example.test',{method:'POST',body:JSON.stringify({action,...scope,...fields})}),dependencies);return {status:r.status,body:await r.json()}}
 const deploy=()=>call('deploy',{target_id:id(8),job_id:id(6),remote_head:null,review_sha256:'a'.repeat(64),previous_run_id:null,request_id:id(10)})
 return {state,call,deploy,checksum,dependencies}
}
Deno.test('inspection surfaces only the fixed receiver guard diagnostic without binding testing or staging',async()=>{
 const f=await fixture();f.state.role='operations_admin';let calls=0
 f.dependencies.fetcher=async()=>{calls++;return new Response(JSON.stringify({code:'anka_stage_runtime',message:'PRIVATE upstream text',data:{private:'PRIVATE'}}),{status:403,headers:{'Content-Type':'application/json'}})}
 const result=await f.call('inspect',{connection_id:id(7)})
 assert(result.status===400&&result.body.error.includes('(anka_stage_runtime)')&&!JSON.stringify(result.body).includes('PRIVATE'))
 assert(calls===1&&f.state.calls.every((name:string)=>name==='get_website_staging_dispatch')&&!f.state.run&&!f.state.result)
})
Deno.test('unsupported publication and arbitrary-target fields are rejected before authority or transport',async()=>{const f=await fixture();assert((await f.call('publish')).status===400);assert((await f.call('dry-run',{target_id:id(8),job_id:id(6),url:'https://client.example.test'})).status===400);assert(f.state.calls.length===0&&f.state.requests.length===0)})
Deno.test('dry run inspects exact remote staging identity and page without writes',async()=>{const f=await fixture(),r=await f.call('dry-run',{target_id:id(8),job_id:id(6)});assert(r.status===200&&r.body.data.published===false);assert(!f.state.calls.includes('start_website_staging_run'));assert(f.state.requests.every((x:any)=>x.method==='GET'))})
Deno.test('production environment cannot be used as a staging target',async()=>{const f=await fixture();f.state.badIdentity=true;assert((await f.deploy()).status===400);assert(!f.state.requests.some((x:any)=>x.method==='POST'));assert(!f.state.run)})
Deno.test('server origin allowlist and public DNS fail closed before credential transmission',async()=>{for(const key of ['disabledOrigin','privateDns']){const f=await fixture();f.state[key]=true;assert((await f.deploy()).status===400);assert(f.state.requests.length===0)}})
Deno.test('exact original private package stages once and verifies authenticated preview',async()=>{const f=await fixture(),r=await f.deploy();assert(r.status===200&&r.body.data.status==='staged');assert(f.state.requests.filter((x:any)=>x.method==='POST').length===1);assert(r.body.data.evidence.preview_verified===true&&r.body.data.published===false);assert(!JSON.stringify(r.body).includes('private-fixture-app-password'))})
Deno.test('lost remote response recovers original status and preview using GET only',async()=>{const f=await fixture();f.state.lost=true;const lost=await f.deploy();assert(lost.status===400&&lost.body.request_retained===true&&f.state.run);const writes=f.state.requests.filter((x:any)=>x.method==='POST').length;const recovered=await f.call('recover',{request_id:id(10)});assert(recovered.status===200&&recovered.body.data.status==='staged');assert(f.state.requests.filter((x:any)=>x.method==='POST').length===writes)})
Deno.test('same request replay returns original receipt after remote page head changes',async()=>{const f=await fixture();assert((await f.deploy()).body.data.status==='staged');const count=f.state.requests.length;const replay=await f.deploy();assert(replay.status===200&&replay.body.data.replayed===true&&replay.body.data.status==='staged');assert(f.state.requests.length===count)})
Deno.test('late authority revocation and corrupt original archive prevent external dispatch',async()=>{for(const key of ['revokeDispatch','corrupt']){const f=await fixture();f.state[key]=true;const r=await f.deploy();assert(key==='corrupt'?r.status===200&&r.body.data.status==='failed':r.status>=400&&r.body.request_retained===true);assert(!f.state.requests.some((x:any)=>x.method==='POST'))}})
Deno.test('unverified preview remains uncertain and cannot create success evidence',async()=>{const f=await fixture();f.state.badPreview=true;const r=await f.deploy();assert(r.status===400&&r.body.request_retained===true);assert(!f.state.result)})
Deno.test('only current owner or operations admin can inspect and bind a target',async()=>{const f=await fixture();assert((await f.call('inspect',{connection_id:id(7)})).status===403);f.state.role='operations_admin';const r=await f.call('inspect',{connection_id:id(7)});assert(r.status===200&&r.body.data.environment==='staging'&&!JSON.stringify(r.body).includes('secret_name'))})
Deno.test('missing remote request before dispatch expiry is not resubmitted or marked staged',async()=>{const f=await fixture();f.state.lost=true;await f.deploy();f.state.remote=false;const r=await f.call('recover',{request_id:id(10)});assert(r.status===400&&!f.state.result);assert(f.state.requests.filter((x:any)=>x.method==='POST').length===1)})
Deno.test('elapsed time alone never turns a missing remote receipt into a failed deployment',async()=>{const f=await fixture();f.state.lost=true;await f.deploy();f.state.remote=false;f.state.run.created_at=new Date(Date.now()-660000).toISOString();const r=await f.call('recover',{request_id:id(10)});assert(r.status===400&&!f.state.result);assert(f.state.requests.filter((x:any)=>x.method==='POST').length===1)})

Deno.test('public DNS checks deny private reserved documentation and IPv6 relay addresses',()=>{for(const ip of ['127.0.0.1','10.1.2.3','169.254.169.254','172.16.0.1','192.168.1.1','100.64.0.1','198.18.0.1','224.0.0.1','1..2.3','0177.0.0.1','::1','fc00::1','fe80::1','2001:db8::1','2001::1','2002:7f00:1::1','3fff::1'])assert(!publicAddress(ip),ip);for(const ip of ['93.184.216.34','2606:4700:4700::1111','2001:4860:4860::8888'])assert(publicAddress(ip),ip)})
