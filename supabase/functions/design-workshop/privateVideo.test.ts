import { assertEquals, assertRejects, assertThrows } from 'jsr:@std/assert@1.0.14'
import { designVideoStoragePath, getDesignVideoQuote, listDesignVideoJobs } from './index.ts'
const org='123e4567-e89b-42d3-a456-426614174000'
const actor='123e4567-e89b-42d3-a456-426614174001'
const conversation='123e4567-e89b-42d3-a456-426614174002'
const settings={duration_seconds:5,resolution:'720p',aspect_ratio:'16:9',output_format:'mp4',generate_audio:false}
Deno.test('private quote/history use exact owner conversation RPC, never a direction or chat history', async()=>{
 const calls: Array<[string,Record<string,unknown>]> = []
 const admin={organizationId:org,rpc:async(name:string,args:Record<string,unknown>)=>{
  calls.push([name,args]);return {data:name.includes('quote')?{quote:null,organization_cap_configured:false,spend_tracking_configured:false,spend_guard_mode:null}:[],error:null}
 }} as unknown as Parameters<typeof getDesignVideoQuote>[0]
 await getDesignVideoQuote(admin,{...settings,private_conversation_id:conversation,messages:['omit'],attachments:['omit']},actor)
 await listDesignVideoJobs(admin,{private_conversation_id:conversation},actor)
 assertEquals(calls.map(x=>x[0]),['get_private_design_video_quote','list_private_design_video_jobs'])
 for(const[,args]of calls){assertEquals(args.p_private_conversation_id,conversation);assertEquals(args.p_actor_id,actor);assertEquals(args.p_direction_version_id,undefined);assertEquals(args.messages,undefined);assertEquals(args.attachments,undefined)}
 await assertRejects(()=>getDesignVideoQuote(admin,{...settings,private_conversation_id:conversation,direction_version_id:conversation},actor))
 assertEquals(calls.length,2)
})
Deno.test('private video object path binds organization owner conversation and original job',()=>{
 const job={id:'123e4567-e89b-42d3-a456-426614174003',requested_by:actor,private_conversation_id:conversation,direction_version_id:null,output_format:'mp4'}
 assertEquals(designVideoStoragePath(job,org),`${org}/private/${actor}/${conversation}/${job.id}/output.mp4`)
 assertThrows(()=>designVideoStoragePath({...job,direction_version_id:conversation},org))
 assertThrows(()=>designVideoStoragePath({...job,private_conversation_id:null},org))
})