import test from 'node:test'
import assert from 'node:assert/strict'
import {createProjectGetContextAdapter} from './projectGetContext.js'
const uid = n => `00000000-0000-4000-8000-${String(n).padStart(12,'0')}`
const org=uid(1), project=uid(2), other=uid(3), actor=uid(4), engagement=uid(5), artifact=uid(6), version=uid(7), approval=uid(8), binding=uid(9)
const stamp='2026-11-26T16:00:00Z', hash='a'.repeat(64)
function fixture() {
  const tables={projects:[{id:project,organization_id:org,name:'Sphere',description:'Recorded brief',scope_statement:'Internal landing page',status:'active',archived_at:null},{id:other,organization_id:org,name:'Other project',description:'SECRET OTHER PROJECT',scope_statement:'secret',status:'active',archived_at:null}],engagements:[{id:engagement,organization_id:org,project_id:project,status:'active'}],artifacts:[{id:artifact,organization_id:org,project_id:project,engagement_id:engagement,artifact_type:'positioning',title:'Approved'}],artifact_approvals:[{id:approval,organization_id:org,engagement_id:engagement,artifact_id:artifact,artifact_version_id:version,decision:'approved',approved_at:stamp}],artifact_versions:[{id:version,organization_id:org,artifact_id:artifact,version_number:2,content_checksum:hash,ai_use_allowed:true,data_classification:'internal',created_at:stamp,content:{secret:'BODY NEVER SELECTED'}}]}
  const calls=[], state={authError:false,readError:null,rpcError:null,leak:null,output:{organization_id:org,project_id:project,engagement_id:engagement,actor_id:actor,binding_id:binding,current:{version_id:uid(10),version_number:1,binding_id:binding,wording_sha256:hash,conversation_id:uid(999)},selected:null}}
  function query(name, value) {
    const c={name,filters:[],fields:null};calls.push(c)
    const q={select(fields){c.fields=fields;return q},eq(k,v){c.filters.push([k,v]);return q},is(k,v){return q.eq(k,v)},in(k,values){c.filters.push([k,values]);return q},order(){return q},limit(n){c.limit=n;return q},maybeSingle(){c.single=true;return q},abortSignal(){return q},then(resolve,reject){let rows=structuredClone(value??tables[name]);if(Array.isArray(rows)){rows=rows.filter(r=>c.filters.every(([k,v])=>Array.isArray(v)?v.includes(r[k]):r[k]===v)).slice(0,c.limit);if(c.fields)rows=rows.map(r=>Object.fromEntries(c.fields.split(',').map(k=>[k,r[k]])));if(c.single)rows=rows[0]??null}if(state.leak?.table===name)rows=state.leak.data;return Promise.resolve({data:rows,error:state.readError}).then(resolve,reject)}}
    return q
  }
  const client={auth:{getUser:async()=>({data:{user:state.authError?null:{id:actor}},error:null})},from:name=>{assert.ok(Object.hasOwn(tables,name),'No private chat or other table read');return query(name)},rpc:(name,args)=>{assert.equal(name,'read_project_positioning_output');assert.equal(args.p_conversation_id,null);assert.equal(args.p_version_id,null);assert.equal(args.p_project_id,project);if(state.rpcError)return Promise.resolve({data:null,error:state.rpcError});return query(name,state.output)}}
  return {tables,calls,state,read:createProjectGetContextAdapter(client,{now:()=>stamp})}
}
const input={organization_id:org,project_id:project}
test('exact approved refs and real evidence dates; recorded scope is distinct from approval',async()=>{
 const f=fixture(),r=await f.read(input)
 assert.equal(r.operation,'project.get_context');assert.equal(r.project.input_state,'recorded_not_approval');assert.equal(r.project.evidence_date,null)
 assert.deepEqual(r.approved_versions,[{artifact_id:artifact,artifact_type:'positioning',artifact_version_id:version,version_number:2,content_checksum:hash,approval_id:approval,approved_at:stamp,evidence_created_at:stamp,body_included:false}])
 assert.equal(r.positioning.current_binding_matches,true);assert.ok(Object.isFrozen(r.approved_versions[0]));assert.equal(r.external_write_authorized,false)
 assert.equal(JSON.stringify(r).includes('SECRET'),false);assert.equal(JSON.stringify(r).includes(uid(999)),false);assert.equal(JSON.stringify(r).includes('BODY NEVER'),false)
 assert.equal(f.calls.find(c=>c.name==='artifact_versions').fields.includes('content,'),false)
})
test('two-project isolation applies organization, project and engagement filters before source reads',async()=>{
 const f=fixture();f.tables.artifacts.push({...f.tables.artifacts[0],id:uid(20),project_id:other});const r=await f.read(input)
 assert.equal(r.approved_versions.length,1)
 for(const name of ['projects','engagements','artifacts'])assert.ok(f.calls.find(c=>c.name===name).filters.some(([k,v])=>k===(name==='projects'?'id':'project_id')&&v===project))
 const p2=await f.read({...input,project_id:other});assert.equal(p2.project.name,'Other project');assert.equal(p2.engagement,null);assert.equal(p2.approved_versions.length,0)
})
test('foreign returned project, engagement, artifact, approval and version fail closed',async()=>{
 for(const table of ['projects','engagements','artifacts','artifact_approvals','artifact_versions']) {
  const f=fixture(),row={...f.tables[table][0],organization_id:uid(777)};f.state.leak={table,data:table==='projects'?row:[row]}
  await assert.rejects(f.read(input),/context_scope_mismatch/)
 }
})
test('missing description, scope, engagement and approvals are explicit gaps without defaults',async()=>{
 const f=fixture();f.tables.projects[0].description=' ';f.tables.projects[0].scope_statement=null;f.tables.engagements=[]
 const r=await f.read(input);assert.equal(r.project.business_description,null);assert.equal(r.project.scope_statement,null)
 assert.deepEqual(r.gaps.map(g=>g.code),['business_description_missing','scope_missing','engagement_missing','approved_shared_sources_missing'])
 assert.deepEqual(f.calls.map(c=>c.name),['projects','engagements'])
})
test('ambiguous or inactive engagement never falls back to active/latest sources',async()=>{
 for(const ambiguous of [true,false]){const f=fixture();if(ambiguous)f.tables.engagements.push({...f.tables.engagements[0],id:uid(22)});else f.tables.engagements[0].status='completed';const r=await f.read(input);assert.equal(r.engagement,null);assert.equal(f.calls.length,2);assert.ok(r.gaps.some(g=>g.code===(ambiguous?'engagement_ambiguous':'engagement_inactive')))}
})
test('private chat exclusion holds even for original owner; no selected wording or conversation identity returned',async()=>{
 const f=fixture(),r=await f.read(input);assert.equal(r.private_chat_included,false);assert.ok(r.gaps.some(g=>g.code==='positioning_shared_wording_unavailable'))
 f.state.output.selected={wording:'PRIVATE'};await assert.rejects(f.read(input),/context_scope_mismatch/)
})
test('unapproved, inaccessible and AI-disallowed versions cannot become approved context',async()=>{
 for(const mode of ['unapproved','missing','restricted','ai_off']){const f=fixture();if(mode==='unapproved')f.tables.artifact_approvals[0].decision='rejected';if(mode==='missing')f.tables.artifact_versions=[];if(mode==='restricted')f.tables.artifact_versions[0].data_classification='restricted';if(mode==='ai_off')f.tables.artifact_versions[0].ai_use_allowed=false;const r=await f.read(input);assert.equal(r.approved_versions.length,0);assert.ok(r.gaps.some(g=>g.code==='approved_shared_sources_missing'))}
})
test('wrong artifact/version join is not accepted and stale positioning is disclosed',async()=>{
 const f=fixture();f.tables.artifact_versions[0].artifact_id=uid(99);f.state.output.binding_id=uid(33);const r=await f.read(input);assert.equal(r.approved_versions.length,0);assert.equal(r.positioning.current_binding_matches,false);assert.ok(r.gaps.some(g=>g.code==='positioning_binding_stale'))
})
test('signed out, revoked project, RPC denial and cancellation stop without fallback',async()=>{
 const f=fixture();f.state.authError=true;await assert.rejects(f.read(input),/authentication_required/);assert.equal(f.calls.length,0)
 const revoked=fixture();revoked.tables.projects=[];await assert.rejects(revoked.read(input),/project_unavailable/);assert.equal(revoked.calls.length,1)
 const denied=fixture();denied.state.readError={code:'42501',message:'PRIVATE SERVER DETAIL'};await assert.rejects(denied.read(input),e=>e.status===403&&!e.message.includes('PRIVATE'))
 const cancel=fixture();await assert.rejects(cancel.read(input,{signal:AbortSignal.abort()}),e=>e.name==='AbortError');assert.equal(cancel.calls.length,0)
})
test('closed request schema rejects chat IDs, authority, unknown keys and oversized source sets',async()=>{
 for(const bad of [{...input,conversation_id:uid(99)},{...input,approved:true},{...input,project_id:'bad'}])await assert.rejects(fixture().read(bad),/invalid_context_request/)
 const f=fixture();f.tables.artifacts=Array.from({length:101},(_,n)=>({...f.tables.artifacts[0],id:uid(100+n)}));await assert.rejects(f.read(input),/context_limit_exceeded/)
})
test('RPC authorization denial is not downgraded to missing positioning or retried',async()=>{
 const f=fixture();f.state.rpcError={code:'42501',message:'private database detail'}
 await assert.rejects(f.read(input),e=>e.status===403&&e.code==='context_read_unavailable');assert.deepEqual(f.calls.map(c=>c.name),['projects','engagements'])
})
test('missing positioning has its own gap; malformed evidence dates fail rather than invent dates',async()=>{
 const f=fixture();f.state.output.current=null;const r=await f.read(input);assert.equal(r.positioning,null);assert.ok(r.gaps.some(g=>g.code==='positioning_missing'))
 f.tables.artifact_approvals[0].approved_at=null;await assert.rejects(f.read(input),/context_scope_mismatch/)
})
