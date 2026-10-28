import { assertEquals } from 'jsr:@std/assert@1.0.14'
import { testConnection } from './index.ts'
const connection={provider:'wordpress',base_url:'https://staging.example.test',public_config:{username:'synthetic-agent'}}
for(const code of ['rest_not_logged_in','invalid_username','invalid_email','incorrect_password','application_passwords_disabled','application_passwords_disabled_for_user']) Deno.test(`known WordPress code only: ${code}`,async()=>{
 let calls=0;let error
 try{await testConnection(connection,'synthetic-only',async()=>{calls++;return Response.json({code,message:'synthetic-private-value',data:{credential:'synthetic-private-value'}},{status:401})})}catch(e){error=e}
 assertEquals(error?.code,'HTTP_401');assertEquals(error?.wordpressCode,code);assertEquals(error?.message.includes('synthetic-private-value'),false);assertEquals(calls,1)
})
for(const [name,response] of [
 ['unknown code',()=>Response.json({code:'synthetic-private-value'},{status:401})],
 ['oversize',()=>Response.json({code:'incorrect_password',message:'x'.repeat(5000)},{status:401})],
 ['invalid JSON',()=>new Response('{not json',{status:401,headers:{'content-type':'application/json'}})],
 ['HTML',()=>new Response('synthetic-private-value',{status:401,headers:{'content-type':'text/html'}})],
 ['unrelated status',()=>Response.json({code:'incorrect_password'},{status:500})],
 ] as const) Deno.test(`WordPress failure safe fallback: ${name}`,async()=>{
 let error;try{await testConnection(connection,'synthetic-only',async()=>response())}catch(e){error=e}
 assertEquals(error?.wordpressCode,null);assertEquals(error?.message.includes('synthetic-private-value'),false)
})
Deno.test('oversized streamed WordPress error is cancelled without reading remainder',async()=>{
 let cancelled=false;let reads=0
 const body=new ReadableStream({pull(c){reads++;c.enqueue(new Uint8Array(4097))},cancel(){cancelled=true}})
 try{await testConnection(connection,'synthetic-only',async()=>new Response(body,{status:401,headers:{'content-type':'application/json'}}))}catch{/* expected */}
 assertEquals(cancelled,true);assertEquals(reads<=2,true)
})
