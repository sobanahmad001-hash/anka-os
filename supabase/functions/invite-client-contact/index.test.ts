import { createClientInvitationHandler } from './index.ts'
const assert = (value:unknown) => {if(!value)throw new Error('Assertion failed')}
const org='8a6d2c5e-2c99-4ec7-a92f-6d1bd877eb25'
const requestId='10000000-0000-4000-8000-000000000001'
function setup(options: {failure?:string,clientStatus?:string,projectStatus?:string,role?:string}={}) {
 const calls:string[]=[]; let redirect=''; let invited=0; let payload:Record<string,unknown>={}
 const client={auth:{getUser:async()=>({data:{user:{id:'admin'}}}),admin:{inviteUserByEmail:async(_email:string,config:{redirectTo:string})=>{invited++;redirect=config.redirectTo;return{data:{user:{id:'invitee'}}}},deleteUser:()=>{throw new Error('Forbidden deletion')}}},
 rpc:async(name:string,args:Record<string,unknown>)=>{calls.push(name);payload=args;return options.failure==='rpc'?{data:null,error:{message:'private backend detail'}}:{data:{user_id:options.failure==='identity'?'wrong':'invitee',request_id:args.p_request_id,contact_id:'contact',organization_id:options.failure==='organization'?'wrong':args.p_organization_id,client_id:options.failure==='client'?'wrong':args.p_client_id,project_ids:options.failure==='projects'?[]:args.p_project_ids}}},
 from(table:string){
  const query:Record<string,unknown>={}
  const result=()=>{
   calls.push(table+':read')
   if(table==='organization_memberships')return{data:{role:options.role??'operations_admin',status:'active',member_kind:'team'}}
   if(table==='clients')return{data:{id:'client',status:options.clientStatus??'active'}}
   if(table==='projects')return{data:[{id:'project',status:options.projectStatus??'active'}]}
   throw new Error('Unexpected table')
  }
  for(const name of ['select','eq','in','is'])query[name]=()=>query
  query.insert=()=>{throw new Error('Forbidden non-atomic write')};query.single=async()=>result();query.maybeSingle=async()=>result()
  query.then=(resolve:(result:unknown)=>unknown)=>Promise.resolve(result()).then(resolve)
  return query
 }}
 const handler=createClientInvitationHandler((()=>client) as never,key=>key==='SUPABASE_URL'?'https://production.supabase.co':key==='ANKA_APP_URL'?'https://anka-os.vercel.app':'synthetic')
 const request=(overrides:Record<string,unknown>={})=>new Request('https://service.test',{method:'POST',headers:{Authorization:'synthetic',Origin:'https://evil.test'},body:JSON.stringify({organizationId:org,clientId:'client',requestId,fullName:'Synthetic',email:'synthetic@example.invalid',projectIds:['project'],portalRole:'viewer',...overrides})})
 return{handler,request,calls,info:()=>({redirect,invited,payload})}
}
Deno.test('client invitation pins callback and completes exact selected access atomically',async()=>{
 const f=setup();const response=await f.handler(f.request());assert(response.status===200)
 assert(f.info().redirect==='https://anka-os.vercel.app/auth/callback' && f.info().invited===1)
 assert(f.calls.filter(x=>x==='complete_client_invitation').length===1)
 assert(f.info().payload.p_request_id===requestId && f.info().payload.p_organization_id===org)
 assert(JSON.stringify(f.info().payload.p_project_ids)==='["project"]')
})
Deno.test('failed or mismatched completion retains Auth identity without delete or automatic retry',async()=>{
 for(const failure of ['rpc','identity','organization','client','projects']){
  const f=setup({failure});const response=await f.handler(f.request());const body=await response.json()
  assert(response.status===409 && body.recovery_required && body.cleanup_incomplete && body.user_id==='invitee')
  assert(f.info().invited===1 && !JSON.stringify(body).includes('private backend detail'))
 }
})
Deno.test('inactive client and closed projects fail before invitation dispatch',async()=>{
 for(const options of [{clientStatus:'inactive'},...['completed','cancelled','archived'].map(projectStatus=>({projectStatus}))]) {
  const f=setup(options);const response=await f.handler(f.request());assert(response.status>=400)
  assert(f.info().invited===0 && !f.calls.includes('complete_client_invitation'))
 }
})
Deno.test('invalid request and bounded inputs fail before invitation dispatch',async()=>{
 for(const overrides of [{requestId:''},{fullName:'x'.repeat(161)},{projectIds:[]},{projectIds:['project',null]},{projectIds:Array.from({length:101},(_,i)=>String(i))},{organizationId:'other'}]) {
  const f=setup();const response=await f.handler(f.request(overrides));assert(response.status>=400)
  assert(f.info().invited===0 && !f.calls.includes('complete_client_invitation'))
 }
})
Deno.test('unprivileged membership cannot dispatch client invitations',async()=>{
 const f=setup({role:'contributor'});const response=await f.handler(f.request());assert(response.status===403 && f.info().invited===0)
})
