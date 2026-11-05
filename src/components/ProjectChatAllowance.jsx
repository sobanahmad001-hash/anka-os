import { useEffect, useMemo, useRef, useState } from 'react'
import { createProjectChatAllowanceRepository } from '../data/projectChatAllowanceRepository.js'
import { supabase } from '../lib/supabase.js'

const money = micro => new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:6}).format(micro / 1000000)
const date = value => new Date(value).toLocaleString(undefined,{timeZoneName:'short'})
const eligible = value => value?.paid_execution_enabled === true && value.spend_tracking_configured === true &&
  value.model_status === 'configured' && value.prospective_allowance_status === 'inactive' &&
  value.spend_readiness_status === 'prior_cycle_reconciliation_required'

export default function ProjectChatAllowance({ organizationId, projectId, actorId, modelId, projectLabel, modelLabel, readiness, checkReadiness, refresh, signal }) {
  const repo = useMemo(()=>createProjectChatAllowanceRepository(supabase,{organizationId,projectId,modelConfigurationId:modelId}),[organizationId,projectId,modelId])
  const key = 'anka:project-chat-allowance:'+JSON.stringify([organizationId,actorId,projectId,modelId])
  const [policy,setPolicy] = useState(null), [review,setReview] = useState(null)
  const [amount,setAmount] = useState(''), [minutes,setMinutes] = useState('')
  const [busy,setBusy] = useState(false), [notice,setNotice] = useState('')
  const [pending,setPending] = useState(()=>sessionStorage.getItem(key) || sessionStorage.getItem(key+':revoke'))
  const historyKey=key+':unconfirmed'
  const [hasHistory,setHasHistory]=useState(()=>Boolean(sessionStorage.getItem(historyKey)))
  const live=useRef(false), lock=useRef(false)
  const current=()=>live.current && !signal.aborted
  useEffect(()=>{
    let active=true
    live.current=true
    repo.read().then(value=>{if(active && !signal.aborted)setPolicy(value)}).catch(()=>{if(active && !signal.aborted)setNotice('The current allowance could not be checked.')})
    return ()=>{active=false;live.current=false}
  },[repo,signal])

  async function act(operation) {
    if(lock.current || !current())return
    lock.current=true;setBusy(true);setNotice('')
    try { await operation() }
    catch { if(current())setNotice('The allowance action could not be verified. Check the current policy before continuing.') }
    finally {lock.current=false;if(current())setBusy(false)}
  }
  async function check(){
    const value=await repo.read()
    if(current()){setPolicy(value);refresh()}
    return value
  }
  async function freshEligibility(){
    const value=await checkReadiness()
    if(!current())return null
    if(eligible(value))return value
    setReview(null)
    setNotice('Availability changed. Check the current spending and model settings.')
    refresh()
    return null
  }
  async function preview(){
    setReview(null)
    if(!await freshEligibility())return
    const cap=Math.round(Number(amount)*1000000), seconds=Number(minutes)*60
    const value=await repo.preview({capMicrousd:cap,durationSeconds:seconds})
    if(!current())return
    if(value.actor_id!==actorId || value.project_id!==projectId || value.organization_id!==organizationId ||
      value.model_configuration_id!==modelId || value.cap_microusd!==cap || value.duration_seconds!==seconds ||
      !value.review_hash || !value.historical_costs_unresolved || !value.historical_charge_may_exceed_estimate)throw Error()
    setReview(value)
  }
  async function write(action){
    const actionKey=action==='activate'?key:key+':revoke'
    if(sessionStorage.getItem(actionKey) || (action==='activate' && pending))return
    if(action==='activate' && (!review || !await freshEligibility()))return
    const record={action,requestId:crypto.randomUUID(),policyId:policy?.policy_id}
    sessionStorage.setItem(actionKey,JSON.stringify(record));setPending(JSON.stringify(record))
    let result
    try { result=action==='activate'?await repo.apply({requestId:record.requestId,review}):await repo.revoke({requestId:record.requestId,policyId:record.policyId})
    } catch(error) {
      if (['40001','42501','22023','55000','54000'].includes(error?.code)) {
        sessionStorage.removeItem(actionKey)
        if(current()){setPending(sessionStorage.getItem(key));setReview(null)}
      }
      throw error
    }
    if(action==='activate' && (result.action?.project_id!==projectId || result.action?.model_configuration_id!==modelId || result.action?.cap_microusd!==review.cap_microusd || result.action?.duration_seconds!==review.duration_seconds))throw Error()
    if(result.must_not_dispatch!==true || result.action?.request_id!==record.requestId || result.action?.action!==action ||
      result.action?.actor_id!==actorId || !result.action.policy_id || (action==='revoke' && result.action.policy_id!==record.policyId))throw Error()
    sessionStorage.removeItem(actionKey)
    if(!current())return
    setPending(sessionStorage.getItem(key));setReview(null);setPolicy(null)
    const latest=await check()
    if(current())setNotice('Action receipt verified. Current policy status: '+latest.status+'.')
  }
  const pendingAction=pending && JSON.parse(pending)
  const canSeparateReview = pendingAction && policy?.policy_id && ['revoked','expired'].includes(policy.status) &&
    (pendingAction.action==='activate' ? policy.policy_id!==pendingAction.policyId : policy.policy_id===pendingAction.policyId)
  async function separateReview(){
    const latest=await repo.read()
    if(!current())return
    setPolicy(latest)
    if(!canSeparateReview || latest.policy_id!==policy.policy_id || !['revoked','expired'].includes(latest.status))return
    const actions=[key,key+':revoke'].map(k=>sessionStorage.getItem(k)).filter(Boolean).map(JSON.parse)
    const previous=JSON.parse(sessionStorage.getItem(historyKey) || '[]')
    sessionStorage.setItem(historyKey,JSON.stringify([...previous,...actions.filter(a=>!previous.some(p=>p.requestId===a.requestId))]))
    sessionStorage.removeItem(key);sessionStorage.removeItem(key+':revoke')
    setHasHistory(true);setPending(null);setReview(null);setAmount('');setMinutes('');refresh()
    setNotice('The earlier action identity is retained. Enter new terms for a separate review.')
  }
  const canSetup=policy && ['none','revoked','expired'].includes(policy.status) && eligible(readiness)
  const canRevoke=policy?.policy_id && ['active','expired'].includes(policy.status)
  const available=readiness?.prospective_allowance
  const maximumHold=available?.maximum_turn_microusd ?? readiness?.prospective_maximum_hold_microusd
  if(!canSetup && !canRevoke && !pending && !hasHistory && !notice && !available)return null
  return <section aria-label="Project Chat text allowance"><h3>Project Chat text allowance</h3>
    <p>{projectLabel} · {modelLabel}</p>
    {(canSetup || canRevoke || pending || available || policy?.historical_costs_unresolved) && <p>Earlier charges remain unresolved and may exceed estimates. This allowance covers only new Project Chat text requests.</p>}
    {Number.isSafeInteger(maximumHold) && maximumHold>0 && <p>Each reply requires room for a full {money(maximumHold)} hold, even for a short message. The hold reserves room in the allowance. Measured usage settles separately. An uncertain outcome keeps the hold.</p>}
    {available && <p>{money(available.remaining_microusd)} remaining for new text at the last check, through {date(available.expires_at)}.</p>}
    {canRevoke && <p>Policy {policy.status} · {money(policy.cap_microusd)} cap · expires {date(policy.expires_at)}. Revoking stops new admissions. Already admitted requests can still finish.</p>}
    {canSetup && !pending && <form onSubmit={event=>{event.preventDefault();void act(preview)}}>
      <label>New-text cap (USD)<input type="number" min="0.000001" max="1" step="0.000001" required value={amount} disabled={busy} onChange={e=>{setAmount(e.target.value);setReview(null)}}/></label>
      <label>Expires after (minutes)<input type="number" min="1" max="1440" step="1" required value={minutes} disabled={busy} onChange={e=>{setMinutes(e.target.value);setReview(null)}}/></label>
      <button disabled={busy}>Preview allowance</button></form>}
    {review && canSetup && !pending && <div><p>Authorize up to {money(review.cap_microusd)} for {review.duration_seconds/60} minutes from activation. Earlier charges remain separate.</p>
      {Number.isSafeInteger(maximumHold) && review.cap_microusd<maximumHold && <p>This cap cannot admit one reply at the current hold amount.</p>}
      <button type="button" disabled={busy} onClick={()=>act(()=>write('activate'))}>Accept exposure and activate allowance</button></div>}
    {canRevoke && !sessionStorage.getItem(key+':revoke') && <button type="button" disabled={busy} onClick={()=>act(()=>write('revoke'))}>Revoke this allowance</button>}
    {pending && <p>Last checked policy status: {policy?.status || 'unknown'}. The original action may still be in progress. Checking current status does not repeat it.</p>}
    {canSeparateReview && <button type="button" disabled={busy} onClick={()=>act(separateReview)}>Start a separate allowance review</button>}
    {hasHistory && <p>An earlier action has no confirmed receipt. Its original request identity is retained.</p>}
    {(pending || hasHistory || notice || available || canRevoke) && <button type="button" disabled={busy} onClick={()=>act(check)}>Check current policy</button>}
    {notice && <p role="status">{notice}</p>}
  </section>
}
