import {createManualDirection,hasWorkshopAuthority} from './index.ts'
const org='99999999-9999-4999-8999-999999999901',actor='99999999-9999-4999-8999-999999999902'
const id='99999999-9999-4999-8999-999999995501'
Deno.test('manual draft forwards server actor and organization, never browser authority or generated content',async()=>{
 let call:any
 const admin:any={organizationId:org,rpc:async(name:string,args:unknown)=>{call={name,args};return {data:{version:{id}},error:null}}}
 const result=await createManualDirection(admin,{organization_id:'foreign',actor_id:'other',creative_brief_id:id,creative_brief_version_id:id,engagement_id:id,engagement_service_id:id,operation_key:id,expected_revision:2,content:{invented:true}},actor)
 if(call.name!=='create_design_manual_direction'||call.args.p_actor_id!==actor||call.args.p_organization_id!==org||'content' in call.args||result.version.id!==id)throw Error('Incorrect exact contract')
})
Deno.test('manual draft requires an integer revision before RPC',async()=>{
 let calls=0;const admin:any={organizationId:org,rpc:async()=>{calls++;return {}}}
 for(const revision of [null,0,-1,1.5,'2',NaN]){let failed=false;try{await createManualDirection(admin,{expected_revision:revision},actor)}catch{failed=true}if(!failed)throw Error('Invalid revision accepted')}
 if(calls)throw Error('Invalid revision reached database')
})
Deno.test('manual draft preserves existing Design team authority',()=>{
 for(const membership of [{member_kind:'client',role:'operations_admin',department_id:'design'},{member_kind:'team',role:'member',department_id:'content'}])if(hasWorkshopAuthority(membership,'create_manual_direction'))throw Error('Authority widened')
 if(!hasWorkshopAuthority({member_kind:'team',role:'member',department_id:'design'},'create_manual_direction'))throw Error('Existing draft author blocked')
})
Deno.test('manual draft propagates failed transaction instead of returning success',async()=>{
 const admin:any={organizationId:org,rpc:async()=>({data:null,error:new Error('stale')})};let failed=false
 try{await createManualDirection(admin,{creative_brief_id:id,creative_brief_version_id:id,engagement_id:id,engagement_service_id:id,operation_key:id,expected_revision:2},actor)}catch{failed=true}
 if(!failed)throw Error('Failed transaction shown as saved')
})
