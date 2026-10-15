import test from 'node:test'
import assert from 'node:assert/strict'
import { buildPeopleAccessReadModel, createPeopleAccessReadRepository } from './peopleAccessReadModel.js'
const id = n => `a0000000-0000-4000-8000-${String(n).padStart(12,'0')}`
const org=id(1), user=id(2)
const fixture = (o=org,u=user) => ({schema_version:1, compatibility_only:true, organization_id:o,actor_id:id(3),token:u?'private-token':null,
  members:[{user_id:u||user,name:'Synthetic person',role:'contributor',status:'active',organization_id:o}],departments:[],projects:[],
  snapshot:u?{user_id:u,organization_id:o,legacy_role:'contributor',legacy_department_id:'content',status:'active',
    department_memberships:[{id:id(4),organization_id:o,user_id:u,department_id:'design',status:'revoked',source:'synthetic',revoked_at:'2026-10-15'}],
    contributor_designations:[{id:id(5),organization_id:o,user_id:u,designation:'executive',status:'active',source:'synthetic'}],project_manager_bindings:[]}:null})
function clientFor({profile={id:user,full_name:'Synthetic person',role:'admin',department:'design'},error=null,alter=x=>x}={}) {
  const calls=[]
  const client={rpc(name,args){assert(['get_authority_administration','get_organization_deactivation_history'].includes(name),'No mutation or caller capability RPC');calls.push({name,args});
    const value=name==='get_authority_administration'?alter(fixture(args.p_organization_id,args.p_user_id)): {organization_id:org,user_id:user,history:[{id:id(8),organization_id:org,user_id:user,created_at:'2026-10-15',reassignment_records:[{title:'Do not expose'}],secret:'not propagated'}]}
    let signal;return {abortSignal(s){signal=s;return this},then(resolve,reject){signal?.throwIfAborted();return Promise.resolve({data:value,error:null}).then(resolve,reject)}}},
    from(table){assert.equal(table,'profiles');calls.push({table});let signal;const q={select(fields){assert.equal(fields,'id, full_name, role, department');return q},eq(key,value){assert.equal(key,'id');assert.equal(value,user);return q},abortSignal(s){signal=s;return q},async maybeSingle(){signal?.throwIfAborted();return {data:profile,error}}};return q}}
  return {client,calls}
}
test('read allowlist never invokes mutations, Auth, functions or target capability APIs; strips receipts and unrelated fields',async t=>{
  const previousFetch=globalThis.fetch;globalThis.fetch=()=>{throw Error('No direct network dispatch permitted')};t.after(()=>{globalThis.fetch=previousFetch})
  const {client,calls}=clientFor(),repo=createPeopleAccessReadRepository(client)
  await repo.list(org);const data=await repo.read(org,user);const history=await repo.history(org,user)
  assert.equal(data.discrepancies.length,2);assert.equal(data.designations[0].label,'executive');assert(data.effective.every(row=>row.state==='Not evaluated'&&!Object.hasOwn(row,'allowed')))
  assert.equal(data.departments[0].status,'revoked');assert.match(data.relationships.clientGrants,/not evaluated/i)
  assert(!JSON.stringify({data,history}).includes('private-token'));assert(!JSON.stringify(history).includes('Do not expose'));assert(!JSON.stringify(history).includes('secret'))
  assert.deepEqual(calls.map(x=>x.name||x.table),['get_authority_administration','get_authority_administration','profiles','get_organization_deactivation_history'])
})
test('unknown profile, denied profile, revoked membership and empty relationships never imply authority',async()=>{
  for(const options of [{profile:null},{error:Error('Profile read denied')}]){
    const {client}=clientFor(options);const data=await createPeopleAccessReadRepository(client).read(org,user)
    assert(['missing','unavailable'].includes(data.profile.state));assert.equal(data.discrepancies.length,0);assert(data.effective.every(x=>x.state==='Not evaluated'))
  }
  const f=fixture();f.snapshot.status='revoked';const data=buildPeopleAccessReadModel(f,{state:'missing'},'now')
  assert.match(data.relationships.teamVisibility,/not active/);assert.deepEqual(data.managerBindings,[])
})
test('foreign envelope/profile/history and aborted scope fail closed; no fallback lookup',async()=>{
  const {client}=clientFor({alter:d=>({...d,organization_id:id(99)})});await assert.rejects(createPeopleAccessReadRepository(client).read(org,user),/mismatched/)
  const controller=new AbortController();controller.abort();const f=clientFor();await assert.rejects(createPeopleAccessReadRepository(f.client).read(org,user,{signal:controller.signal}));assert.equal(f.calls.length,0)
  await assert.rejects(createPeopleAccessReadRepository(f.client).read('bad',user),/identity/)
  const other={rpc(){return Promise.resolve({data:{organization_id:org,user_id:id(99),history:[]}})}}
  await assert.rejects(createPeopleAccessReadRepository(other).history(org,user),/Mismatched retained history/)
})
