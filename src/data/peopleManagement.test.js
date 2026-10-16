import test from 'node:test'
import assert from 'node:assert/strict'
import {createPeopleManagementRepository} from './peopleManagement.js'
const org='10000000-0000-4000-8000-000000000001', user='10000000-0000-4000-8000-000000000002', request='10000000-0000-4000-8000-000000000003'
const member={organization_id:org,user_id:user,updated_at:'2026-10-16T00:00:00Z'}
function fixture(transform=x=>x){const calls=[];return {calls,repo:createPeopleManagementRepository({rpc:async(name,args)=>{calls.push({name,args});return {data:transform({organization_id:org,user_id:user,request_id:request,global_profile_changed:false,role:'contributor',department_id:'design'})}}})}}
test('membership change pins expected revision and exact requested role/department',async()=>{
 const f=fixture();await f.repo.update(org,member,'contributor','design',request)
 assert.deepEqual(f.calls,[{name:'update_team_membership',args:{p_organization_id:org,p_user_id:user,p_expected_revision:member.updated_at,p_role:'contributor',p_department_id:'design',p_request_id:request}}])
})
test('unconfirmed scope, identity, role, department or global-write response never confirms success',async()=>{
 for(const patch of [{organization_id:user},{user_id:org},{request_id:user},{global_profile_changed:true},{role:'executive'},{department_id:'marketing'}]) {
  const f=fixture(value=>({...value,...patch}));await assert.rejects(f.repo.update(org,member,'contributor','design',request),/could not be confirmed/)
 }
})
test('cross-organization member and already aborted changes never dispatch',async()=>{
 const f=fixture();await assert.rejects(f.repo.update(user,member,'contributor','design',request));assert.equal(f.calls.length,0)
 const controller=new AbortController();controller.abort();await assert.rejects(f.repo.update(org,member,'contributor','design',request,{signal:controller.signal}));assert.equal(f.calls.length,0)
})
test('scope abort during response prevents stale success and no automatic retry occurs',async()=>{
 const controller=new AbortController(),f=fixture(value=>{controller.abort();return value})
 await assert.rejects(f.repo.update(org,member,'contributor','design',request,{signal:controller.signal}));assert.equal(f.calls.length,1)
})
