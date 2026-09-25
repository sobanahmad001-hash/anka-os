import { assertEquals, assertRejects } from 'jsr:@std/assert@1.0.14'
import { previewVideoPromotion, promotePrivateVideo } from './videoPromotion.ts'
const ids = Array.from({length:8},(_,i)=>`11111111-1111-4111-8111-${String(i+1).padStart(12,'0')}`)
const [org,actor,jobId,direction,engagement,service,asset,version] = ids
const body = { job_id:jobId,target_engagement_id:engagement,target_service_id:service,operation_key:crypto.randomUUID(),expected_checksum:'b'.repeat(64) }
const bytes = new Uint8Array([0,0,0,12,102,116,121,112,105,115,111,109])
async function fixture() {
  const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(x=>x.toString(16).padStart(2,'0')).join('')
  const state = { revoked:false, uploadConflict:false, corrupt:false, failComplete:false, completed:false,
    calls:[] as string[], uploads:0, params:[] as unknown[], revokeAfterUpload:false, serviceActive:true, deactivateServiceAfterUpload:false }
  const prepared = {job_id:jobId,direction_version_id:direction,target_engagement_id:engagement,target_service_id:service,
    brand_id:'brand',name:'Exact video',rights_notes:'Recorded, not a license',checksum:body.expected_checksum,
    source_path:`${org}/${direction}/${jobId}/output.mp4`,sha256:hash,byte_length:12,mime_type:'video/mp4',format:'mp4',asset_id:asset,version_id:version}
  const admin = {organizationId:org,rpc:async(name:string,args:unknown)=>{
    state.calls.push(name)
    if(name==='get_design_video_job') return {data:state.revoked?null:{id:jobId,organization_id:org,requested_by:actor,status:'ready',direction_version_id:direction}}
    if(name==='prepare_design_video_promotion') {state.params.push(args);return {data:prepared}}
    if(state.failComplete) {state.failComplete=false;return {error:new Error('lost')}}
    const replay=state.completed;state.completed=true
    return {data:{asset_id:asset,version_id:version,status:'draft',idempotent_replay:replay}}
  },storage:{from:(bucket:string)=>{
    assertEquals(bucket,'design-generated-video')
    return {download:async(path:string)=>{
      state.calls.push('download')
      const output=new Uint8Array(bytes)
      if(state.corrupt&&path.includes('/assets/'))output[11]=0
      return {data:new Blob([output],{type:'video/mp4'})}
    },upload:async(path:string,_bytes:unknown,options:unknown)=>{
      assertEquals(path,`${org}/assets/${asset}/${version}/file.mp4`)
      assertEquals(options,{contentType:'video/mp4',upsert:false});state.uploads++
      if(state.revokeAfterUpload)state.revoked=true
      if(state.deactivateServiceAfterUpload)state.serviceActive=false
      return {error:state.uploadConflict?new Error('exists'):null}
    }}
  }}}
  const caller={from:(table:string)=>{
    const data = table==='design_direction_versions'?{id:direction,creative_brief_version_id:'brief'}:
      table==='engagements'?{id:engagement,brand_id:'brand'}:
      table==='engagement_services'?(state.serviceActive?{id:service,service_catalog:{department_id:'design',is_active:true}}:null):
      table==='design_creative_brief_versions'?{id:'brief'}:[]
    const query:any={select:()=>query,eq:()=>query,in:()=>query,maybeSingle:async()=>({data:state.revoked?null:data}),
      then:(resolve:any)=>resolve({data:state.revoked?null:data})};return query
  }}
  return {state,admin,caller,prepared}
}
Deno.test('promotion preview excludes private paths/provider URLs and makes no storage write',async()=>{
  const f=await fixture();const result=await previewVideoPromotion(f.admin,f.caller,body,actor)
  assertEquals(result.status,'draft');assertEquals('source_path' in result,false);assertEquals('sha256' in result,false)
  assertEquals(f.state.uploads,0)
})
Deno.test('promotion copies exact bytes without provider call; retry rechecks access and reuses IDs',async()=>{
  const f=await fixture();f.state.failComplete=true
  await assertRejects(()=>promotePrivateVideo(f.admin,f.caller,body,actor))
  f.state.uploadConflict=true
  const result=await promotePrivateVideo(f.admin,f.caller,body,actor)
  assertEquals(result.version_id,version);assertEquals(result.status,'draft')
  assertEquals(f.state.params[0],f.state.params[1])
  assertEquals((await promotePrivateVideo(f.admin,f.caller,body,actor)).idempotent_replay,true)
  f.state.revoked=true;const count=f.state.uploads
  await assertRejects(()=>promotePrivateVideo(f.admin,f.caller,body,actor));assertEquals(f.state.uploads,count)
})
Deno.test('copy conflict never overwrites or registers mismatched bytes',async()=>{
  const f=await fixture();f.state.uploadConflict=true;f.state.corrupt=true
  await assertRejects(()=>promotePrivateVideo(f.admin,f.caller,body,actor))
  assertEquals(f.state.calls.includes('complete_design_video_promotion'),false)
})
Deno.test('revocation during transfer prevents canonical registration',async()=>{
  const f=await fixture();f.state.revokeAfterUpload=true
  await assertRejects(()=>promotePrivateVideo(f.admin,f.caller,body,actor))
  assertEquals(f.state.calls.includes('complete_design_video_promotion'),false)
})
Deno.test('target service suspension during copy blocks registration and retry without deleting receipt',async()=>{
  const f=await fixture();f.state.deactivateServiceAfterUpload=true
  await assertRejects(()=>promotePrivateVideo(f.admin,f.caller,body,actor))
  assertEquals(f.state.calls.includes('complete_design_video_promotion'),false)
  const count=f.state.uploads
  await assertRejects(()=>promotePrivateVideo(f.admin,f.caller,body,actor));assertEquals(f.state.uploads,count)
  f.state.serviceActive=true;f.state.deactivateServiceAfterUpload=false;f.state.uploadConflict=true
  assertEquals((await promotePrivateVideo(f.admin,f.caller,body,actor)).version_id,version)
  assertEquals(f.state.params[0],f.state.params[1])
})
