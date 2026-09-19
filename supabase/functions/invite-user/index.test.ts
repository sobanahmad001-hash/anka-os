import { createTeamHandler, ORGANIZATION_ID, type TeamContext } from './index.ts'
const actor='11111111-1111-4111-8111-111111111111'
const target='22222222-2222-4222-8222-222222222222'
const requestId='33333333-3333-4333-8333-333333333333'
const assert=(value:unknown)=>{if(!value)throw new Error('Assertion failed')}
const request=(body:Record<string,unknown>,method='POST')=>new Request('https://local.test',{method,body:JSON.stringify(body)})
const base=(overrides:Partial<TeamContext>={}):TeamContext=>({actorId:actor,isAdmin:async()=>true,invite:async()=>({userId:target,error:null}),rpc:async()=>({data:{},error:null}),...overrides})
Deno.test('N1-D legacy DELETE is scoped deactivation, never global deletion',async()=>{
 let seen:Record<string,unknown>={};let name='';let invites=0
 const handler=createTeamHandler(async()=>base({invite:async()=>{invites++;return{userId:target,error:null}},rpc:async(n,input)=>{name=n;seen=input;return{data:{status:'revoked'},error:null}}}))
 const response=await handler(request({user_id:target,request_id:requestId,actor_id:target},'DELETE'))
 assert(response.status===200 && name==='deactivate_organization_member' && seen.p_organization_id===ORGANIZATION_ID && seen.p_user_id===target && !('p_actor_id' in seen) && invites===0)
 assert((await response.json()).message.includes('Auth sessions are unchanged'))
})
Deno.test('N1-D wrong organization, self-removal and missing stable request are rejected before mutation',async()=>{
 let calls=0
 const handler=createTeamHandler(async()=>base({rpc:async()=>{calls++;return{data:{},error:null}}}))
 for(const body of [
  {action:'deactivate',user_id:target,request_id:requestId,organization_id:target},
  {action:'deactivate',user_id:actor,request_id:requestId},
  {action:'deactivate',user_id:target},
 ])assert((await handler(request(body))).status>=400)
 assert(calls===0)
})
Deno.test('N1-D unverified and revoked admin contexts cannot invoke mutations',async()=>{
 let calls=0
 const denied=createTeamHandler(async()=>base({isAdmin:async()=>false,rpc:async()=>{calls++;return{data:{},error:null}}}))
 assert((await denied(request({action:'deactivate',user_id:target,request_id:requestId}))).status===403 && calls===0)
 const unauthenticated=createTeamHandler(async()=>{throw new Error('secret')})
 assert((await unauthenticated(request({}))).status===401)
})
Deno.test('N1-D invitation succeeds through atomic authenticated completion without global profile updates',async()=>{
 let invites=0;let complete=0
 const handler=createTeamHandler(async()=>base({invite:async()=>{invites++;return{userId:target,error:null}},rpc:async(name,args)=>{
  assert(name==='complete_team_invitation' && args.p_user_id===target && args.p_role==='contributor');complete++;return{data:{},error:null}
 }}))
 const response=await handler(request({email:'New@example.invalid',department:'design',role:'contributor'}))
 assert(response.status===200 && invites===1 && complete===1)
})
Deno.test('N1-D failed app provisioning retains account and reports incomplete cleanup without retry or secrets',async()=>{
 let invites=0
 const handler=createTeamHandler(async()=>base({invite:async()=>{invites++;return{userId:target,error:null}},rpc:async()=>({data:null,error:{message:'private database secret'}})}))
 const response=await handler(request({email:'new@example.invalid',department:'design'}))
 const body=await response.json()
 assert(response.status===409 && body.cleanup_incomplete===true && body.recovery_required===true && body.user_id===target && invites===1)
 assert(!JSON.stringify(body).includes('private database secret') && body.error.includes('No account or history was deleted'))
})
Deno.test('N1-D uncertain completion and invite failures never claim successful cleanup or retry',async()=>{
 let invites=0
 const uncertain=createTeamHandler(async()=>base({invite:async()=>{invites++;return{userId:target,error:null}},rpc:async()=>{throw new Error('private network detail')}}))
 const response=await uncertain(request({email:'new@example.invalid',department:'design'}))
 assert(response.status===409 && (await response.json()).cleanup_incomplete===true && invites===1)
 let rpcCalls=0
 const failed=createTeamHandler(async()=>base({invite:async()=>({userId:null,error:{message:'private provider detail'}}),rpc:async()=>{rpcCalls++;return{data:null,error:null}}}))
 const rejected=await failed(request({email:'new@example.invalid',department:'design'}))
 assert(rejected.status===400 && rpcCalls===0 && !(await rejected.text()).includes('private provider detail'))
})
