import { projectImportAction } from './projectSpreadsheetServer.ts'

// Capability injection is for isolated QA only. Production passes its closed
// module constant; request flags and bearer claims cannot change it.
const headers={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization,x-client-info,apikey,content-type','Content-Type':'application/json'}
export function createProjectImportHttpHandler({releaseReady=false,clients}: {releaseReady?:boolean,clients:()=>{auth:any,admin:any}}) {
return async function handleRequest(request:Request) {
  if(request.method==='OPTIONS')return new Response('ok',{headers})
  if(request.method!=='POST')return new Response(JSON.stringify({error:'POST required'}),{status:405,headers})
  if(!releaseReady)return new Response(JSON.stringify({available:false,error:'Spreadsheet upload and confirmation await acceptance gates'}),{status:503,headers})
  try {
    if(Number(request.headers.get('content-length')||0)>131072)throw Object.assign(Error('Bounded import request required'),{status:413})
    const reader=request.body?.getReader();const chunks:Uint8Array[]=[];let size=0
    if(!reader)throw Object.assign(Error('Import body required'),{status:400})
    try {
      for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length
        if(size>131072){await reader.cancel();throw Object.assign(Error('Bounded import request required'),{status:413})}chunks.push(value)}
    } finally {reader.releaseLock()}
    const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length}
    const raw=new TextDecoder('utf-8',{fatal:true}).decode(bytes)
    const body=JSON.parse(raw)
    const token=(request.headers.get('Authorization')||'').replace(/^Bearer\s+/i,'')
    if(!token)throw Object.assign(Error('Sign in required'),{status:401})
    const {auth,admin}=clients()
    const {data,error}=await auth.auth.getUser(token)
    if(error||!data.user)throw Object.assign(Error('Sign in required'),{status:401})
    const result=await projectImportAction(admin,{organizationId:body.organization_id,actorId:data.user.id},body,releaseReady)
    return new Response(JSON.stringify(result),{headers})
  } catch(error) {
    // Do not echo database/provider diagnostic content or cell values.
    const status=Number((error as any)?.status)||400
    return new Response(JSON.stringify({error:status===401?'Sign in required':'Import request could not be safely completed',code:(error as any)?.code||'import_rejected'}),{status,headers})
  }
}
}
