import {useEffect, useRef, useState} from 'react'
import {recurringPlans} from '../data/recurringPlansRepository.js'
import {supabase} from '../lib/supabase.js'
import {createServiceRecurringBridgeRepository} from '../data/serviceRecurringBridgeRepository.js'

let client
function bridge(){return client??=createServiceRecurringBridgeRepository(supabase)}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function sameScope(left, right) {
  return ['organizationId','projectId','engagementId','actorId'].every(key=>left?.[key]===right[key])
}

function checkedReview(result, scope, scopeId) {
  const source=result?.context
  if(source?.organization_id!==scope.organizationId || source.project_id!==scope.projectId ||
     source.engagement_id!==scope.engagementId || source.primary_owner_id!==scope.actorId ||
     source.selected_scope_id!==scopeId || !result.compiled || !result.proposal) {
    throw Error('The recurring service context changed. Review the current project again.')
  }
  const compiled=result.compiled,meta=compiled.schedule_definition?.service_bridge
  if(!Array.isArray(compiled.channels)||!Array.isArray(meta?.contributors)||!Number.isInteger(meta.generation_horizon)||
     ![compiled.deliverable_count,compiled.work_card_count,compiled.dependency_count].every(Number.isSafeInteger)){
    throw Error('The reviewed recurring plan summary is incomplete.')
  }
  if(result.proposal.scheduler!==null || source.plan_head?.schedule_definition?.scheduler!=null)throw Error('This plan already has scheduler settings. Use its existing plan workflow to review changes.')
  return result
}

function checkedReceipt(receipt, original) {
  const scope=original.reviewed.scope
  if(receipt?.request_id!==original.requestId || receipt.organization_id!==scope.organizationId ||
     receipt.project_id!==scope.projectId || receipt.engagement_id!==scope.engagementId ||
     receipt.scope_id!==original.reviewed.draft.p_scope_id || (original.reviewed.draft.p_plan_id && receipt.plan_id!==original.reviewed.draft.p_plan_id) || !UUID.test(receipt.plan_id) ||
     !UUID.test(receipt.plan_version_id) || !Number.isInteger(receipt.plan_version_number)) {
    throw Error('Check the original save to verify its plan version.')
  }
  return receipt
}

function firstCycleLastDay(compiled, anchor) {
  const next = new Date(compiled.effective_start+'T00:00:00Z')
  if (compiled.frequency==='weekly') next.setUTCDate(next.getUTCDate()+7)
  else {
    const anchorDay=Number(anchor.slice(-2))
    next.setUTCDate(1)
    next.setUTCMonth(next.getUTCMonth()+1)
    const monthEnd=new Date(Date.UTC(next.getUTCFullYear(),next.getUTCMonth()+1,0)).getUTCDate()
    next.setUTCDate(Math.min(anchorDay,monthEnd))
  }
  next.setUTCDate(next.getUTCDate()-1)
  return next.toISOString().slice(0,10)
}

function _CycleSummary({review}) {
  const {compiled}=review
  const metadata=compiled.schedule_definition.service_bridge
  return <section aria-label="Recurring service plan review" className="setup-service-diff">
    <h4>{compiled.title}</h4>
    <p><strong>{compiled.deliverable_count} deliverables per cycle</strong> · {compiled.work_card_count} departmental work cards · {compiled.dependency_count} dependencies</p>
    <p>Channels: {compiled.channels.length?compiled.channels.join(', '):'None recorded'}</p>
    <p>{compiled.frequency} · {compiled.timezone} · {metadata.generation_horizon} cycles in the reviewed horizon</p>
    <p>Cycle anchor: {metadata.cycle_anchor}. Plan starts {compiled.effective_start} and runs through {compiled.effective_end}.</p>
    <p>First cycle: {compiled.effective_start} through {firstCycleLastDay(compiled,metadata.cycle_anchor)}.</p>
    {review.context.plan_head?.schedule_definition?.service_bridge&&<p>Previous plan version: {review.context.plan_head.schedule_definition.service_bridge.deliverable_count} deliverables and {review.context.plan_head.schedule_definition.service_bridge.work_card_count} departmental cards per cycle.</p>}
    <p>Each generated card starts on the cycle start date and is due on the cycle’s final day. A service target date is a delivery deadline.</p>
    <details><summary>Contributing services and deadlines</summary>
      {metadata.contributors.map(row=><p key={row.scope_id}>{row.name} · {row.department_id} · {row.quantity} {row.unit} · Target: {row.service_line?.target_date||'Not set'}</p>)}
    </details>
    <p>Saving records a draft plan version. Approval, delegation, activation, and manual period confirmation take place in the existing recurring-plan workflow.</p>
  </section>
}

