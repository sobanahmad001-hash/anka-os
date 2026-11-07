import {deepStrictEqual as assertEquals,strictEqual,ok} from 'node:assert'
import {contentStudioScope,handleRequest} from './index.ts'
const id=(n:number)=>'a0000000-0000-4000-8000-'+String(n).padStart(12,'0')
Deno.test('page keyword editor save and recovery actions reach the exact engagement scope',()=>{
 for(const action of ['save_page_keyword_strategy','recover_page_keyword_strategy']){
  const result=contentStudioScope({action,organization_id:id(1),project_id:id(2),engagement_id:id(3),page_id:id(4),page_key:'home',architecture_version_id:id(5),request_id:id(6)})
  assertEquals(result,{root:{kind:'engagement',id:id(3)},requestedOrganizationId:id(1)})
 }
})
function fixture(){
 const body:any={action:'save_page_keyword_strategy',organization_id:id(1),project_id:id(2),engagement_id:id(3),page_id:id(4),page_key:'home',architecture_version_id:id(5),request_id:id(6),artifact_type:'keyword_strategy',artifact_id:null,engagement_stage_instance_id:null,title:'Home strategy',change_summary:'Reviewed',ai_use_allowed:false,data_classification:'internal',content:{schema_version:2,source_architecture_version_id:id(5),keywords:[{term:'Example',locale:'en',target_kind:'page',target_page_key:'home'}]}}
 const state:any={calls:[],pointer:null,version:null,sqlError:null,lose:false,readError:false}
 const context:any={organizationId:id(1),projectId:id(2),engagementId:id(3),user:{id:id(7)},membership:{role:'contributor',department_id:'content',member_kind:'team',status:'active'},
  admin:{async rpc(name:string,args:any){state.calls.push({name,args});if(state.sqlError)return {error:state.sqlError};state.pointer={...Object.fromEntries(['project_id','engagement_id','page_id','page_key','architecture_version_id','request_id'].map(k=>[k,body[k]])),artifact_id:id(8),version_id:id(9),warnings:[]};state.version={id:id(9),artifact_id:id(8),organization_id:id(1),created_by:id(7),version_number:1,parent_version_id:null,content:args.p_input.content};if(state.lose)throw Error('Response lost after commit');return {data:state.pointer}}},
  userClient:{async rpc(name:string,args:any){state.calls.push({name,args});return {data:state.pointer}},from(name:string){state.calls.push({name});const chain:any={select(){return chain},eq(){return chain},async maybeSingle(){return state.readError?{error:Error('RLS access unavailable')}:{data:state.version}}};return chain}}}
 const send=async(value:any=body)=>{const response=await handleRequest(new Request('http://127.0.0.1/content-studio',{method:'POST',body:JSON.stringify(value)}),{resolveContext:async()=>context});return {status:response.status,body:await response.json()}}
 const recovery=()=>send(Object.fromEntries(['action','organization_id','project_id','engagement_id','page_id','page_key','architecture_version_id','request_id'].map(k=>[k,k==='action'?'recover_page_keyword_strategy':body[k]])))
 return {body,state,context,send,recovery}
}
Deno.test('real handler routes page save to one atomic RPC and reads only exact authenticated version',async()=>{
 const f=fixture(),r=await f.send();strictEqual(r.status,200);strictEqual(r.body.data.request_id,id(6));strictEqual(r.body.data.version.id,id(9))
 assertEquals(f.state.calls.map((c:any)=>c.name),['save_page_keyword_strategy_atomic','artifact_versions']);strictEqual(f.state.calls[0].args.p_actor_id,id(7));strictEqual(f.state.calls[0].args.p_input.content.keywords[0].search_volume,null)
})
Deno.test('lost commit response is retained; exact recovery uses original pointer and RLS version with no write',async()=>{
 const f=fixture();f.state.lose=true;const lost=await f.send();strictEqual(lost.body.rollback_verified,false);strictEqual(lost.body.request_retained,true)
 const r=await f.recovery();strictEqual(r.status,200);strictEqual(r.body.data.version.id,id(9));strictEqual(f.state.calls.filter((c:any)=>c.name==='save_page_keyword_strategy_atomic').length,1)
})
Deno.test('postcommit hydration denial stays unknown rather than a verified rollback',async()=>{
 const f=fixture();f.state.readError=true;const r=await f.send();strictEqual(r.body.rollback_verified,false);strictEqual(r.body.request_retained,true);strictEqual(f.state.pointer.version_id,id(9))
})
Deno.test('only explicit safe SQL rollback evidence unlocks retry; busy and conflict retain original',async()=>{
 for(const code of ['22023','42501','40001','23505']){const f=fixture();f.state.sqlError={code,message:'Database rejected'};const r=await f.send();strictEqual(r.body.rollback_verified,['22023','42501'].includes(code));strictEqual(r.body.request_retained,!['22023','42501'].includes(code))}
})
Deno.test('missing, foreign and stale receipt identities cannot become a success',async()=>{
 const f=fixture();strictEqual((await f.recovery()).body.data,null);await f.send();f.state.pointer={...f.state.pointer,page_id:id(99)};ok((await f.recovery()).body.error)
 f.state.pointer={...f.state.pointer,page_id:id(4)};f.state.version.created_by=id(99);ok((await f.recovery()).body.error)
})
Deno.test('cross-scope, non-Content actor, forged actor and missing page keyword target do not dispatch SQL',async()=>{
 for(const mode of ['scope','role','actor','target']){const f=fixture();if(mode==='scope')f.context.projectId=id(99);if(mode==='role')f.context.membership.department_id='design';if(mode==='actor')f.body.actor_id=id(99);if(mode==='target')f.body.content.keywords[0].target_page_key='elsewhere';const r=await f.send();ok(r.status>=400);strictEqual(f.state.calls.length,0)}
})
