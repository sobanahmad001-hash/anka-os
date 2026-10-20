import assert from 'node:assert/strict'
import test from 'node:test'
import {createDepartmentChatRepository} from './departmentChatTransport.js'
import {readDirectChatDraft, writeDirectChatDraft} from './directChatDraft.js'
const scope={organizationId:'org'}
test('project document signed-upload conflict recovers exact finalization without deleting original or changing identity',async()=>{
 const calls=[]
 const repo=createDepartmentChatRepository({functions:{invoke:async(_, {body})=>{
  calls.push(body);assert.equal(body.attachment_id,'same-private')
  return {data:{data:body.action==='project_document_attachment_reserve'?{upload:{bucket:'b',path:'p',token:'t'}}:{id:'same-private'}}}
 }},storage:{from:()=>({uploadToSignedUrl:async()=>({error:{message:'Already stored'}})})}})
 assert.equal((await repo.uploadProjectDocument({attachment_id:'same-private',file:new File(['reference'],'a.txt'),claimed_mime:'text/plain'},scope)).id,'same-private')
 assert.deepEqual(calls.map(c=>c.action),['project_document_attachment_reserve','project_document_attachment_finalize'])
})

test('project document IDs survive exact request recovery and invalid duplicate IDs are rejected',()=>{
 const id='a0000000-0000-4000-8000-000000000001', source='a0000000-0000-4000-8000-000000000002';
 const map=new Map(), storage={getItem:k=>map.get(k),setItem:(k,v)=>map.set(k,v),removeItem:k=>map.delete(k)};
 const value={text:'Reference this',new_conversation_id:id,conversation_id:id,attempt:{text:'Reference this',isNew:false,conversation_id:id,client_request_id:id,project_document_ids:[source]}};
 writeDirectChatDraft('project-exact',value,storage);assert.deepEqual(readDirectChatDraft('project-exact',storage).attempt.project_document_ids,[source]);
 assert.throws(()=>writeDirectChatDraft('project-exact',{...value,attempt:{...value.attempt,project_document_ids:[source,source]}},storage));
})
