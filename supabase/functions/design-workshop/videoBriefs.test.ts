import {designWorkshopScope,hasWorkshopAuthority} from './index.ts'
import {assertEquals,assertRejects,assertThrows} from 'jsr:@std/assert@1.0.14'
import {confirmVideoBrief,getVideoBrief,getVideoJobBrief,reserveConfirmedVideoJob,videoBriefContext} from './videoBriefs.ts'
import {emptyVideoBrief} from '../_shared/designVideoBrief.js'
const org='a0000000-0000-4000-8000-000000000001',actor='a0000000-0000-4000-8000-000000000002',conversation='a0000000-0000-4000-8000-000000000003',operation='a0000000-0000-4000-8000-000000000004'
const brief={...emptyVideoBrief(),purpose:'Explain launch',audience:'Clients',channel:'Organic social',assets:'None',script_storyboard:'Product then benefits',brand_constraints:'No unlicensed marks',required_text:'None'}
Deno.test('canonical brief actions send exact authenticated actor/scope; reads have no write/provider path',async()=>{
 const calls:any[]=[],admin={organizationId:org,rpc:async(name:string,args:any)=>{calls.push({name,args});return {data:{version:null},error:null}}}
 await getVideoBrief(admin,{private_conversation_id:conversation,operation_key:operation},actor)
 await confirmVideoBrief(admin,{private_conversation_id:conversation,creative_brief_id:null,expected_revision:0,operation_key:operation,video_brief:brief},actor)
 assertEquals(calls.map(call=>call.name),['get_design_video_brief','confirm_design_video_brief'])
 assertEquals(calls[1].args,{p_organization_id:org,p_actor_id:actor,p_private_conversation_id:conversation,p_direction_version_id:null,p_creative_brief_id:null,p_expected_revision:0,p_operation_key:operation,p_video_brief:brief})
})
Deno.test('brief action rejects spoofed actor/history/settings before RPC; original unknown outcome remains unknown',async()=>{
 let count=0;const admin={organizationId:org,rpc:async()=>{count++;return {data:null,error:{message:'network failed'}}}}
 const body={private_conversation_id:conversation,creative_brief_id:null,expected_revision:0,operation_key:operation,video_brief:brief}
 for(const patch of [{actor_id:actor},{messages:[]},{creative_brief_id:''},{expected_revision:'0'},{video_brief:{...brief,resolution:'1080p'}},{direction_version_id:conversation}]) await assertRejects(()=>confirmVideoBrief(admin,{...body,...patch},actor))
 assertEquals(count,0)
 try {await confirmVideoBrief(admin,body,actor)} catch(error){assertEquals((error as any).rollback_verified,false);assertEquals((error as any).status,503)}
 assertEquals(count,1)
 const stale={...admin,rpc:async()=>({data:null,error:{code:'40001',message:'Changed revision'}})}
 try {await confirmVideoBrief(stale,body,actor)} catch(error){assertEquals((error as any).rollback_verified,true);assertEquals((error as any).code,'40001');assertEquals((error as any).status,409)}
 assertThrows(()=>videoBriefContext({private_conversation_id:'bad'}))
})

Deno.test('canonical video actions preserve Design team gates and caller-readable official root',async()=>{
 for(const action of ['get_video_brief','confirm_video_brief']) {
  assertEquals(hasWorkshopAuthority({member_kind:'client',role:'client_admin',department_id:'design'},action),false)
  assertEquals(hasWorkshopAuthority({member_kind:'team',role:'contributor',department_id:'content'},action),false)
  assertEquals(hasWorkshopAuthority({member_kind:'team',role:'contributor',department_id:'design'},action),true)
  const denied={from:()=>{throw new Error('Private action must not read a project')}} as any
  assertEquals(await designWorkshopScope(denied,{action,organization_id:org,private_conversation_id:conversation}),{root:null,requestedOrganizationId:org})
  const rows:any={design_direction_versions:{id:conversation,organization_id:org,direction_id:'direction'},design_directions:{id:'direction',organization_id:org,session_id:'session'},design_workshop_sessions:{id:'session',organization_id:org,engagement_id:'engagement',brand_id:'brand'},engagements:{id:'engagement',organization_id:org,brand_id:'brand'}}
  const client={from:(table:string)=>{const query:any={select:()=>query,eq:()=>query,maybeSingle:async()=>({data:rows[table],error:null})};return query}} as any
  assertEquals(await designWorkshopScope(client,{action,organization_id:org,direction_version_id:conversation}),{root:{kind:'engagement',id:'engagement'},requestedOrganizationId:org})
  rows.design_directions.organization_id=actor;await assertRejects(()=>designWorkshopScope(client,{action,organization_id:org,direction_version_id:conversation}))
 }
})

Deno.test('Generate reservation pins an exact canonical version and forwards no client actor/history; job binding reads remain scoped',async()=>{
 const calls:any[]=[],version='a0000000-0000-4000-8000-000000000021',job='a0000000-0000-4000-8000-000000000022'
 const admin={organizationId:org,rpc:async(name:string,args:any)=>{calls.push({name,args});return {data:name==='create_confirmed_design_video_job' ? {job_id:job,request_checksum:'a'.repeat(64),creative_brief_version_id:version,brief_checksum:'b'.repeat(64)} : {creative_brief_version_id:version,brief_checksum:'b'.repeat(64)},error:null}}}
 const input={private_conversation_id:conversation,creative_brief_version_id:version,connector_connection_id:operation,quote_id:operation,operation_key:operation,prompt:'Exact full canonical prompt',mode:'explore',duration_seconds:5,resolution:'720p',aspect_ratio:'16:9',output_format:'mp4',generate_audio:false,actor_id:'spoof',history:['never forward'],attachments:['never forward']}
 await reserveConfirmedVideoJob(admin,input,actor);assertEquals(calls[0].name,'create_confirmed_design_video_job');assertEquals(calls[0].args.p_actor_id,actor);assertEquals(calls[0].args.p_organization_id,org);assertEquals(calls[0].args.p_creative_brief_version_id,version);assertEquals(calls[0].args.history,undefined);assertEquals(calls[0].args.attachments,undefined);assertEquals(calls[0].args.actor_id,undefined)
 await getVideoJobBrief(admin,{job_id:job},actor);assertEquals(calls[1],{name:'get_design_video_job_brief_binding',args:{p_organization_id:org,p_job_id:job,p_actor_id:actor}})
 await assertRejects(()=>reserveConfirmedVideoJob(admin,{...input,creative_brief_version_id:undefined},actor));assertEquals(calls.length,2)
 const wrong={...admin,rpc:async()=>({data:{job_id:job,request_checksum:'a'.repeat(64),creative_brief_version_id:operation,brief_checksum:'b'.repeat(64)},error:null})};await assertRejects(()=>reserveConfirmedVideoJob(wrong,input,actor))
})
