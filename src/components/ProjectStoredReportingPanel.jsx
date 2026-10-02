import {useEffect,useRef,useState} from 'react'
import {projectStoredReporting} from '../data/projectStoredReporting.js'
import {compareStoredReportingMetrics,rollupStoredReportingMetrics} from '../data/projectStoredReportingContracts.js'
const INPUT='w-full rounded-lg border border-[var(--anka-line)] bg-[var(--anka-surface)] px-3 py-2 text-sm text-[var(--anka-ink)]'
const stamp=value=>value?value.replace('T',' '):'Unknown'
const label=value=>(value||'unknown').replaceAll('_',' ')
const resourceLabel={ga4_property:'GA4 property',gsc_site:'Search Console site',google_ads_customer:'Google Ads customer',meta_facebook_page:'Facebook page',meta_instagram_account:'Instagram account'}
export default function ProjectStoredReportingPanel({organizationId,projectId,bindingId,signal,blocked=false}){
 const [startDate,setStartDate]=useState(''),[endDate,setEndDate]=useState(''),[timeZone,setTimeZone]=useState('UTC'),[metricKey,setMetricKey]=useState(''),[pageSize,setPageSize]=useState(25),[data,setData]=useState(null),[status,setStatus]=useState(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[beforeId,setBeforeId]=useState(''),[afterId,setAfterId]=useState(''),[comparison,setComparison]=useState(null),[rollup,setRollup]=useState(null)
 const alive=useRef(true),flight=useRef(false),seq=useRef(0),latest=useRef(null)
 latest.current={organizationId,projectId,bindingId,signal,blocked,startDate,endDate,timeZone,metricKey,pageSize,busy,data,beforeId,afterId}
 const active=()=>alive.current&&!latest.current.signal?.aborted
 useEffect(()=>()=>{alive.current=false;seq.current+=1},[])
 function change(setter,value){if(!active()||flight.current||latest.current.blocked)return;seq.current+=1;setData(null);setComparison(null);setRollup(null);setBeforeId('');setAfterId('');setError('');setter(value)}
 async function load(kind='list',offset=0){
  if(!active()||flight.current||latest.current.blocked)return;flight.current=true;setBusy(true);setError('');setComparison(null);setRollup(null);const expected=++seq.current,v={...latest.current,offset,limit:latest.current.pageSize}
  // Clear cached values before every current-permission recheck, including errors.
  setData(null);setBeforeId('');setAfterId('');setStatus(null)
  try{const result=await projectStoredReporting[kind](v,{signal});if(active()&&seq.current===expected){if(kind==='list'){setData(result);setStatus(result.context)}else setStatus(result)}}catch(cause){if(active()&&seq.current===expected)setError(cause.message)}finally{flight.current=false;if(active()&&seq.current===expected)setBusy(false)}
 }
 function compare(){if(!active()||flight.current||blocked)return;const a=data?.items.find(row=>row.id===beforeId),b=data?.items.find(row=>row.id===afterId);if(!a||!b){setError('Choose two exact loaded observations.');return}if(a.reporting_time_zone!==timeZone||b.reporting_time_zone!==timeZone){setError('Choose observations with the explicit comparison timezone.');return}try{setComparison(compareStoredReportingMetrics(a,b));setError('')}catch(cause){setComparison(null);setError(cause.message)}}
 function aggregate(){if(!active()||flight.current||blocked||!data)return;try{setRollup(rollupStoredReportingMetrics(data.items));setError('')}catch(cause){setRollup(null);setError(cause.message)}}
 const disabled=busy||blocked,current=status||data?.context
 return <section aria-label="Stored project report" className="rounded-xl border border-[var(--anka-line)] bg-[var(--anka-surface)] p-4 space-y-4">
  <h4 className="font-semibold">Stored project report</h4>
  <p className="text-sm text-[var(--anka-muted)]">Choose an explicit period. This view reads stored evidence and checks current resource access each time. Opening it does not fetch from a provider.</p>
  {error&&<p role="alert" className="text-sm text-[var(--anka-danger)]">{error}</p>}
  <fieldset disabled={disabled} className="grid gap-3 sm:grid-cols-2">
   <label className="text-xs">Period start<input type="date" aria-label="Stored report period start" value={startDate} className={INPUT} onChange={e=>change(setStartDate,e.target.value)}/></label>
   <label className="text-xs">Period end<input type="date" aria-label="Stored report period end" value={endDate} className={INPUT} onChange={e=>change(setEndDate,e.target.value)}/></label>
   <label className="text-xs">Comparison timezone<input aria-label="Stored report timezone" value={timeZone} maxLength={120} className={INPUT} onChange={e=>change(setTimeZone,e.target.value)}/></label>
   <label className="text-xs">Exact metric key (optional)<input aria-label="Stored report metric key" value={metricKey} maxLength={240} className={INPUT} onChange={e=>change(setMetricKey,e.target.value)}/></label>
   <label className="text-xs">Observations per page<select aria-label="Stored report page size" className={INPUT} value={pageSize} onChange={e=>change(setPageSize,Number(e.target.value))}><option value={10}>10 observations</option><option value={25}>25 observations</option></select></label>
   <div className="flex flex-wrap gap-2 sm:col-span-2"><button type="button" className="workspace-button" onClick={()=>load()}>Load stored report</button><button type="button" className="workspace-button" onClick={()=>load('status')}>Check reporting status</button><button type="button" className="workspace-button" disabled>Provider refresh unavailable</button></div>
  </fieldset>
  {busy&&<p role="status" className="text-sm text-[var(--anka-muted)]">Checking current resource access and stored evidence…</p>}
  {current&&<section aria-label="Current reporting status" className="rounded-lg bg-[var(--anka-surface-raised)] p-3 text-sm space-y-2">
   <p className="break-all font-medium">{resourceLabel[current.binding.resource_kind]||'Reporting resource'} · {current.binding.resource_key}</p>
   <p>Current access: {label(current.reason)}. {current.stored_observations} stored observations.</p>
   <p>Latest recorded sync: {label(current.latest_sync_event?.state)} · {stamp(current.latest_sync_event?.occurred_at)}</p>
   <p>Historical last successful sync: {stamp(current.historical_last_success_at)}{current.latest_sync_event?.next_retry_at&&` · recorded retry after ${stamp(current.latest_sync_event.next_retry_at)}`}</p>
   <p className="text-xs text-[var(--anka-muted)]">{current.refresh?.limits?`Configured cadence ${current.refresh.limits.cadence_seconds} seconds · history ${current.refresh.limits.history_days} days · stale threshold ${current.refresh.limits.stale_after_seconds} seconds · daily request limit ${current.refresh.limits.daily_request_limit}. ${current.refresh.enabled?'Refresh policy enabled.':'Refresh policy paused.'} ${current.refresh.queued?`Original refresh ${label(current.refresh.job?.state)}.`:'No refresh is queued.'}`:'Cadence, retained history window, stale threshold, manual refresh quota and backoff policy await configuration. No refresh is queued.'} A recorded success does not establish current permission.</p>
  </section>}
  {data&&<><p role="status" className="text-xs text-[var(--anka-muted)]">{data.items.length} shown · {data.matching} matches · {data.total} total stored observations. Collection {data.collection_start_date} through {data.collection_end_date}.</p>
   {data.items.length===0&&<p className="text-sm text-[var(--anka-muted)]">{data.total===0?'No stored observations for this resource.':'No observations match this period and metric. Other stored history remains.'}</p>}
   <div className="space-y-3">{data.items.map(row=><article key={row.id} className="rounded-lg border border-[var(--anka-line)] p-3 text-sm space-y-1">
    <h5 className="font-semibold">{row.metric_label} · {row.value_state==='available'?row.metric_value:'Unavailable'} {row.value_state==='available'?row.unit:''}</h5>
    <p>{row.period_start} through {row.period_end} · {row.reporting_time_zone}</p>
    <p>Completeness {label(row.completeness)} · freshness {label(row.freshness)} · data through {stamp(row.data_through)}</p>
    <p className="text-xs text-[var(--anka-muted)]">Retrieved {stamp(row.retrieved_at)} · last successful retrieval {stamp(row.last_success_at)}</p>
    <p className="break-words text-xs">Source {row.source_contract} · {row.source_observation_id} · {label(row.source_acceptance)}. {row.value_state==='withheld'?`Values withheld: ${label(row.metrics_withheld_reason)}.`:row.value_state==='unknown'?'The source value is unknown.':''}</p>
    {(row.page_revision_id||row.placement_revision_id)&&<details className="text-xs"><summary>Exact publication reference</summary><p className="break-all">{row.page_revision_id?`Page revision ${row.page_revision_id}`:`Placement revision ${row.placement_revision_id}`}. This reference does not establish attribution.</p></details>}
   </article>)}</div>
   <div className="flex flex-wrap gap-2">{data.offset>0&&<button type="button" className="workspace-button" disabled={disabled} onClick={()=>load('list',Math.max(0,data.offset-pageSize))}>Previous stored observations</button>}{data.has_more&&<button type="button" className="workspace-button" disabled={disabled} onClick={()=>load('list',data.offset+pageSize)}>Next stored observations</button>}</div>
   <fieldset disabled={disabled} className="grid gap-3 sm:grid-cols-2"><label className="text-xs">Earlier exact observation<select aria-label="Earlier stored observation" className={INPUT} value={beforeId} onChange={e=>{setBeforeId(e.target.value);setComparison(null)}}><option value="">Choose an exact observation</option>{data.items.map(row=><option key={row.id} value={row.id}>{row.metric_label} · {row.period_start}–{row.period_end} · {row.source_observation_id}</option>)}</select></label><label className="text-xs">Later exact observation<select aria-label="Later stored observation" className={INPUT} value={afterId} onChange={e=>{setAfterId(e.target.value);setComparison(null)}}><option value="">Choose an exact observation</option>{data.items.map(row=><option key={row.id} value={row.id}>{row.metric_label} · {row.period_start}–{row.period_end} · {row.source_observation_id}</option>)}</select></label><div className="flex flex-wrap gap-2 sm:col-span-2"><button type="button" className="workspace-button" onClick={compare}>Compare exact observations</button><button type="button" className="workspace-button" onClick={aggregate}>Review loaded rollup</button></div></fieldset>
  </>}
  {comparison&&<p role="status" className="text-sm">{comparison.comparable?`Observed change ${comparison.absolute_change} ${comparison.after.unit}; percentage ${comparison.percent_change===null?'unknown (zero baseline)':comparison.percent_change+'%'}.`:`Comparison unavailable: ${label(comparison.reason)}.`} Periods {comparison.before.period_start}–{comparison.before.period_end} and {comparison.after.period_start}–{comparison.after.period_end}. No causal or attribution claim.</p>}
  {rollup&&<p role="status" className="text-sm">Loaded rollup: {rollup.state==='available'?rollup.value:'Unavailable'} · {label(rollup.state)} · {rollup.deduplicated} distinct records · {rollup.duplicate_count} shared-source duplicates excluded. {data?.has_more?'This loaded page is a partial collection; it is not a project total.':''} No causal or attribution claim.</p>}
 </section>
}
