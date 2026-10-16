import { DESIGN_BRIEF_REPLY_SCHEMA, designBriefInstruction, parseDesignBriefReply } from './designChatBriefContract.ts'
import { beginDesignChatBriefTurn, finalizeDesignChatBriefTurn } from './designChatBriefTurn.ts'
type Json = Record<string, any>
const keys = ['creative_brief_id','expected_revision','visibility','engagement_id','brand_id','engagement_service_id','content','source_version_ids']
export async function prepareDesignBrief(admin:any,userClient:any,identity:Json,value:unknown,scope:Json,manifest:Json) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('An exact Design draft snapshot is required')
  const binding = value as Json
  if (Object.keys(binding).some(k=>!keys.includes(k)) || keys.some(k=>!(k in binding))) throw new Error('Invalid Design draft snapshot fields')
  if (binding.visibility !== scope.visibility || binding.engagement_id !== scope.engagement_id
    || (scope.visibility === 'private' && (binding.brand_id !== null || binding.engagement_service_id !== null))) throw new Error('Design draft scope changed')
  const receipt = await beginDesignChatBriefTurn(admin,userClient,{...identity,binding:{...binding,source_manifest:manifest}} as any)
  if (receipt.status !== 'pending') throw new Error('This Design draft turn already has a result; recover its saved state')
  const content=receipt.binding.content
  const editable=Object.fromEntries(DESIGN_BRIEF_REPLY_SCHEMA.editable_fields.filter(k=>k in content).map(k=>[k,content[k]]))
  return {identity,binding:receipt.binding,instruction:designBriefInstruction(content),snapshot:JSON.stringify(editable)}
}
export function designBriefAudit(turn:Json|undefined,raw:string) {
  if (!turn) return {text:raw,manifest:{}}
  let text='The reply could not be validated. Your draft has not been changed. Recover this saved turn before sending another request.'
  try { const parsed=parseDesignBriefReply(raw,turn.binding.content);text=[parsed.assistant_text,...parsed.questions].join('\n\n') } catch { /* Record invalid output without another provider call. */ }
  return {text,manifest:{design_brief_turn:turn.identity,design_brief_reply:raw}}
}
export async function settleDesignBrief(admin:any,userClient:any,identity:Json,raw:string) {
  try { const receipt=await finalizeDesignChatBriefTurn(admin,userClient,identity as any,raw);return {...receipt,client_request_id:receipt.request_id} }
  catch { return {...identity,client_request_id:identity.request_id,status:'pending',result:null} }
}
export async function recoverAuditedDesignBrief(admin:any,userClient:any,manifest:Json,scope:Json) {
  const identity=manifest?.design_brief_turn
  if (!identity) return null
  if (identity.organization_id!==scope.organization_id || identity.actor_id!==scope.actor_id
    || identity.conversation_id!==scope.conversation_id || (scope.message_id && identity.message_id!==scope.message_id)
    || typeof manifest.design_brief_reply!=='string') return null
  return settleDesignBrief(admin,userClient,identity,manifest.design_brief_reply)
}
