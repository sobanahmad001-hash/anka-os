import assert from 'node:assert/strict'
import test from 'node:test'
import { testConnectionMetadata } from './integrationConnectionTest.js'
const body={action:'test',organization_id:'synthetic-org',connection_id:'synthetic-connection'}
for(const [label,status,payload,expected] of [
 ['gateway session',401,{code:'HTTP_401'},'authentication_required'],
 ['gateway permission',403,{code:'HTTP_403'},'access_denied'],
 ['missing secret',409,{error:'The named Edge Function secret is not configured'},'secret_missing'],
 ['WordPress authentication',502,{code:'HTTP_401',error:'Authorization: synthetic-private-value'},'upstream_authentication'],
 ['upstream permission',502,{code:'HTTP_403'},'upstream_permission'],
 ['unknown response',502,{code:'synthetic-private-value',error:'synthetic-private-value'},'test_unconfirmed'],
 ['unrelated conflict',409,{error:'synthetic-private-value'},'test_unconfirmed'],
]) test(`connection test safely distinguishes ${label}`,async()=>{
 let calls=0
 await assert.rejects(testConnectionMetadata(async input=>{assert.deepEqual(input,body);calls++;return {error:{message:'synthetic-private-value',context:new Response(JSON.stringify(payload),{status})}}},body),error=>{assert.equal(error.code,expected);assert.doesNotMatch(error.message,/synthetic-private-value|Authorization:/);return true})
 assert.equal(calls,1)
})
test('connection test success preserves actual result without another dispatch',async()=>{
 const result={success:true,latency_ms:23,summary:{site:'staging.example.test'}};let calls=0
 assert.equal(await testConnectionMetadata(async()=>{calls++;return {data:result}},body),result);assert.equal(calls,1)
})
for(const reply of [()=>{throw Error('synthetic-private-value')},()=>({error:{context:new Response('not-json',{status:502})}}),()=>({data:{success:false}})])test('uncertain connection test hides raw errors and never retries',async()=>{
 let calls=0;await assert.rejects(testConnectionMetadata(async()=>{calls++;return reply()},body),error=>{assert.equal(error.code,'test_unconfirmed');assert.doesNotMatch(error.message,/synthetic-private-value|not-json/);return true});assert.equal(calls,1)
})

for(const [code,expected] of Object.entries({application_passwords_disabled:'wordpress_disabled',application_passwords_disabled_for_user:'wordpress_user_disabled',rest_not_logged_in:'wordpress_not_authenticated',invalid_username:'wordpress_account_unknown',invalid_email:'wordpress_account_unknown',incorrect_password:'wordpress_credential_rejected'}))test(`safe WordPress gateway detail: ${code}`,async()=>{
 await assert.rejects(testConnectionMetadata(async()=>({error:{context:new Response(JSON.stringify({code:'HTTP_401',wordpress_code:code,message:'synthetic-private-value'}),{status:502})}}),body),e=>{assert.equal(e.code,expected);assert.doesNotMatch(e.message,/synthetic-private-value/);return true})
})
test('unknown WordPress detail is never rendered',async()=>{
 await assert.rejects(testConnectionMetadata(async()=>({error:{context:new Response(JSON.stringify({code:'HTTP_401',wordpress_code:'synthetic-private-value'}),{status:502})}}),body),e=>{assert.equal(e.code,'upstream_authentication');assert.doesNotMatch(e.message,/synthetic-private-value/);return true})
})