export default function ServiceRecurringReview({scope, snapshot, signal, disabled, onBusy}) {
  const storageKey=['anka:service-recurring',scope.organizationId,scope.projectId,scope.engagementId,scope.actorId].join(':')
  const [pending,setPending]=useState(()=>{
    try{return JSON.parse(sessionStorage.getItem(storageKey))}
    catch{return {unreadable:true}}
  })
  const [selected,setSelected]=useState('')
  const [source,setSource]=useState(null)
  const [choices,setChoices]=useState(null)
  const [chosenPlan,setChosenPlan]=useState(null)
  const [expanded,setExpanded]=useState(false)
  const [start,setStart]=useState('')
  const [reviewed,setReviewed]=useState(null)
  const [busy,setBusy]=useState(false)
  const [notice,setNotice]=useState('')
  const [error,setError]=useState('')
  const flight=useRef(false),mounted=useRef(false),live=useRef(null)
  live.current={selected,disabled,reviewed,pending}
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false}},[])
  useEffect(()=>{onBusy(busy||Boolean(pending));return()=>onBusy(false)},[busy,pending,onBusy])
  const current=()=>mounted.current&&!signal?.aborted
  const services=(snapshot.state?.plan?.contributions||[]).flatMap(item=>{
    const row=snapshot.scopes.find(sc=>sc.id===item.scope_id&&sc.service_id===item.service_id)
    return row&&['weekly','monthly'].includes(item.cadence)&&item.service_line?[{id:row.id,name:snapshot.catalog.find(s=>s.id===item.service_id)?.name||snapshot.leaves.find(s=>s.id===item.service_id)?.name||item.name||'Saved service',cadence:item.cadence}]:[]
  })
  async function run(action,recovery=false){
    if(!current()||flight.current||(!recovery&&live.current.disabled))return
    flight.current=true;setBusy(true);setError('');setNotice('')
    try{if(recovery||!sessionStorage.getItem(storageKey))await action()}catch(cause){if(current())setError(cause.message)}
    finally{flight.current=false;if(current())setBusy(false)}
  }
  function choose(id){
    if(flight.current||disabled||pending)return
    setSelected(id);setChoices(null);setChosenPlan(null);setSource(null);setStart('');setReviewed(null);setNotice('');setError('')
  }
  async function inspect(){
    setReviewed(null)
    let result
    try {
      result=checkedReview(await bridge().context(scope,selected,{planId:chosenPlan,signal}),scope,selected)
    }catch(cause){
      if(cause.code==='22023' && !chosenPlan && cause.message.includes('Several exact recurring plans')){
        const plans=(await recurringPlans.list(scope.engagementId)).filter(row=>
          row.organization_id===scope.organizationId&&row.project_id===scope.projectId&&row.engagement_id===scope.engagementId&&!['ended','archived'].includes(row.status))
        const matches=await Promise.all(plans.map(async row=>{
          const versions=await recurringPlans.listVersions(row.id)
          const head=versions.at(-1)
          return head?.schedule_definition?.service_bridge?.contributors?.some(item=>item.scope_id===selected)
            ? {id:row.id,title:head.title,version:head.version_number}:null
        }))
        if(current()&&live.current.selected===selected)setChoices(matches.filter(Boolean))
      }
      throw cause
    }
    if(!current()||live.current.selected!==selected)return
    const planId=result.context.existing_plan_id
    if(source&&source.existing_plan_id!==planId)throw Error('The existing plan changed. Select the saved service again.')
    if(chosenPlan&&planId!==chosenPlan)throw Error('The selected plan is unavailable in this scope.')
    const proposal={version:1,effective_start:start||result.proposal.effective_start,scheduler:null}
    setStart(proposal.effective_start);setSource(result.context)
    const next=await bridge().review(scope,selected,proposal,{planId,signal})
    if(!current()||live.current.selected!==selected)return
    checkedReview(next.review,scope,selected)
    if(next.review.context.existing_plan_id!==planId)throw Error('Plan identity changed during review.')
    setReviewed(next)
  }
  function complete(receipt,original){
    const result=checkedReceipt(receipt,original)
    sessionStorage.removeItem(storageKey)
    if(current()){
      setExpanded(true);setPending(null);setReviewed(null);setSource(null);setStart('')
      setNotice('Saved recurring plan version '+result.plan_version_number+'. Its approval and activation remain separate.')
    }
  }
  async function save(){
    if(!reviewed?.review.can_apply||reviewed!==live.current.reviewed||pending)return
    const original={requestId:crypto.randomUUID(),reviewed}
    const encoded=JSON.stringify(original)
    sessionStorage.setItem(storageKey,encoded)
    if(sessionStorage.getItem(storageKey)!==encoded)throw Error('Original request recovery is unavailable.')
    setPending(original)
    try{complete(await bridge().apply(reviewed,original.requestId),original)}
    catch(cause){
      if(cause.knownRollback&&cause.code!=='23505'){
        sessionStorage.removeItem(storageKey)
        if(current()){setPending(null);setReviewed(null)}
      }
      throw cause
    }
  }
  async function recover(){
    if(!UUID.test(pending?.requestId)||!sameScope(pending?.reviewed?.scope,scope))throw Error('Return to the original account and project.')
    const outcome=await bridge().recover(pending.reviewed.scope,pending.requestId)
    if(!current())return
    if(outcome?.request_id!==pending.requestId)throw Error('The original request is still unverified.')
    if(outcome.status==='applied'){complete(outcome.original_result,pending);return}
    if(outcome.status!=='not_applied')throw Error('The original request is still unverified.')
    const {draft}=pending.reviewed
    setSelected(draft.p_scope_id);setChosenPlan(draft.p_plan_id);setStart(draft.p_proposal.effective_start);setSource(pending.reviewed.review.context)
    setExpanded(true);setReviewed(null);sessionStorage.removeItem(storageKey);setPending(null)
    setNotice('The original draft was not saved. Review the retained start date before saving.')
  }
  if(!services.length&&!pending)return null
  const locked=busy||disabled||Boolean(pending)
  return <details className="setup-foundation" open={Boolean(pending)||expanded} onToggle={e=>setExpanded(e.currentTarget.open)}>
    <summary>Recurring service plan</summary>
    {pending?<><p>Check the original draft save before continuing.</p><button type="button" disabled={busy||pending.unreadable} onClick={()=>run(recover,true)}>Check original recurring save</button></>:<>
      <label>Saved service<select disabled={locked} value={selected} onChange={e=>choose(e.target.value)}><option value="">Choose a recurring service</option>{services.map(row=><option key={row.id} value={row.id}>{row.name} · {row.cadence}</option>)}</select></label>
      {choices&&<label>Existing plan<select disabled={locked} value={chosenPlan||''} onChange={e=>{setChosenPlan(e.target.value||null);setSource(null);setStart('');setReviewed(null);setError('')}}><option value="">Choose an existing plan</option>{choices.map(row=><option key={row.id} value={row.id}>{row.title} · v{row.version}</option>)}</select></label>}
      {source&&<details><summary>First cycle start</summary><input type="date" aria-label="First cycle start" value={start} disabled={locked} onChange={e=>{if(!flight.current&&!disabled){setStart(e.target.value);setReviewed(null)}}}/></details>}
      {selected&&<button type="button" disabled={locked||Boolean(source&&!start)||Boolean(choices&&!chosenPlan)} onClick={()=>run(inspect)}>Review recurring plan</button>}
    </>}
    {reviewed&&<><_CycleSummary review={reviewed.review}/><button type="button" disabled={locked||!reviewed.review.can_apply} onClick={()=>run(save)}>Save reviewed plan version</button></>}
    {error&&<p role="alert">{error}</p>}{notice&&<p role="status">{notice}</p>}
  </details>
}
