import { assertEquals } from 'jsr:@std/assert@1.0.14'
import { GoTrueClient } from 'npm:@supabase/auth-js@2.112.4'
import { handleRequest as chat } from './index.ts'
import { handleRequest as runner } from '../context-chat-runner/index.ts'

const id='ba000000-0000-4000-8000-000000000001'
const selection={version:1,organization_id:id,project_id:id,engagement_id:id,plan_id:id,group_id:id,phase:'website.content',partition:{kind:'website_page',id,architecture_version_id:id},context_sha256:'a'.repeat(64)}
const metadata={version:1,selection,output_version_ids:[],work:[],outputs:[],body_included:false,attachments_included:false}

Deno.test('actual Chat HTTP routes staged start and append through authenticated RPC; original metadata survives readback',async()=>{
 const calls:Array<{name:string,args:any}>=[]
 const conversation={id,organization_id:id,project_id:id,owner_id:id,context_kind:'project_team',state:'active',engagement_id:null,department_id:null}
 const message={id,organization_id:id,conversation_id:id,author_id:id,role:'user',body:'  Preserve text  ',status:'completed',client_request_id:id,sequence:1,project_stage_context:metadata}
 const rows:Record<string,any[]>={organizations:[{id,status:'active'}],organization_memberships:[{organization_id:id,user_id:id,status:'active',member_kind:'team',role:'system_owner'}],projects:[{id,organization_id:id}],department_chat_conversations:[conversation],department_chat_messages:[message]}
 const admin:any={rpc(){throw Error('Staged persistence must not use admin')},from(table:string){let selected=[...(rows[table]||[])];let fields='*';const q:any={select(s:string){fields=s;return q},eq(k:string,v:any){selected=selected.filter(x=>x[k]===v);return q},in(k:string,v:any[]){selected=selected.filter(x=>v.includes(x[k]));return q},is(){return q},order(){return q},limit(){return q},maybeSingle(){return Promise.resolve({data:selected[0]||null,error:null})},then(resolve:any){return Promise.resolve({data:selected.map(row=>fields==='*'?row:Object.fromEntries(fields.split(',').map(k=>k.trim()).map(k=>[k,row[k]]))),error:null}).then(resolve)}};return q}}
 let fail=false
 const userClient:any={auth:{getUser:()=>Promise.resolve({data:{user:{id}},error:null})},rpc(name:string,args:any){calls.push({name,args});return Promise.resolve(fail?{data:null,error:{code:'40001',message:'Stage changed'}}:{data:args.p_start?{conversation,message}:message,error:null})}}
 const invoke=(body:any)=>chat(new Request('https://example.test',{method:'POST',headers:{Authorization:'Bearer offline'},body:JSON.stringify({organization_id:id,...body})}),{clients:{admin,userClient}})
 const body={conversation_id:id,project_id:id,context_kind:'project_team',client_request_id:id,message:'  Preserve text  ',project_stage_context:{selection,output_version_ids:[]}}
 for(const action of ['start_context_conversation','append_context_human_message']){
  const response=await invoke({...body,action});assertEquals(response.status,200,await response.clone().text())
 }
 assertEquals(calls.map(x=>x.name),['send_project_stage_chat_message','send_project_stage_chat_message'])
 assertEquals(calls.map(x=>x.args.p_start),[true,false]);assertEquals(calls[0].args.p_body,body.message)
 assertEquals(Object.hasOwn(calls[0].args,'p_actor_id'),false)
 const recovered=await invoke({action:'get_context_conversation',conversation_id:id})
 const dto=(await recovered.json()).data
 assertEquals(dto.messages[0].conversation_id,id);assertEquals(dto.messages[0].project_stage_context,metadata)
 for(const bad of [{...body,project_document_ids:[]},{...body,project_stage_context:{selection,output_version_ids:[],approved:true}}]){
  const response=await invoke({...bad,action:'append_context_human_message'});assertEquals(response.status>=400,true)
 }
 assertEquals(calls.length,2)
 fail=true;assertEquals((await invoke({...body,action:'append_context_human_message'})).status>=400,true)
 assertEquals(calls.length,3)
})

