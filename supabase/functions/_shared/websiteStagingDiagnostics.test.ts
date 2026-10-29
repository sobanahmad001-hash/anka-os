import {createStagingTransport} from './websiteStaging.js'
import {assertEquals,assertRejects} from 'jsr:@std/assert@1.0.14'

const origin='https://stage.example.test'
function transport(response:Response){
 let calls=0
 const t=createStagingTransport({base_url:origin,username:'synthetic-agent',secret_name:'ANKA_WORDPRESS_FIXTURE'},{env:name=>name==='WEBSITE_STAGING_ALLOWED_ORIGINS'?JSON.stringify([origin]):'synthetic-private-value',resolver:async()=>['93.184.216.34'],fetcher:async()=>{calls++;return response}})
 return {t,count:()=>calls}
}
Deno.test('receiver guard diagnostics distinguish environment runtime capability and origin without upstream text',async()=>{
 for(const code of ['anka_stage_environment','anka_stage_runtime','anka_stage_capability','anka_stage_origin','rest_not_logged_in','rest_forbidden']){
  const f=transport(new Response(JSON.stringify({code,message:'PRIVATE upstream value',data:{private:'PRIVATE'}}),{status:403,headers:{'Content-Type':'application/json; charset=UTF-8'}}))
  const error=await assertRejects(()=>f.t.identity(),Error,'('+code+')')
  assertEquals(error.message.includes('PRIVATE'),false);assertEquals(f.count(),1)
 }
})
Deno.test('unknown malformed hosting and unrelated-status responses disclose only safe HTTP status',async()=>{
 for(const [body,type,status] of [
  [JSON.stringify({code:'PRIVATE unknown',message:'PRIVATE'}),'application/json',403],
  ['{"code":','application/json',403],
  ['<html>PRIVATE hosting block</html>','text/html',403],
  [JSON.stringify({code:'anka_stage_runtime',message:'PRIVATE'}),'application/json',500],
  [JSON.stringify([{code:'anka_stage_runtime'}]),'application/json',401],
 ] as const){
  const f=transport(new Response(body,{status,headers:{'Content-Type':type}}))
  const error=await assertRejects(()=>f.t.identity(),Error,'HTTP '+status)
  assertEquals(error.message.includes('PRIVATE'),false);assertEquals(f.count(),1)
 }
})
Deno.test('oversized receiver diagnostics are cancelled at four KiB and never retried',async()=>{
 let cancelled=false
 const stream=new ReadableStream<Uint8Array>({pull(c){c.enqueue(new TextEncoder().encode('x'.repeat(4097)))},cancel(){cancelled=true}})
 const f=transport(new Response(stream,{status:403,headers:{'Content-Type':'application/json'}}))
 await assertRejects(()=>f.t.identity(),Error,'HTTP 403')
 assertEquals(cancelled,true);assertEquals(f.count(),1)
})
