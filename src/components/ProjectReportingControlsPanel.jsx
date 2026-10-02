import {useEffect,useRef,useState} from 'react'
import {projectReportingControls} from '../data/projectReportingControls.js'
import {reportingConfigurationInput} from '../data/projectReportingControlsRepository.js'
import {reportingPeriod} from '../data/projectStoredReportingContracts.js'
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const INPUT='w-full rounded-lg border border-[var(--anka-line)] bg-[var(--anka-surface)] px-3 py-2 text-sm text-[var(--anka-ink)]'
const LIMITS={cadence_seconds:'Refresh interval (seconds)',history_days:'History window (days)',stale_after_seconds:'Stale after (seconds)',manual_min_interval_seconds:'Manual refresh interval (seconds)',daily_request_limit:'Requests per rolling day',backoff_seconds:'Initial retry delay (seconds)',max_backoff_seconds:'Maximum retry delay (seconds)',max_period_days:'Maximum request period (days)',max_observations:'Maximum observations per response',lease_seconds:'Request lease (seconds)'}
const empty=()=>({source_contract:'',reporting_time_zone:'',enabled:false,limits:Object.fromEntries(Object.keys(LIMITS).map(k=>[k,'']))})
const formOf=p=>p?{source_contract:p.source_contract,reporting_time_zone:p.reporting_time_zone,enabled:p.enabled,limits:Object.fromEntries(Object.entries(p.limits).map(([k,v])=>[k,String(v)]))}:empty()
const outcome=x=>x.action==='configure'?'Original refresh settings saved. Reload current settings before another action.':x.action==='verify'?(x.result.state==='expired'?'Original verification expired without dispatch. Reload before a new review.':x.result.original_result.resource_verified?'Original resource verification completed. Reload current status before refreshing.':'Original resource verification did not confirm access. Reload current status.'):x.result.state==='succeeded'?'Original refresh completed. Reload the stored report to review its coverage and values.':`Original refresh ended: ${x.result.state}. Reload current status before another review.`
export default function ProjectReportingControlsPanel({organizationId,projectId,actorId,bindingId,signal,blocked=false,onBusyChange,onChanged}){
 const scope={organizationId,projectId},key=`anka:reporting-control-operation:${actorId}:${organizationId}:${projectId}:v1`
 const [pending,setPending]=useState(()=>{try{const v=JSON.parse(sessionStorage.getItem(key)||'null');return v===null?null:Object.keys(v).length===2&&UUID.test(v.requestId||'')&&['configure','verify','refresh'].includes(v.action)?v:{requestId:'',action:''}}catch{return {requestId:'',action:''}}})
 const [data,setData]=useState(null),[form,setForm]=useState(empty),[start,setStart]=useState(''),[end,setEnd]=useState(''),[dirty,setDirty]=useState(false),[review,setReview]=useState(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('')
 const alive=useRef(true),flight=useRef(false),latest=useRef(null)
 latest.current={pending,data,form,start,end,dirty,review,busy,blocked,signal,bindingId}
 const active=()=>alive.current&&!latest.current.signal?.aborted
 const locked=()=>!active()||flight.current||latest.current.blocked||Boolean(latest.current.pending)
 const working=v=>{latest.current.busy=v;setBusy(v)}
 const invalidate=()=>{latest.current.review=null;setReview(null);setNotice('')}
 useEffect(()=>()=>{alive.current=false},[])
 useEffect(()=>{setData(null);setForm(empty());setReview(null);setDirty(false);setError('');setNotice('');latest.current.data=null;latest.current.review=null},[bindingId])
 useEffect(()=>{onBusyChange?.(busy||dirty||Boolean(review)||Boolean(pending));return()=>onBusyChange?.(false)},[busy,dirty,review,pending,onBusyChange])
 async function load(){
  if(locked()||!latest.current.bindingId)return;flight.current=true;working(true);setError('');invalidate();const original=latest.current.bindingId
  try{const fresh=await projectReportingControls.read({...scope,bindingId:original},{signal});if(active()&&latest.current.bindingId===original){setData(fresh);latest.current.data=fresh;const next=formOf(fresh.configuration.policy);setForm(next);latest.current.form=next;setDirty(false)}}catch(e){if(active()){setData(null);latest.current.data=null;setError(e.message)}}finally{flight.current=false;if(active())working(false)}
 }
 function change(key,value){if(locked())return;invalidate();const next=key in LIMITS?{...latest.current.form,limits:{...latest.current.form.limits,[key]:value}}:{...latest.current.form,[key]:value};latest.current.form=next;setForm(next);setDirty(true)}
 function dateChange(key,value){if(locked())return;invalidate();latest.current[key]=value;key==='start'?setStart(value):setEnd(value)}
 const signature=()=>JSON.stringify([latest.current.form,latest.current.start,latest.current.end])
 async function preview(action){
  if(locked()||!latest.current.data)return;flight.current=true;working(true);setError('');invalidate();const original=latest.current.data,expected=signature();let refreshed=false
  try{
   const fresh=await projectReportingControls.read({...scope,bindingId:original.binding_id},{signal});refreshed=true
   if(!active()||latest.current.data!==original||signature()!==expected)return
   if(fresh.binding_revision_number!==original.binding_revision_number||fresh.context_checksum!==original.context_checksum||fresh.configuration.policy?.id!==original.configuration.policy?.id)throw Error('The binding or policy changed. Reload settings and review again.')
   const policy=fresh.configuration.policy,adapter=fresh.adapters.find(a=>a.source_contract===policy?.source_contract)
   let input=null
   if(action==='configure'){
    if(!fresh.can_configure)throw Error('Current integration administrator required to configure reporting.')
    const f=latest.current.form;input=reportingConfigurationInput({...f,limits:Object.fromEntries(Object.entries(f.limits).map(([k,v])=>[k,/^[1-9][0-9]*$/.test(v)?Number(v):NaN])),binding_revision_number:fresh.binding_revision_number,context_checksum:fresh.context_checksum})
    if(!fresh.adapters.some(a=>a.source_contract===input.source_contract)&&input.source_contract!==policy?.source_contract)throw Error('Choose an exact installed reporting source.')
   }else if(!policy)throw Error('Save explicit settings before resource verification or refresh.')
   else if(action==='verify'){if(!fresh.can_configure||!adapter?.enabled)throw Error('Verification requires a current integration administrator and an enabled reviewed adapter.')}
   else{if(!fresh.status.refresh.eligible||fresh.status.refresh.queued)throw Error('Current resource verification, enabled settings and no unresolved job are required.');reportingPeriod(latest.current.start,latest.current.end,policy.reporting_time_zone);if((Date.parse(latest.current.end)-Date.parse(latest.current.start))/86400000+1>policy.limits.max_period_days)throw Error('The period exceeds this resource’s configured limit.')}
   const snapshot={action,input,expectedRevision:policy?.revision_number||0,policyId:policy?.id,bindingId:original.binding_id,startDate:latest.current.start,endDate:latest.current.end,timeZone:policy?.reporting_time_zone,signature:expected,fresh};latest.current.review=snapshot;setReview(snapshot)
  }catch(e){if(active()){if(!refreshed){setData(null);latest.current.data=null;onChanged?.()}setError(e.message)}}finally{flight.current=false;if(active())working(false)}
 }
 function finish(receipt){
  if(!receipt.settled){setNotice(`Original operation: ${receipt.result?.state||'not yet visible'}. Check this same operation again; no request will be repeated.`);return}
  sessionStorage.removeItem(key);latest.current.pending=null;setPending(null);invalidate();setData(null);latest.current.data=null;setDirty(false);onChanged?.();setNotice(outcome(receipt))
 }
 async function confirm(snapshot){
  if(locked()||!snapshot||latest.current.review!==snapshot||signature()!==snapshot.signature)return
  flight.current=true;working(true);setError('');const operation={action:snapshot.action,requestId:crypto.randomUUID()};let accepted=false
  try{
   sessionStorage.setItem(key,JSON.stringify(operation));latest.current.pending=operation;setPending(operation);onChanged?.()
   const v={...scope,...snapshot,...operation,confirmed:true};if(snapshot.action==='configure')await projectReportingControls.configure(v,{signal});else await projectReportingControls.dispatch(v,{signal});accepted=true
   const receipt=await projectReportingControls.recover({...scope,...operation},{signal});if(active())finish(receipt)
  }catch(e){if(active()){if(e.knownRollback&&!accepted){sessionStorage.removeItem(key);latest.current.pending=null;setPending(null);invalidate();setData(null);latest.current.data=null;setDirty(false)}setError(e.message)}}finally{flight.current=false;if(active())working(false)}
 }
 async function recover(){if(!active()||flight.current||latest.current.blocked||!UUID.test(latest.current.pending?.requestId||''))return;flight.current=true;working(true);setError('');try{const receipt=await projectReportingControls.recover({...scope,...latest.current.pending},{signal});if(active())finish(receipt)}catch(e){if(active())setError(e.message)}finally{flight.current=false;if(active())working(false)}}
 if(!bindingId&&!pending)return null
 const disabled=blocked||busy||Boolean(pending),policy=data?.configuration.policy
 return <section aria-label="Reporting refresh controls" className="rounded-lg border border-[var(--anka-line)] p-3 space-y-3 text-sm">
  <h4 className="font-semibold">Reporting settings and refresh</h4>
  <p className="text-xs text-[var(--anka-muted)]">Save explicit resource limits, verify access, then review a bounded refresh. Saving settings makes no provider request. Live actions use existing resource permission and shared request limits.</p>
  {error&&<p role="alert" className="text-[var(--anka-danger)]">{error}</p>}{notice&&<p role="status" className="text-[var(--anka-muted)]">{notice}</p>}
  {pending&&<section aria-label="Recover original refresh operation" className="rounded-lg border border-[var(--anka-warning)] p-3 space-y-2"><p>{pending.requestId?`Original ${pending.action} operation is retained. New actions stay blocked until its outcome is known.`:'The original recovery key is unreadable. Restore its exact action and UUID before new actions.'}</p>{pending.requestId&&<p className="break-all text-xs">{pending.requestId}</p>}<button type="button" className="workspace-button" disabled={busy||blocked||!pending.requestId} onClick={recover}>Check original refresh operation</button></section>}
  {bindingId&&<button type="button" className="workspace-button" disabled={disabled||dirty||Boolean(review)} onClick={load}>Load refresh settings</button>}
  {data&&<><p className="break-all text-xs">{data.status.binding.resource_kind.replaceAll('_',' ')} · {data.status.binding.resource_key} · Binding revision {data.binding_revision_number}{policy?` · Policy revision ${policy.revision_number}`:' · No saved policy'}</p>
   <fieldset disabled={disabled||!data.can_configure} className="grid gap-3 sm:grid-cols-2"><label className="text-xs">Installed reporting source<select aria-label="Reporting source contract" className={INPUT} value={form.source_contract} onChange={e=>change('source_contract',e.target.value)}><option value="">Choose a reviewed source</option>{policy&&!data.adapters.some(a=>a.source_contract===policy.source_contract)&&<option value={policy.source_contract}>{policy.source_contract} · unavailable</option>}{data.adapters.map(a=><option key={a.source_contract} value={a.source_contract}>{a.source_contract}{a.enabled?'':' · disabled'}</option>)}</select></label><label className="text-xs">Resource reporting timezone<input aria-label="Reporting timezone" className={INPUT} value={form.reporting_time_zone} maxLength={120} onChange={e=>change('reporting_time_zone',e.target.value)}/></label>
   {Object.entries(LIMITS).map(([k,label])=><label key={k} className="text-xs">{label}<input aria-label={label} className={INPUT} inputMode="numeric" value={form.limits[k]} maxLength={16} onChange={e=>change(k,e.target.value)}/></label>)}
   <label className="text-xs sm:col-span-2"><input aria-label="Enable reporting refresh" type="checkbox" checked={form.enabled} onChange={e=>change('enabled',e.target.checked)}/> Enable refresh after current resource verification</label>
   </fieldset>
   {!data.can_configure&&<p className="text-xs">An integration administrator must configure settings and verify resource access.</p>}
   <div className="flex flex-wrap gap-2"><button type="button" className="workspace-button" disabled={disabled||!data.can_configure} onClick={()=>preview('configure')}>Review refresh settings</button><button type="button" className="workspace-button" disabled={disabled||dirty||!data.can_configure||!policy} onClick={()=>preview('verify')}>Review resource verification</button></div>
   <fieldset disabled={disabled||dirty} className="grid gap-3 sm:grid-cols-2"><label className="text-xs">Refresh period start<input type="date" aria-label="Refresh period start" className={INPUT} value={start} onChange={e=>dateChange('start',e.target.value)}/></label><label className="text-xs">Refresh period end<input type="date" aria-label="Refresh period end" className={INPUT} value={end} onChange={e=>dateChange('end',e.target.value)}/></label></fieldset>
   <p className="text-xs text-[var(--anka-muted)]">Period timezone: {policy?.reporting_time_zone||'Not configured'}. {data.status.refresh.queued?`Original job remains ${data.status.refresh.job?.state}; review its original operation.`:data.status.refresh.eligible?'Current status permits a reviewed request; authority, quota and dates are checked again when submitted.':'Refresh is unavailable until current access and explicit settings permit it.'}</p>
   <button type="button" className="workspace-button" disabled={disabled||dirty||!data.status.refresh.eligible||data.status.refresh.queued} onClick={()=>preview('refresh')}>Review manual refresh</button>
  </>}
  {(dirty||review)&&!pending&&<button type="button" className="workspace-button" disabled={disabled} onClick={()=>{if(locked())return;invalidate();setForm(formOf(latest.current.data?.configuration.policy));setDirty(false)}}>Discard refresh review</button>}
  {review&&!pending&&<section aria-label="Review exact refresh action" className="rounded-lg border border-[var(--anka-focus)] p-3 space-y-2"><h5 className="font-semibold">{review.action==='configure'?'Review reporting settings':review.action==='verify'?'Review resource access verification':'Review manual report refresh'}</h5><p className="break-all">{review.fresh.status.binding.resource_key} · {review.input?.source_contract||review.fresh.configuration.policy.source_contract}</p>{review.action==='configure'?<><p>{review.input.enabled?'Enabled when current verification permits':'Paused'} · {review.input.reporting_time_zone}</p><dl className="grid gap-1 sm:grid-cols-2 text-xs">{Object.entries(LIMITS).map(([k,label])=><div key={k}><dt>{label}</dt><dd>{review.input.limits[k]}</dd></div>)}</dl><p>Records one settings revision. No verification or report is fetched.</p></>:<><p>{review.action==='refresh'?`${review.startDate} through ${review.endDate} · ${review.timeZone}`:'Checks this exact existing resource using its current server credential.'}</p><p>May make one bounded provider request under the configured quota. No automatic resend follows an uncertain response.</p></>}<button type="button" className="workspace-button workspace-button-primary" disabled={disabled} onClick={()=>confirm(review)}>Confirm {review.action==='configure'?'refresh settings':review.action==='verify'?'resource verification':'manual refresh'}</button></section>}
 </section>
}