for(const state of ['current','stale','malformed']) Deno.test('actual runner '+state+' stored stage context uses user auth before reservation and never retries dispatch',async()=>{
 const oldFetch=globalThis.fetch,oldGet=Deno.env.get,oldRefresh=GoTrueClient.prototype.startAutoRefresh
 GoTrueClient.prototype.startAutoRefresh=async()=>{}
 const calls:Array<{path:string,args:any,authorization:string|null}>=[];let providers=0
 const price={provider:'openai',model_id:'gpt-6.1-sol',verified_at:new Date().toISOString(),source_url:'https://developers.openai.com/api/docs/models/gpt-6.1-sol',input_usd_per_million:2,cached_input_usd_per_million:.1,cache_write_usd_per_million:2.5,output_usd_per_million:10}
 const config:Record<string,string>={SUPABASE_URL:'http://127.0.0.1:54321',SUPABASE_ANON_KEY:'offline-public',SUPABASE_SERVICE_ROLE_KEY:'offline-service',CONTEXT_CHAT_PAID_EXECUTION_ENABLED:'true',ANKA_OPENAI_OFFLINE_POLICY:'offline-only',N6_OPENAI_MODEL_PRICING_JSON:JSON.stringify([{...price,model_id:'gpt-4.1'}]),N6_OPENAI_APPROVED_MODELS_PRICING_JSON:JSON.stringify([price])}
 try{
  Deno.env.get=name=>config[name]
  globalThis.fetch=(input,init)=>{
   const url=new URL(input instanceof Request?input.url:String(input));if(url.origin!=='http://127.0.0.1:54321')throw Error('Remote forbidden')
   const path=url.pathname,args=init?.body?JSON.parse(String(init.body)):{};calls.push({path,args,authorization:new Headers(init?.headers).get('authorization')});let data:unknown
   if(path==='/auth/v1/user')data={id}
   else if(path.endsWith('/organization_memberships'))data={status:'active',member_kind:'team',role:'system_owner'}
   else if(path.endsWith('/department_chat_messages')){const row={id,conversation_id:id,organization_id:id,owner_id:id,author_id:id,role:'user',status:'completed',sequence:1,body:'help',client_request_id:id,project_stage_context:metadata};data=url.searchParams.has('id')?row:[row]}
   else if(path.endsWith('/department_chat_conversations'))data={id,organization_id:id,owner_id:id,context_kind:'project_team',project_id:id,state:'active'}
   else if(path.endsWith('/projects'))data={id,organization_id:id,archived_at:null}
   else if(path.endsWith('/context_chat_organization_models'))data={id,organization_id:id,connector_connection_id:id,model_id:'gpt-6.1-sol',revoked_at:null}
   else if(path.endsWith('/integration_connections'))data={id,organization_id:id,provider:'openai',status:'verified',archived_at:null,secret_name:'ANKA_OPENAI_OFFLINE_POLICY'}
   else if(path.endsWith('/project_document_message_sources'))data=[]
   else if(path.endsWith('/append_context_chat_audited_reply'))return Promise.resolve(new Response(JSON.stringify({message:'No audit'}),{status:400,headers:{'content-type':'application/json'}}))
   else if(path.endsWith('/recover_context_chat_completed_run'))data={status:'no_run'}
   else if(path.endsWith('/read_project_stage_chat_message_context')){
    if(state==='stale')return Promise.resolve(new Response(JSON.stringify({code:'40001',message:'Stage changed'}),{status:409,headers:{'content-type':'application/json'}}))
    data=state==='malformed'?{...metadata,body:'not allowed'}:metadata
   }
   else if(path.endsWith('/read_project_chat_spend_policy'))data={mode:'usage_only'}
   else if(path.endsWith('/reserve_context_chat_budget'))data={status:'reserved',reservation_id:id}
   else if(path.endsWith('/claim_context_chat_dispatch'))data={status:'already_claimed',must_not_submit:true,claim_id:id}
   else throw Error('Unexpected '+path)
   return Promise.resolve(new Response(JSON.stringify(data),{headers:{'content-type':'application/json'}}))
  }
  const response=await runner(new Request('https://example.test',{method:'POST',headers:{Authorization:'Bearer offline'},body:JSON.stringify({organization_id:id,message_id:id,model_configuration_id:id,dispatch_request_id:id})}),(()=>{providers++;throw Error('No provider')}) as typeof fetch,{get:name=>config[name]})
  const result=await response.json()
  const stage=calls.filter(x=>x.path.endsWith('/read_project_stage_chat_message_context'))
  assertEquals(stage.length,1,JSON.stringify({result,calls}));assertEquals(stage[0].authorization,'Bearer offline')
  const reserves=calls.filter(x=>x.path.endsWith('/reserve_context_chat_budget'))
  assertEquals(reserves.length,state==='current'?1:0)
  assertEquals(calls.filter(x=>x.path.endsWith('/claim_context_chat_dispatch')).length,state==='current'?1:0)
  if(state==='current'){assertEquals(response.status,409);assertEquals(result.must_not_submit,true);assertEquals(calls.indexOf(stage[0])<calls.indexOf(reserves[0]),true)}else assertEquals(response.status>=400,true)
  assertEquals(providers,0)
 }finally{await new Promise(r=>setTimeout(r,20));globalThis.fetch=oldFetch;Deno.env.get=oldGet;GoTrueClient.prototype.startAutoRefresh=oldRefresh}
})
