import assert from 'node:assert/strict'
import test from 'node:test'
import {canPublishWebsiteStarter,createWebsiteStarterRepository} from './websiteStarterRepository.js'
const org='8a6d2c5e-2c99-4ec7-a92f-6d1bd877eb25',requestId='31cb2407-5970-4071-a04c-a8c02c4a7d73'
test('only selected organization owner and operations membership hints permit Website publication',()=>{
  for(const role of ['system_owner','operations_admin'])assert.equal(canPublishWebsiteStarter({organizationId:org,role}),true)
  for(const role of ['department_manager','team_member','client'])assert.equal(canPublishWebsiteStarter({organizationId:org,role}),false)
  assert.equal(canPublishWebsiteStarter({role:'system_owner'}),false)
})
test('repository sends only explicit organization, exact review token, original request and reason',async()=>{
  const calls=[],repo=createWebsiteStarterRepository({rpc:(name,args)=>{calls.push({name,args});return Promise.resolve({data:{published:false}})}})
  await repo.review(org)
  await repo.publish(org,{requestId,hash:'a'.repeat(64),reason:' Reviewed plan '})
  assert.deepEqual(calls,[{name:'review_website_starter',args:{p_organization_id:org}},{name:'publish_website_starter',args:{p_organization_id:org,p_request_id:requestId,p_review_sha256:'a'.repeat(64),p_reason:'Reviewed plan'}}])
})
test('invalid review or aborted scope cannot dispatch; server conflicts retain their code',async()=>{
  let calls=0;const repo=createWebsiteStarterRepository({rpc:()=>{calls++;return Promise.resolve({error:{message:'Review changed',code:'40001'}})}})
  assert.throws(()=>repo.publish(org,{requestId,hash:'bad',reason:'x'}))
  await assert.rejects(repo.review(org,AbortSignal.abort()),/context changed/)
  assert.equal(calls,0)
  await assert.rejects(repo.review(org),e=>e.code==='40001')
})
