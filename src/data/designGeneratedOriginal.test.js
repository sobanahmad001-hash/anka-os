import test from 'node:test'
import assert from 'node:assert/strict'
import {validateGeneratedOriginal,createGeneratedOriginalAccess,freshGeneratedPreview} from './designGeneratedOriginal.js'
const id='a0000000-0000-4000-8000-000000000001',operation='a0000000-0000-4000-8000-000000000002',conversation='a0000000-0000-4000-8000-000000000003'
const fixture=()=>({id,operation_key:operation,conversation_id:conversation,status:'ready',request:{organization_id:'org',context:{kind:'private',id:conversation},creative_brief_version_id:'brief-v1',model_id:'fixture-image',output_count:2},outputs:['png','jpg'].map((extension,index)=>({id:id+':'+index,extension,mime_type:index?'image/jpeg':'image/png',filename:index+'.'+extension,checksum:'a'.repeat(64),byte_length:12+index,signed_url:'https://storage.test/'+index,download_url:'https://storage.test/download/'+index,expires_at:new Date(Date.now()+60000).toISOString()}))})
const scope={organizationId:'org',conversationId:conversation}
test('original access validates all output identities, byte/MIME/extension/filename and exact brief/chat binding',()=>{
 const job=fixture();assert.equal(validateGeneratedOriginal(job,structuredClone(job),scope).outputs.length,2)
 for(const alter of [j=>j.id=operation,j=>j.operation_key=id,j=>j.conversation_id=id,j=>j.request.creative_brief_version_id='v2',j=>j.outputs.pop(),j=>j.outputs[0].checksum='b'.repeat(64),j=>j.outputs[0].filename='other.png',j=>j.outputs[0].mime_type='image/svg+xml',j=>j.outputs[0].extension='mov',j=>j.outputs[0].signed_url='javascript:alert(1)',j=>j.outputs[0].byte_length++]){const changed=structuredClone(job);alter(changed);assert.throws(()=>validateGeneratedOriginal(job,changed,scope))}
})
test('fresh previews expire honestly; explicit reads/downloads always request fresh authorized signing',async()=>{
 const job=fixture(),calls=[];assert.ok(freshGeneratedPreview(job,scope));job.outputs.forEach(output=>output.expires_at=new Date(Date.now()-1000).toISOString());assert.equal(freshGeneratedPreview(job,scope),null)
 const access=createGeneratedOriginalAccess({organizationId:'org',userId:'actor',studio:{signMediaGeneration:async input=>{calls.push(input);return fixture()}}})
 await access.read(job,{conversationId:conversation});await access.read(job,{conversationId:conversation,download:true});assert.equal(calls.length,2);assert.equal(calls[1].download,true);assert.equal(calls[1].conversation_id,conversation)
})
test('concurrent views share only an in-flight read, never another account/chat or a later download',async()=>{
 let release,calls=0;const job=fixture(),gate=new Promise(resolve=>release=resolve),access=createGeneratedOriginalAccess({organizationId:'org',userId:'actor',studio:{signMediaGeneration:async()=>{calls++;await gate;return fixture()}}})
 const first=access.read(job,{conversationId:conversation}),second=access.read(job,{conversationId:conversation});assert.equal(first,second);release();await first;assert.equal(calls,1);await access.read(job,{conversationId:conversation});assert.equal(calls,2)
 await assert.rejects(access.read({...job,conversation_id:id},{conversationId:conversation}));assert.equal(calls,2)
})
test('aborted or mismatched organization state cannot return late original URLs or dispatch new reads',async()=>{
 let release,calls=0;const controller=new AbortController(),job=fixture(),gate=new Promise(resolve=>release=resolve),access=createGeneratedOriginalAccess({organizationId:'org',userId:'actor',signal:controller.signal,studio:{signMediaGeneration:async()=>{calls++;await gate;return fixture()}}})
 const pending=access.read(job,{conversationId:conversation});await new Promise(resolve=>setTimeout(resolve,0));controller.abort();release();await assert.rejects(pending,/access changed/);await assert.rejects(access.read(job,{conversationId:conversation}));assert.equal(calls,1)
})
