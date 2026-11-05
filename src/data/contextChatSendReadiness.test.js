import test from 'node:test'
import assert from 'node:assert/strict'
import {contextChatSendBlocker,readContextChatSendReadiness} from './contextChatSendReadiness.js'
const ready={paid_execution_enabled:true,spend_tracking_configured:true,model_status:'configured'}

test('new-project readiness carries exact project without a conversation; saved conversation takes precedence',async()=>{
 const seen=[];
 await readContextChatSendReadiness(async value=>{seen.push(value);return ready},'model-A',{projectId:'project-A'});
 await readContextChatSendReadiness(async value=>{seen.push(value);return ready},'model-A',{projectId:'project-B',conversationId:'conversation-A'});
 assert.deepEqual(seen,[{model_configuration_id:'model-A',project_id:'project-A'},{model_configuration_id:'model-A',conversation_id:'conversation-A'}]);
});

test('project readiness carries only the selected conversation scope and never an allowance activation',async()=>{
 let input
 await readContextChatSendReadiness(async value=>{input=value;return ready},'model-A',{conversationId:'conversation-A'})
 assert.deepEqual(input,{model_configuration_id:'model-A',conversation_id:'conversation-A'})
})
test('separate prospective allowance blockers preserve drafts without repeating historical billing requests',()=>{
 for(const status of['inactive','exhausted','source_changed']){
  const message=contextChatSendBlocker({...ready,spend_readiness_status:'prior_cycle_reconciliation_required',prospective_allowance_status:status})
  assert.match(message,/Project Chat/);assert.match(message,/No message or AI request was sent/);assert.doesNotMatch(message,/verify the original provider charges/)
 }
 assert.match(contextChatSendBlocker({...ready,spend_readiness_status:'ready',paid_execution_enabled:false,prospective_allowance_status:'available'}),/disabled/)
 assert.match(contextChatSendBlocker({...ready,spend_readiness_status:'prior_cycle_reconciliation_required',prospective_allowance_status:'not_required'}),/Retry AI availability/)
})
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

test('prior-cycle and unmeasured blockers preserve drafts and disclose no private billing metadata',()=>{
 for(const status of ['prior_cycle_reconciliation_required','unmeasured_cost_reconciliation_required']){
  const message=contextChatSendBlocker({...ready,spend_readiness_status:status,reconciliation_sources:['design_media'],reservation_id:'hidden',actual_cost_microusd:123})
  assert.match(message,/reconcil/);assert.match(message,/administrator/);assert.match(message,/Your draft is kept/);assert.match(message,/No message or AI request was sent/);assert.doesNotMatch(message,/hidden|123|design_media/)
 }
 assert.equal(contextChatSendBlocker({...ready,spend_readiness_status:'ready'}),'')
})
test('a fresh readiness read recognizes an unresolved rollover despite cached ready state',async()=>{
 let reads=0
 const value=await readContextChatSendReadiness(async()=>{reads++;return {...ready,spend_readiness_status:'prior_cycle_reconciliation_required'}},'exact-model')
 assert.equal(reads,1);assert.match(contextChatSendBlocker(value),/earlier billing month/)
})
