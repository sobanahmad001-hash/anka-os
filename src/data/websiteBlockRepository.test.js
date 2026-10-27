import test from 'node:test'
import assert from 'node:assert/strict'
import {createWebsiteBlockRepository} from './websiteBlockRepository.js'
const id=n=>'b0000000-0000-4000-8000-'+String(n).padStart(12,'0'),scope={organizationId:id(1),projectId:id(2),engagementId:id(3)},row={organization_id:id(1),project_id:id(2),engagement_id:id(3)}
test('native build repository rejects foreign source/history and aborts',async()=>{
 const calls=[],client={rpc:async(name,args)=>{calls.push({name,args});return{data:{...row,project_id:id(9),designs:[],jobs:[]}}}},repo=createWebsiteBlockRepository(client)
 await assert.rejects(repo.workspace(scope),/another context/);const a=new AbortController();a.abort();await assert.rejects(repo.workspace(scope,{signal:a.signal}),/context changed/);assert.equal(calls.length,1)
})
test('manual native build dispatch carries only exact reviewed identity and request',async()=>{
 let body;const invoke=async(_name,input)=>{body=input.body;return {data:{data:{...row,website_page_design_id:id(4),request_id:id(5),status:'complete'}}}}
 const repo=createWebsiteBlockRepository({functions:{invoke}})
 await repo.build(scope,{designId:id(4),requestId:id(5),reviewSha256:'a'.repeat(64)})
 assert.deepEqual(Object.keys(body).sort(),['action','organization_id','project_id','engagement_id','design_id','request_id','review_sha256'].sort());assert.equal('manifest' in body,false)
})
test('native uncertain responses cannot clear original request unless server confirms rollback',async()=>{
 for(const known of [false,true]){const repo=createWebsiteBlockRepository({functions:{invoke:async()=>({data:{error:'Conflict',rollback_verified:known}})}});await assert.rejects(repo.build(scope,{designId:id(4),requestId:id(5),reviewSha256:'a'.repeat(64)}),e=>e.knownRollback===known)}
 const repo=createWebsiteBlockRepository({functions:{invoke:async()=>({data:{data:{...row,website_page_design_id:id(9),request_id:id(5)}}})}});await assert.rejects(repo.build(scope,{designId:id(4),requestId:id(5),reviewSha256:'a'.repeat(64)}),/recover/)
})
test('native artifact download permits only original verified private object on the configured origin',async()=>{
 const job={id:id(5),website_page_design_id:id(4)},base='https://example.supabase.co/storage/v1/object/sign/wordpress-theme-exports/'+id(1)+'/'+id(4)+'/'+id(5)+'/native-block.zip?token=synthetic'
 let result={...row,id:id(5),checksum_verified:true,download_expires_in:300,download_url:base}
 const repo=createWebsiteBlockRepository({supabaseUrl:'https://example.supabase.co',functions:{invoke:async()=>({data:{data:result}})}})
 assert.equal((await repo.download(scope,job,'package')).download_url,base)
 for(const url of [base.replace('example.supabase.co','evil.test'),base.replace('native-block.zip','other.zip'),base.replace('https:','http:')]){result={...result,download_url:url};await assert.rejects(repo.download(scope,job,'package'),/destination differs/)}
})
