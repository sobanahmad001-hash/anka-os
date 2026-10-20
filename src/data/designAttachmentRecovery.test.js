import assert from 'node:assert/strict'
import test from 'node:test'
import {createDepartmentChatRepository} from './departmentChatTransport.js'
import {validateDepartmentChatAttachmentFile} from './departmentChatAttachmentSelection.js'

const scope={organizationId:'org'}
test('Design alone accepts PDF selection; empty and oversize PDFs remain blocked',()=>{
 const pdf=new File(['%PDF-1.7'],'source.pdf',{type:'application/pdf'})
 assert.throws(()=>validateDepartmentChatAttachmentFile(pdf),/unsupported/)
 assert.equal(validateDepartmentChatAttachmentFile(pdf,{allowDesignPdf:true}),'application/pdf')
 assert.throws(()=>validateDepartmentChatAttachmentFile(new File([],'empty.pdf',{type:'application/pdf'}),{allowDesignPdf:true}),/limit/)
})
test('Design project finalization response loss retries the same original without another upload or discard',async()=>{
 const calls=[];let uploads=0,finalizations=0
 const repo=createDepartmentChatRepository({functions:{invoke:async(_, {body})=>{
  calls.push(body)
  if(body.action==='reserve_attachment')return {data:{data:{attachment:{id:'same'},upload:{bucket:'b',path:'p',token:'t'}}}}
  assert.equal(body.action,'finalize_attachment');assert.equal(body.attachment_id,'same')
  if(++finalizations===1)return {error:{message:'Response lost'}}
  return {data:{data:{id:'same',status:'extracted'}}}
 }},storage:{from:()=>({uploadToSignedUrl:async()=>{uploads++;return {data:{}}}})}})
 const input={conversation_id:'c',project_id:'p',engagement_id:'e',file:new File(['reference'],'a.txt',{type:'text/plain'}),data_classification:'internal',ai_use_allowed:true}
 await assert.rejects(repo.uploadAttachment('design',input,scope),/Response lost/)
 assert.equal((await repo.uploadAttachment('design',input,scope)).id,'same')
 assert.equal(uploads,1);assert.equal(calls.filter(c=>c.action==='reserve_attachment').length,1);assert.equal(calls.some(c=>c.action==='discard_attachment'),false)
})
test('private signed-upload conflict recovers exact finalization without deleting original or changing identity',async()=>{
 const calls=[]
 const repo=createDepartmentChatRepository({functions:{invoke:async(_, {body})=>{
  calls.push(body);assert.equal(body.attachment_id,'same-private')
  return {data:{data:body.action==='design_private_attachment_reserve'?{upload:{bucket:'b',path:'p',token:'t'}}:{id:'same-private'}}}
 }},storage:{from:()=>({uploadToSignedUrl:async()=>({error:{message:'Already stored'}})})}})
 assert.equal((await repo.uploadDesignPrivateAttachment({attachment_id:'same-private',file:new File(['reference'],'a.txt'),claimed_mime:'text/plain'},scope)).id,'same-private')
 assert.deepEqual(calls.map(c=>c.action),['design_private_attachment_reserve','design_private_attachment_finalize'])
})
