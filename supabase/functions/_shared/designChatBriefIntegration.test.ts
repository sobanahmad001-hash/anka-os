import {assertEquals} from 'jsr:@std/assert@1.0.14'
import {designBriefAudit,recoverAuditedDesignBrief} from './designChatBriefIntegration.ts'
Deno.test('Invalid structured reply stays human-readable and retains raw audit without applying fields',()=>{
 const result=designBriefAudit({identity:{request_id:'r'},binding:{content:{}}},'{"freeze":true}')
 assertEquals(result.text.includes('could not be validated'),true)
 assertEquals(result.manifest.design_brief_reply,'{"freeze":true}')
})
Deno.test('Recovery refuses foreign actor, conversation and message before any persistence call',async()=>{
 let calls=0;const admin={rpc(){calls++;throw Error('must not call')}}
 const identity={organization_id:'o',actor_id:'a',conversation_id:'c',message_id:'m',request_id:'r'}
 for(const changed of [{actor_id:'other'},{conversation_id:'other'},{message_id:'other'}]){
  assertEquals(await recoverAuditedDesignBrief(admin,{}, {design_brief_turn:identity,design_brief_reply:'{}'},{...identity,...changed}),null)
 }
 assertEquals(calls,0)
})
Deno.test('Ordinary chat audit remains unchanged',()=>assertEquals(designBriefAudit(undefined,'Hello'),{text:'Hello',manifest:{}}))
