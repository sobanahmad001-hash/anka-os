// Provider-free planning only. A plan is never authority to dispatch or ingest.
// The eventual server claim must lock/recheck current scope, policy, quota and job identity.
const DAY=86400000
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const uuid=(v,k)=>{if(typeof v!=='string'||!UUID.test(v))throw new TypeError(`${k} requires an exact UUID`);return v}
const integer=(v,k,max=Number.MAX_SAFE_INTEGER)=>{if(!Number.isSafeInteger(v)||v<1||v>max)throw new TypeError(`${k} requires a positive bounded integer`);return v}
const instant=(v,k)=>{if(typeof v!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(v)||!Number.isFinite(Date.parse(v))||new Date(Date.parse(v)).toISOString().slice(0,19)!==v.slice(0,19)||v.startsWith('0000'))throw new TypeError(`${k} requires an exact UTC instant`);return Date.parse(v)}
const date=v=>{const n=Date.parse(`${v}T00:00:00Z`);if(typeof v!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(v)||v.startsWith('0000')||!Number.isFinite(n)||new Date(n).toISOString().slice(0,10)!==v)throw new TypeError('Real calendar dates required');return n}
const text=(v,k,max)=>{if(typeof v!=='string'||!v.trim()||v.length>max||/[\u0000-\u001f\u007f]/.test(v))throw new TypeError(`${k} requires explicit bounded text`);return v}
const closed=(v,keys)=>{if(!v||typeof v!=='object'||Array.isArray(v)||Object.keys(v).some(k=>!keys.includes(k))||keys.some(k=>!Object.hasOwn(v,k)))throw new TypeError('Exact closed contract required')}
export function reportingRefreshPolicy(value){
 const keys=['cadence_seconds','history_days','stale_after_seconds','manual_min_interval_seconds','daily_request_limit','backoff_seconds','max_backoff_seconds','max_period_days','max_observations','lease_seconds']
 closed(value,keys);for(const k of keys)integer(value[k],k)
 for(const k of ['cadence_seconds','stale_after_seconds','manual_min_interval_seconds','backoff_seconds','max_backoff_seconds','lease_seconds'])integer(value[k],k,31536000)
 integer(value.history_days,'history_days',366);integer(value.max_period_days,'max_period_days',value.history_days)
 integer(value.max_observations,'max_observations',1000)
 if(value.max_backoff_seconds<value.backoff_seconds)throw new TypeError('Backoff ceiling cannot be shorter than initial backoff')
 return Object.freeze({...value})
}
export function reportingRefreshIdentity(value){
 closed(value,['organization_id','project_id','binding_id','binding_revision_number','context_checksum','provider','resource_kind','resource_key','source_contract','period_start','period_end','reporting_time_zone'])
 for(const k of ['organization_id','project_id','binding_id'])uuid(value[k],k)
 integer(value.binding_revision_number,'binding_revision_number')
 if(!/^[a-f0-9]{64}$/.test(value.context_checksum||''))throw new TypeError('Exact current binding checksum required')
 for(const k of ['provider','resource_kind'])text(value[k],k,80)
 text(value.resource_key,'resource_key',2048);text(value.source_contract,'source_contract',240)
 const start=date(value.period_start),end=date(value.period_end);if(end<start||end-start>365*DAY)throw new TypeError('Ordered period of at most366 days required')
 text(value.reporting_time_zone,'reporting_time_zone',120);try{new Intl.DateTimeFormat('en',{timeZone:value.reporting_time_zone})}catch{throw new TypeError('Recognized reporting timezone required')}
 // Fixed field ordering: the opaque key is for an atomic same-scope dedupe claim.
 return Object.freeze({identity:Object.freeze({...value}),key:JSON.stringify(Object.keys(value).sort().map(k=>[k,value[k]])),days:1+(end-start)/DAY})
}
export function reportingRefreshPlan({policy:input,identity:source,now,trigger,state}){
 const policy=reportingRefreshPolicy(input),identity=reportingRefreshIdentity(source),clock=instant(now,'now')
 if(!['manual','scheduled'].includes(trigger))throw new TypeError('Explicit manual or scheduled trigger required')
 closed(state,['current_authorized','resource_verified','adapter_verified','context_checksum','binding_revision_number','disabled','history_start_date','last_success_at','last_manual_request_at','last_failure_at','failure_count','retry_after','requests_in_rolling_day','pending_key'])
 for(const k of ['current_authorized','resource_verified','adapter_verified','disabled'])if(typeof state[k]!=='boolean')throw new TypeError('Explicit current server state required')
 for(const k of ['failure_count','requests_in_rolling_day'])if(!Number.isSafeInteger(state[k])||state[k]<0)throw new TypeError('Exact server counters required')
 const denied=(reason,until=null)=>Object.freeze({state:reason,not_before:until===null?null:new Date(until).toISOString(),plan:null,dispatch_authorized:false})
 if(state.disabled||!state.current_authorized)return denied('current_authority_unavailable')
 if(state.context_checksum!==source.context_checksum||state.binding_revision_number!==source.binding_revision_number)return denied('binding_changed')
 if(!state.resource_verified||!state.adapter_verified)return denied('resource_or_adapter_verification_required')
 const historyStart=date(state.history_start_date),start=date(source.period_start),end=date(source.period_end)
 // The server supplies the current date in the resource timezone; this module never guesses it.
 if(identity.days>policy.max_period_days||start<historyStart||end>=historyStart+policy.history_days*DAY)return denied('period_outside_configured_window')
 if(state.pending_key!==null){text(state.pending_key,'pending_key',16384);return denied(state.pending_key===identity.key?'already_pending':'resource_busy')}
 if(state.requests_in_rolling_day>=policy.daily_request_limit)return denied('rolling_day_quota_exhausted')
 const stamps={};for(const k of ['last_success_at','last_manual_request_at','last_failure_at','retry_after']){stamps[k]=state[k]===null?null:instant(state[k],k);if(k!=='retry_after'&&stamps[k]!==null&&stamps[k]>clock)throw new TypeError('Server history cannot be in the future')}
 if((state.failure_count===0)!==(stamps.last_failure_at===null))throw new TypeError('Failure count and original failure timestamp must agree')
 let next=0
 if(stamps.retry_after!==null)next=Math.max(next,stamps.retry_after)
 if(state.failure_count>0){const exponent=Math.min(state.failure_count-1,53);const delay=Math.min(policy.max_backoff_seconds,policy.backoff_seconds*2**exponent);next=Math.max(next,stamps.last_failure_at+delay*1000)}
 if(next>clock)return denied('backoff',next)
 if(trigger==='manual'&&stamps.last_manual_request_at!==null&&stamps.last_manual_request_at+policy.manual_min_interval_seconds*1000>clock)return denied('manual_cooldown',stamps.last_manual_request_at+policy.manual_min_interval_seconds*1000)
 if(trigger==='scheduled'&&stamps.last_success_at!==null&&stamps.last_success_at+policy.cadence_seconds*1000>clock)return denied('not_due',stamps.last_success_at+policy.cadence_seconds*1000)
 return Object.freeze({state:'ready_for_atomic_server_claim',not_before:now,plan:Object.freeze({identity:identity.identity,dedupe_key:identity.key,max_observations:policy.max_observations,lease_seconds:policy.lease_seconds}),dispatch_authorized:false})
}
export function reportingRefreshFailure({policy:input,now,consecutive_failures,retry_after=null,reason}){
 const policy=reportingRefreshPolicy(input),clock=instant(now,'now');integer(consecutive_failures,'consecutive_failures')
 if(!['rate_limited','temporary_failure','permission_denied','disconnected','uncertain'].includes(reason))throw new TypeError('Explicit failure category required')
 if(['permission_denied','disconnected','uncertain'].includes(reason))return Object.freeze({state:reason,next_retry_at:null,automatic_retry:false})
 const wait=Math.min(policy.max_backoff_seconds,policy.backoff_seconds*2**Math.min(consecutive_failures-1,53))*1000
 const provider=retry_after===null?clock:instant(retry_after,'retry_after')
 return Object.freeze({state:reason,next_retry_at:new Date(Math.max(clock+wait,provider)).toISOString(),automatic_retry:true})
}
