// UI bridge only: native adapters own transport validation and immutable receipts.
export const chatExecutionIdentity = r => Object.fromEntries(['organization_id','project_id','conversation_id','source_message_id','request_id'].map(k=>[k,r[k]]))
export function chatExecutionSettled(result) {
  return result?.state?.kind==='website_native_package'
    ? !result.state.execution_window_expired && ['complete','failed'].includes(result.state.original_status)
    : ['staged','failed'].includes(result?.state?.status)
}
export function chatExecutionRow(result) {
  const {receipt:r,state:s}=result
  return {...s,id:r.output.job_id,website_page_design_id:r.output.design_id,page_id:r.output.page_id,request_id:r.request_id,chatResult:result}
}
export function readBuildPending(raw) {
  if(!raw)return null
  if(raw.startsWith('{')){try{return JSON.parse(raw)}catch{return {kind:'storage-unavailable'}}}
  return raw
}
export function createProjectChatWebsiteExecution({build,staging,design,stages,getState,readActor,timeoutMs=15000}) {
  function observe(promise){let timer;return Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Original outcome is uncertain. Check the retained request; it will not be sent again.')),timeoutMs)})]).finally(()=>clearTimeout(timer))}
  function checkReceipt(r,kind) {
    const s=getState()
    if(!r||r.kind!==kind||r.actor_id!==s.actorId||r.organization_id!==s.organizationId||r.project_id!==s.projectId||r.engagement_id!==s.engagementId||r.conversation_id!==s.conversationId)throw Error('Open the original owned conversation to continue this request.')
    return r
  }
  function own(p,kind) {
    const s=getState(),i=p?.proposal?.identity,m=p?.proposal?.review?.chat_context
    if(p?.kind===kind&&p.receipt){try{checkReceipt(p.receipt,kind==='chat-build'?'build_native_package':'stage_native_package');return true}catch{return false}}
    return p?.kind===kind&&i?.organization_id===s.organizationId&&i?.project_id===s.projectId&&i?.conversation_id===s.conversationId&&p.proposal.context.engagement_id===s.engagementId&&m?.actor_id===s.actorId
  }
  async function guard(write=false) {
    const s=getState(),actor=s.actorId
    const check=()=>{const now=getState();if(now.signal?.aborted||now.disabled||now.actorId!==actor||['organizationId','projectId','engagementId','conversationId'].some(k=>now[k]!==s[k]))throw Error('Website execution context changed. Preserve the original request.');if(write&&(!now.canExecute||now.draftDirty))throw Error('Current Development authority, active Website implementation service and a settled revision draft are required.')}
    check();if(await readActor()!==actor)throw Error('Signed-in actor changed. Preserve the original request.');check();return s
  }
  async function freshSelection(r,s) {
    if(r.selection===null)return null
    if(!r.selection)throw Error('Original stage selection is unavailable.')
    const v=r.selection,unit=await stages.readPartition({organizationId:s.organizationId,projectId:s.projectId,engagementId:s.engagementId},{planId:v.plan_id,groupId:v.group_id,partition:v.partition,signal:s.signal})
    if(unit.state!=='current'||unit.plan_id!==v.plan_id||unit.group_id!==v.group_id||Object.keys(v.partition).some(k=>unit.partition?.[k]!==v.partition[k]))throw Error('Original stage or page changed. Refresh its original context.')
    return {...v,context_sha256:unit.context_sha256}
  }
  function reviewIdentity(r,s) {
    if(!s.messages.some(m=>m.id===r.source_message_id&&m.conversation_id===s.conversationId&&m.role==='user'&&m.author_id===s.actorId))throw Error('Load the original human message before reviewing this action.')
    const {request_id: _request,...identity}=chatExecutionIdentity(r)
    return identity
  }
  async function recover(p,kind,remote=false) {
    if(!own(p,kind))throw Error('This pending request belongs to another conversation. Open its original conversation; no request was sent.')
    const s=await guard(),repo=kind==='chat-build'?build:staging
    const identity=p.receipt?chatExecutionIdentity(p.receipt):p.proposal.identity,engagementId=p.receipt?.engagement_id||p.proposal.context.engagement_id
    const value=await observe(remote?repo.reconcile(identity,engagementId,{signal:s.signal}):repo.recover(identity,{signal:s.signal}))
    if(value.status==='not_recorded')throw Error('No original claim is visible. This does not authorize another submission.')
    checkReceipt(value.receipt,kind==='chat-build'?'build_native_package':'stage_native_package')
    const same=(a,b)=>{const sort=v=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,sort(v[k])])):v;return JSON.stringify(sort(a))===JSON.stringify(sort(b))}
    if(p.receipt&&!same(value.receipt,p.receipt))throw Error('Recovered claim differs from the original recorded claim.')
    if(p.proposal){const c=p.proposal.context,r=value.receipt,stage=kind==='chat-staging';if(r.origin_request_id!==c[stage?'build_request_id':'design_request_id']||!same(r.selection,c.selection)||['design_id','page_id',...(stage?['job_id','target_id','previous_run_id']:[])].some(k=>r.output[k]!==c[k]))throw Error('Recovered claim differs from the original reviewed sources.')}
    return chatExecutionRow(value)
  }
  async function confirm(p,kind) {
    if(!p?.proposal||!own(p,kind))throw Error('Original reviewed Chat identity differs.')
    const s=await guard(true),repo=kind==='chat-build'?build:staging
    let result
    try{result=await observe(repo.confirm(p.proposal,{signal:s.signal}))}catch(e){throw Object.assign(e,{pendingRollback:e.knownRollback===true&&e.requestRetained!==true})}
    checkReceipt(result.receipt,kind==='chat-build'?'build_native_package':'stage_native_package')
    return chatExecutionRow(result)
  }
  return {
    build:{
      owns:p=>own(p,'chat-build'),confirm:p=>confirm(p,'chat-build'),recover:p=>recover(p,'chat-build'),
      async review(designId) {
        const s=await guard(true),origin=checkReceipt(s.designReceipt,'save_native_design')
        if(origin.output.design_id!==designId)throw Error('Review the exact selected Chat Design result.')
        const recovered=await design.recover(chatExecutionIdentity(origin),{signal:s.signal})
        if(recovered.status!=='recorded'||recovered.receipt.output.design_id!==designId||recovered.receipt.output.request_sha256!==origin.output.request_sha256)throw Error('Original Design receipt could not be verified.')
        const r=checkReceipt(recovered.receipt,'save_native_design'),identity=reviewIdentity(r,s),context={engagement_id:s.engagementId,selection:await freshSelection(r,s),design_request_id:r.request_id,design_id:r.output.design_id,page_id:r.output.page_id}
        const review=await build.review(identity,context,{signal:s.signal}),proposal=await build.prepare({...identity,request_id:crypto.randomUUID()},context,review)
        if(review.chat_context.actor_id!==s.actorId)throw Error('Reviewed actor changed.')
        return {...review,chatPending:{kind:'chat-build',proposal}}
      },
    },
    staging:{
      owns:p=>own(p,'chat-staging'),confirm:p=>confirm(p,'chat-staging'),recover:p=>recover(p,'chat-staging'),reconcile:p=>recover(p,'chat-staging',true),
      async review(targetId,jobId,previousRunId) {
        const s=await guard(true),origin=checkReceipt(s.buildReceipt,'build_native_package')
        if(origin.output.job_id!==jobId)throw Error('Choose the exact package from its Chat claim.')
        const value=await build.recover(chatExecutionIdentity(origin),{signal:s.signal})
        if(value.status!=='recorded'||value.state.status!=='complete'||value.state.stale_sources.length)throw Error('The original package must be complete and current before staging.')
        const r=checkReceipt(value.receipt,'build_native_package'),identity=reviewIdentity(r,s),context={engagement_id:s.engagementId,selection:await freshSelection(r,s),build_request_id:r.request_id,job_id:r.output.job_id,design_id:r.output.design_id,page_id:r.output.page_id,target_id:targetId,previous_run_id:previousRunId||null}
        const review=await staging.review(identity,context,{signal:s.signal}),proposal=await staging.prepare({...identity,request_id:crypto.randomUUID()},context,review)
        if(review.chat_context.actor_id!==s.actorId)throw Error('Reviewed actor changed.')
        return {...review,chatPending:{kind:'chat-staging',proposal}}
      },
    },
  }
}
