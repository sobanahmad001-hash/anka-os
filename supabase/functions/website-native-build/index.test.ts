import {handler} from './index.ts'
import {prepareWebsiteNativeManifest} from '../_shared/websiteNativeDraft.js'
import {createWebsiteDesignFixture} from '../../../tools/website-design-fixture.js'
import {unzipSync} from 'npm:fflate@0.8.3'
const id=(n:number)=>'a0000000-0000-4000-8000-'+String(n).padStart(12,'0')
const assert=(v:unknown,m='assertion failed')=>{if(!v)throw Error(m)}
async function fixture(){
 const organizationId=id(1),projectId=id(2),actor=id(3),native=createWebsiteDesignFixture({organizationId,projectId,actor})
 const example={title:'Anka QA',language:'en',description:'Synthetic site',palette:{background:'#ffffff',surface:'#eeeeee',ink:'#111111',accent:'#224466'},navigation:[{label:'Home',path:'#copy'}],footer:'QA source'}
 const site=await native.repository.saveSite({expected_version_id:null,identity_version_id:null,site:example,request_id:id(4)})
 const input={organizationId,projectId,engagementId:native.engagement.id,pageId:native.ids.pageId,architectureVersionId:native.ids.archVersionId,contentVersionId:native.ids.copyVersionId,briefVersionId:native.briefVersion.id,siteVersionId:site.id}
 const source=await native.repository.source(input),manifest=await prepareWebsiteNativeManifest(source,{template:'home',sections:[{source_key:'copy',component:'prose',motion:'none'}],cta_path:'#copy'})
 const review={organization_id:organizationId,project_id:projectId,engagement_id:native.engagement.id,design_id:id(5),page_id:native.ids.pageId,design_version:1,manifest,context:source,stale_sources:[],review_sha256:'b'.repeat(64)}
 const calls:any[]=[],objects=new Map<string,Blob>(),flags={resolve:false,foreign:false,stale:false,duplicate:false,transport:false,upload:false,corrupt:false,revokeDownload:false},job={id:id(6),organization_id:organizationId,website_page_design_id:id(5),provider_job_id:'anka-native-block-v1',status:'processing',requested_by:actor}
 let completed:any
 const ctx:any={organizationId,projectId,engagementId:native.engagement.id,user:{id:actor},membership:{member_kind:'team',status:'active',role:'contributor',department_id:'development'},
 userClient:{rpc:async(name:string,args:any)=>{calls.push({kind:'read',name,args});if(name==='get_website_block_review')return {data:{...review,...(flags.foreign?{project_id:id(999)}:{})}};if(name==='get_website_block_artifact'){if(flags.revokeDownload&&calls.filter(c=>c.name===name).length>1)return{error:{code:'42501',message:'Membership revoked'}};return{data:completed}};throw Error(name)}},
 admin:{rpc:async(name:string,args:any)=>{calls.push({kind:'rpc',name,args});if(name==='start_website_block_build'){if(flags.transport)return{error:{message:'Response lost'}};if(flags.stale)return{error:{code:'40001',message:'Sources changed'}};return{data:{created:!flags.duplicate,job,source:{...review,...(flags.foreign?{project_id:id(999)}:{})}}}}
 if(name==='finish_website_block_build'){completed={...job,status:'complete',project_id:projectId,engagement_id:native.engagement.id,request_id:id(7),page_id:review.page_id,storage_path:organizationId+'/'+job.website_page_design_id+'/'+job.id+'/native-block.zip',artifact_sha256:args.p_package_sha256,seo_verification:{source_path:organizationId+'/'+job.website_page_design_id+'/'+job.id+'/source.zip',source_sha256:args.p_source_sha256,package_bytes:args.p_package_bytes,source_bytes:args.p_source_bytes}};return{data:completed}}
 if(name==='fail_website_block_build')return{data:null};throw Error(name)},
 storage:{from:()=>({upload:async(path:string,blob:Blob)=>{calls.push({kind:'upload',path});if(flags.upload)return{error:Error('lost upload')};objects.set(path,blob);return{data:{path}}},
 download:async(path:string)=>({data:flags.corrupt?new Blob(['corrupt']):objects.get(path)}),
 createSignedUrl:async(path:string)=>{calls.push({kind:'sign',path});return{data:{signedUrl:'https://fhoxaogfjszftoqtnbav.supabase.co/storage/v1/object/sign/wordpress-theme-exports/'+path+'?token=synthetic'}}}})}}}
 const resolveContext=async()=>{if(flags.resolve)throw Object.assign(Error('Unauthenticated'),{status:401});return ctx}
 const body={action:'build',organization_id:organizationId,project_id:projectId,engagement_id:native.engagement.id,design_id:id(5),request_id:id(7),review_sha256:review.review_sha256}
 const send=(value:any=body)=>handler(new Request('https://fixture.test',{method:'POST',body:JSON.stringify(value)}),{resolveContext})
 return {flags,calls,objects,ctx,review,body,send,job}
}
Deno.test('native build resolves exact server sources, preserves canonical design and packages fixed source files',async()=>{
 const f=await fixture(),r=await f.send(),d=await r.json();assert(r.status===200);assert(d.data.status==='complete');assert(d.data.delivery_approved===false&&d.data.published===false)
 const upload=[...f.objects.entries()].find(([p])=>p.endsWith('native-block.zip'))!;const zip=unzipSync(new Uint8Array(await upload[1].arrayBuffer()));assert(Object.keys(zip).length===9)
 assert(Object.keys(zip).every(p=>/^anka-native-[a-f0-9]{16}\//.test(p)&&!p.includes('..')));assert(f.calls.find(c=>c.name==='start_website_block_build').args.p_actor_id===f.ctx.user.id)
 assert(!f.calls.some(c=>/approve|activate|publish|run|delete/.test(c.name||'')));assert(f.calls.filter(c=>c.kind==='upload').length===2)
})
Deno.test('native package and source downloads verify original MIME size and checksum before signing',async()=>{
 const f=await fixture();await f.send()
 for(const kind of ['package','source']){const r=await f.send({action:'download',organization_id:f.body.organization_id,project_id:f.body.project_id,engagement_id:f.body.engagement_id,job_id:f.job.id,kind}),d=await r.json();assert(r.status===200,JSON.stringify(d));assert(d.data.checksum_verified===true&&d.data.download_expires_in===300)}
 f.flags.corrupt=true;const r=await f.send({action:'download',organization_id:f.body.organization_id,project_id:f.body.project_id,engagement_id:f.body.engagement_id,job_id:f.job.id,kind:'package'});assert(r.status===409)
})
Deno.test('unknown code fields, oversized requests and foreign resolved scopes cannot reach a writer',async()=>{
 for(const change of [(b:any)=>({...b,files:{'functions.php':'evil'}}),(b:any)=>({...b,target:'https://client.test'}),(b:any)=>({...b,padding:'a'.repeat(4100)})]){const f=await fixture(),r=await f.send(change(f.body));assert(r.status>=400);assert(!f.calls.some(c=>c.kind==='rpc'))}
 const f=await fixture();f.flags.foreign=true;assert((await f.send()).status===403);assert(!f.objects.size)
})
Deno.test('authentication and current Development authority deny before privileged build access',async()=>{
 const f=await fixture();f.flags.resolve=true;assert((await f.send()).status===401);assert(!f.calls.length)
 const g=await fixture();g.ctx.membership.department_id='content';assert((await g.send()).status===403);assert(!g.calls.length)
})
Deno.test('stale source rollback and uncertain claim outcomes remain distinct',async()=>{
 const f=await fixture();f.flags.stale=true;let r=await f.send(),d=await r.json();assert(r.status===409&&d.rollback_verified===true);assert(!f.objects.size)
 const g=await fixture();g.flags.transport=true;r=await g.send();d=await r.json();assert(d.rollback_verified===false);assert(!g.objects.size)
})
Deno.test('duplicate original claim returns retained status without another upload or compiler dispatch',async()=>{
 const f=await fixture();f.flags.duplicate=true;const r=await f.send(),d=await r.json();assert(r.status===200&&d.data.replayed===true);assert(!f.objects.size);assert(!f.calls.some(c=>c.name==='finish_website_block_build'))
})
Deno.test('upload failure preserves original source request, records failure and never deletes objects',async()=>{
 const f=await fixture();f.flags.upload=true;const r=await f.send(),d=await r.json();assert(r.status===503&&d.request_retained===true);assert(f.calls.filter(c=>c.name==='fail_website_block_build').length===1);assert(!f.calls.some(c=>c.kind==='delete'))
})
Deno.test('download membership is rechecked after byte verification before any signed URL',async()=>{
 const f=await fixture();await f.send();f.flags.revokeDownload=true;const r=await f.send({action:'download',organization_id:f.body.organization_id,project_id:f.body.project_id,engagement_id:f.body.engagement_id,job_id:f.job.id,kind:'package'});assert(r.status===403);assert(!f.calls.some(c=>c.kind==='sign'))
})
