const unchanged=' Your draft is kept. No message or AI request was sent.'
export function contextChatSendBlocker(value,{attempted=true}={}){
 const suffix=attempted?unchanged:''
 if(!value||typeof value.paid_execution_enabled!=='boolean'||typeof value.spend_tracking_configured!=='boolean'||typeof value.model_status!=='string')return 'AI availability could not be verified. Retry AI availability.'+suffix
 const modelReasons={
  model_not_selected:'Choose an approved AI model.',
  model_unavailable:'The selected model is unavailable. Choose another approved model or ask an administrator to review model access.',
  connection_unavailable:'The selected model connection is unavailable. Ask an administrator to review the connection.',
  credential_unavailable:'The selected model credentials are unavailable. Ask an administrator to review its secure credential binding.',
  price_unavailable:'Approved pricing for the selected model is unavailable or expired. Ask an administrator to review model pricing.',
 }
 if(value.model_status!=='configured')return ((Object.hasOwn(modelReasons,value.model_status)?modelReasons[value.model_status]:null)||'The selected model is not ready. Choose another approved model or ask an administrator to review AI availability.')+suffix
 if(value.spend_readiness_status==='prior_cycle_reconciliation_required'){
  if(value.prospective_allowance_status==='not_required')return 'Spending status changed. Retry AI availability before another AI request.'+suffix
  if(value.prospective_allowance_status==='inactive')return 'Earlier AI charges remain unresolved. Review a separate Project Chat text allowance before another AI request.'+suffix
  if(value.prospective_allowance_status==='exhausted')return 'The separate Project Chat text allowance has insufficient room for the maximum supported reply. Review its remaining amount and expiry.'+suffix
  if(value.prospective_allowance_status)return 'Earlier AI charges remain unresolved and the separate Project Chat allowance cannot authorize this scope. Review spending controls.'+suffix
  return 'Organization AI spending from an earlier billing month needs reconciliation. An administrator must verify the original provider charges before another AI request.'+suffix
 }
 if(value.spend_readiness_status==='unmeasured_cost_reconciliation_required')return 'Organization AI spending has an unmeasured completed request. An administrator must reconcile its verified charge before another AI request.'+suffix
 if(!value.paid_execution_enabled)return 'AI replies are currently disabled. Ask an administrator to review text conversation availability.'+suffix
 if(!value.spend_tracking_configured)return 'AI spending controls are not configured. Ask an administrator to review text conversation spending controls.'+suffix
 return ''
}
// Advisory read only. The runner still rechecks authority, model, pricing and spend.
export async function readContextChatSendReadiness(read,modelId,{signal,timeoutMs=15000,conversationId,projectId}={}){
 if(!modelId)throw Error('Choose an approved AI model.'+unchanged)
 signal?.throwIfAborted()
 const controller=new AbortController()
 let timer,stop
 try{
  const cancelled=new Promise((_,reject)=>{
   stop=()=>{controller.abort();reject(Error('AI availability check was interrupted.'+unchanged))}
   signal?.addEventListener('abort',stop,{once:true})
   timer=setTimeout(()=>{controller.abort();reject(Error('AI availability check timed out. Retry AI availability.'+unchanged))},timeoutMs)
  })
  return await Promise.race([Promise.resolve().then(()=>read({model_configuration_id:modelId,...(conversationId?{conversation_id:conversationId}:projectId?{project_id:projectId}:{})},{signal:controller.signal})),cancelled])
 }finally{clearTimeout(timer);if(stop)signal?.removeEventListener('abort',stop)}
}
