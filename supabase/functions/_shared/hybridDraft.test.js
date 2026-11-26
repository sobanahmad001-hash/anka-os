import test from 'node:test'
import assert from 'node:assert/strict'
import {createSuppliedDraft,draftArgs} from './hybridDraft.js'
import {executeHybridCapability,hybridCapabilities} from './hybridRegistry.js'
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`
const input={schema_version:1,organization_id:id(1),project_id:id(2),card_kind:'engagement_work_item',card_id:id(3),request_id:id(4),previous_version_id:null,title:'Landing page brief',body:'Supplied internal draft'}
const receipt={...input,asset_kind:'content',document_id:id(4),version_id:id(4),version_number:1,state:'draft'}
test('exact schema rejects extra authority, blank text, invalid scope and oversized body',()=>{
 for(const change of [{actor_id:id(8)},{body:' '},{project_id:id(2)+'x'},{body:'x'.repeat(100001)},{previous_version_id:''},{card_kind:'page'}]) assert.throws(()=>draftArgs({...input,...change}))
})
test('same request survives response loss; adapter never allocates a replacement ID',async()=>{
 const calls=[];let lost=true
 const client={rpc:async(name,args)=>{calls.push({name,args});if(lost){lost=false;throw Error('response lost after save')}return {data:receipt}}}
 await assert.rejects(createSuppliedDraft(client,input),/response lost/)
 assert.equal((await createSuppliedDraft(client,input)).version_id,id(4))
 assert.deepEqual(calls[0],calls[1])
})
test('stale input fails without retrying or overwriting',async()=>{
 let count=0;const error={code:'40001',message:'Reopen latest'}
 await assert.rejects(createSuppliedDraft({rpc:async()=>{count++;return {error}}},input),e=>e===error)
 assert.equal(count,1)
})
test('foreign-project receipt is rejected',async()=>{
 await assert.rejects(createSuppliedDraft({rpc:async()=>({data:{...receipt,project_id:id(7)}})},input),/scope mismatch/)
})
test('registry fails closed for unintegrated adapters without calling a provider',async()=>{
 assert.equal(hybridCapabilities.length,5)
 for(const c of hybridCapabilities.filter(c=>c.availability==='descriptor_only')) await assert.rejects(executeHybridCapability({client:{rpc:()=>{throw Error('must not run')}},name:c.name,input}),/unavailable/)
})
test('registered context adapter retains authentication gate',async()=>{
 await assert.rejects(executeHybridCapability({client:{auth:{getUser:async()=>({error:Error('revoked')})}},name:'project.get_context',input:{organization_id:id(1),project_id:id(2)}}),/authentication_required/)
})
