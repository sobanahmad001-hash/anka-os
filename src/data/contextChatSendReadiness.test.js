import test from 'node:test'
import assert from 'node:assert/strict'
import {contextChatSendBlocker,readContextChatSendReadiness} from './contextChatSendReadiness.js'
const ready={paid_execution_enabled:true,spend_tracking_configured:true,model_status:'configured'}
test('every unavailable readiness has a specific non-dispatch action without exposing raw status values',()=>{
 assert.equal(contextChatSendBlocker(ready),'')
 for(const [value,pattern]of [[{...ready,paid_execution_enabled:false},/disabled/],[{...ready,spend_tracking_configured:false},/spending controls/],[{...ready,model_status:'model_not_selected'},/Choose an approved/],[{...ready,model_status:'model_unavailable'},/model is unavailable/],[{...ready,model_status:'connection_unavailable'},/connection is unavailable/],[{...ready,model_status:'credential_unavailable'},/credentials are unavailable/],[{...ready,model_status:'price_unavailable'},/pricing/],[null,/could not be verified/],[{...ready,model_status:'<secret-raw-server-status>'},/not ready/]]){
  const message=contextChatSendBlocker(value);assert.match(message,pattern);assert.match(message,/No message or AI request was sent/);assert.doesNotMatch(message,/<secret/)
 }
})
test('fresh readiness checks only the selected model and propagates caller cancellation',async()=>{
 const controller=new AbortController();let seen
 const result=await readContextChatSendReadiness(async(input,scope)=>{seen={input,signal:scope.signal};return ready},'model-A',{signal:controller.signal})
 assert.deepEqual(result,ready);assert.deepEqual(seen.input,{model_configuration_id:'model-A'});assert.notEqual(seen.signal,controller.signal)
 let requestSignal;const pending=readContextChatSendReadiness((_input,scope)=>{requestSignal=scope.signal;return new Promise(()=>{})},'model-A',{signal:controller.signal})
 await Promise.resolve();controller.abort();await assert.rejects(pending,/interrupted/);assert.equal(requestSignal.aborted,true)
})
test('a stalled fresh check times out and aborts without authorizing late success',async()=>{
 let finish,requestSignal
 const pending=readContextChatSendReadiness((_input,scope)=>{requestSignal=scope.signal;return new Promise(resolve=>{finish=resolve})},'model-A',{timeoutMs:5})
 await assert.rejects(pending,/timed out/);assert.equal(requestSignal.aborted,true);finish(ready)
})
test('no model or already aborted scope never starts even a readiness request',async()=>{
 let reads=0;const read=async()=>{reads++;return ready},controller=new AbortController();controller.abort()
 await assert.rejects(readContextChatSendReadiness(read,''),/Choose an approved/)
 await assert.rejects(readContextChatSendReadiness(read,'model-A',{signal:controller.signal}),/abort/i)
 assert.equal(reads,0)
})
