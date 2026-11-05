import test from 'node:test'
import assert from 'node:assert/strict'
import { readOnlyChatRequest } from './readOnlyChatRequest.js'
test('read-only wait rejects on deadline even if transport ignores abort; late success is ignored',async()=>{
 let resolve, transportSignal
 const late=new Promise(done=>{resolve=done})
 const result=readOnlyChatRequest(signal=>{transportSignal=signal;return late},{timeoutMs:5})
 await assert.rejects(result,{code:'CHAT_READ_TIMEOUT'})
 assert.equal(transportSignal.aborted,true)
 resolve({status:'completed'})
 await assert.rejects(result,{code:'CHAT_READ_TIMEOUT'})
})
test('scope abort ends read-only wait and ignores late error',async()=>{
 const controller=new AbortController()
 let reject
 const result=readOnlyChatRequest(()=>new Promise((_,fail)=>{reject=fail}),{signal:controller.signal})
 await Promise.resolve();controller.abort()
 await assert.rejects(result,{name:'AbortError'})
 reject(Error('late transport error'))
})
test('resolved and rejected reads preserve exact result and error',async()=>{
 const value={status:'unknown'},error=Error('network offline')
 assert.equal(await readOnlyChatRequest(()=>value),value)
 await assert.rejects(readOnlyChatRequest(()=>Promise.reject(error)),e=>e===error)
})
