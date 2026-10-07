import { mappingPrompt } from './projectSpreadsheetMappingAssist.js'
// Reuse approved Project Chat execution; never select/configure a model here.
// Only original IDs enter recovery persistence; no headers/samples/prompt bodies.
export function createSpreadsheetMappingTransport({chat,runner,scope,storage,checkCurrent,consent}) {
 const key=`anka:import-mapping:${scope.organizationId}:${scope.projectId}:${scope.conversationId}:${scope.actorId}`
 let flight=null
 const read=()=>{const raw=storage.getItem(key);if(!raw)return null;const r=JSON.parse(raw);if(Object.keys(r).some(k=>!['client_request_id','dispatch_request_id','message_id'].includes(k))||Object.values(r).some(v=>typeof v!=='string'||!/^[0-9a-f-]{36}$/.test(v)))throw Error('Invalid original mapping recovery');return r}
 const single=run=>{if(flight)return flight;flight=Promise.resolve().then(run).finally(()=>{flight=null});return flight}
 async function result(record){
  const latest=await chat.getContextConversation({conversation_id:scope.conversationId},{organizationId:scope.organizationId})
  const reply=latest.messages?.find(m=>m.role==='assistant'&&m.in_reply_to_message_id===record.message_id&&m.status==='completed')
  if(!reply)throw Error('Original mapping reply remains unsettled; recover without a new provider call')
  storage.removeItem(key);return reply.body
 }
 return Object.freeze({
  request(disclosure){return single(async()=>{
   if(read())throw Error('Recover the original mapping request before another provider call')
   const modelId=await checkCurrent()
   if(!await consent())throw Error('Mapping consent cancelled')
   if(await checkCurrent()!==modelId)throw Error('Approved model or scope changed')
   const record={client_request_id:crypto.randomUUID(),dispatch_request_id:crypto.randomUUID()}
   storage.setItem(key,JSON.stringify(record))
   const message=await chat.appendContextHumanMessage({conversation_id:scope.conversationId,client_request_id:record.client_request_id,message:mappingPrompt(disclosure)},{organizationId:scope.organizationId})
   record.message_id=message.id;storage.setItem(key,JSON.stringify(record))
   if(await checkCurrent()!==modelId)throw Error('Model or scope changed before dispatch; recover original message')
   const response=await runner.run({message_id:record.message_id,model_configuration_id:modelId,dispatch_request_id:record.dispatch_request_id,include_canonical_context:false},{organizationId:scope.organizationId})
   if(response.status!=='completed')throw Error('Mapping execution remains unsettled; do not redispatch')
   await checkCurrent();return result(record)
  })},
  recover(disclosure){return single(async()=>{await checkCurrent();const record=read();if(!record)return null
   if(!record.message_id){const latest=await chat.getContextConversation({conversation_id:scope.conversationId},{organizationId:scope.organizationId});const human=latest.messages?.find(m=>m.client_request_id===record.client_request_id);if(!human)throw Error('Original save outcome unknown; no request repeated');record.message_id=human.id;storage.setItem(key,JSON.stringify(record))}
   const original=await chat.getContextConversation({conversation_id:scope.conversationId},{organizationId:scope.organizationId})
   if(!disclosure||original.messages?.find(m=>m.id===record.message_id)?.body!==mappingPrompt(disclosure))throw Error('Recreate and review the exact original mapping scope before applying its response')
   await runner.recover(record.message_id,{organizationId:scope.organizationId});await checkCurrent();return result(record)
  })},
 })
}
