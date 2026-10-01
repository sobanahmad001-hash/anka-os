// Stored-only presentation contract. Current native resource authorization is
// mandatory; source acceptance, provider capability and refresh are never inferred.
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const id=(v,label)=>{if(typeof v!=='string'||!UUID.test(v))throw new TypeError(`${label} must be an exact UUID`);return v}
const text=(v,max,label)=>{if(typeof v!=='string'||!v.trim()||v.length>max||/[\u0000-\u001f\u007f]/.test(v))throw new TypeError(`${label} must be explicit and bounded`);return v}
export function reportingPeriod(start,end,timeZone){
 const date=v=>{if(typeof v!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(v))throw new TypeError('Exact calendar date required');const n=Date.parse(`${v}T00:00:00Z`);if(v.startsWith('0000-')||!Number.isFinite(n)||new Date(n).toISOString().slice(0,10)!==v)throw new TypeError('Real calendar date required');return n}
 const a=date(start),b=date(end);if(b<a||(b-a)/86400000>365)throw new TypeError('Choose an ordered reporting period of at most 366 days')
 text(timeZone,120,'Reporting timezone');try{new Intl.DateTimeFormat('en',{timeZone})}catch{throw new TypeError('Choose a recognized reporting timezone')}
 return Object.freeze({period_start:start,period_end:end,reporting_time_zone:timeZone,days:1+(b-a)/86400000})
}
export function storedReportingMetric(row){
 if(!row||typeof row!=='object'||Array.isArray(row))throw new TypeError('Stored metric record required')
 for(const k of ['id','organization_id','project_id','binding_id'])id(row[k],k)
 for(const [k,max] of [['source_contract',240],['source_observation_id',240],['provider',80],['resource_kind',80],['resource_key',2048],['metric_key',240],['metric_label',240],['unit',80]])text(row[k],max,k)
 reportingPeriod(row.period_start,row.period_end,row.reporting_time_zone)
 if(!/^[a-f0-9]{64}$/.test(row.dimensions_sha256||'')||!['complete','partial','unknown'].includes(row.completeness)||!['fresh','stale','unknown'].includes(row.freshness)||!['available','unknown','withheld'].includes(row.value_state)||!['additive','non_additive','unknown'].includes(row.aggregation))throw new TypeError('Explicit source semantics and observation states required')
 if(row.value_state==='available'){if(typeof row.metric_value!=='number'||!Number.isFinite(row.metric_value)||(Number.isInteger(row.metric_value)&&!Number.isSafeInteger(row.metric_value)))throw new TypeError('An available stored metric must be a finite number');if(row.current_authorized!==true||!['verified','synthetic_local_only'].includes(row.source_acceptance))throw new TypeError('Current native authorization and explicit source acceptance required')}
 else if(row.metric_value!==null)throw new TypeError('Unknown or withheld metric must remain null')
 if(row.source_acceptance==='synthetic_local_only'&&row.fixture_only!==true)throw new TypeError('Synthetic observations are local fixtures only')
 for(const k of ['retrieved_at','data_through','last_success_at'])if(row[k]!==null&&(typeof row[k]!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(row[k])||!Number.isFinite(Date.parse(row[k]))))throw new TypeError('Exact observation timestamps or explicit null required')
 if(row.retrieved_at===null)throw new TypeError('Original retrieval timestamp required')
 return Object.freeze({...row})
}
const semanticKey=row=>JSON.stringify([row.provider,row.resource_kind,row.resource_key,row.source_contract,row.metric_key,row.unit,row.dimensions_sha256,row.reporting_time_zone,row.aggregation])
export function compareStoredReportingMetrics(before,after){
 const a=storedReportingMetric(before),b=storedReportingMetric(after)
 const base={before:a,after:b,causal_claim:false,attribution_claim:false}
 if(semanticKey(a)!==semanticKey(b)||a.organization_id!==b.organization_id||a.project_id!==b.project_id)return Object.freeze({...base,comparable:false,reason:'different_source_semantics',absolute_change:null,percent_change:null})
 const ap=reportingPeriod(a.period_start,a.period_end,a.reporting_time_zone),bp=reportingPeriod(b.period_start,b.period_end,b.reporting_time_zone)
 if(ap.days!==bp.days||!(a.period_end<b.period_start))return Object.freeze({...base,comparable:false,reason:'periods_overlap_or_differ_in_length',absolute_change:null,percent_change:null})
 if(a.value_state!=='available'||b.value_state!=='available'||a.completeness!=='complete'||b.completeness!=='complete')return Object.freeze({...base,comparable:false,reason:'incomplete_or_unavailable',absolute_change:null,percent_change:null})
 const change=b.metric_value-a.metric_value;if(!Number.isFinite(change))return Object.freeze({...base,comparable:false,reason:'numeric_range_exceeded',absolute_change:null,percent_change:null})
 const percentage=a.metric_value===0?null:100*change/Math.abs(a.metric_value)
 return Object.freeze({...base,comparable:true,reason:null,absolute_change:change,percent_change:Number.isFinite(percentage)?percentage:null})
}
export function rollupStoredReportingMetrics(rows){
 if(!Array.isArray(rows)||rows.length>50)throw new TypeError('Choose at most 50 explicitly loaded stored observations')
 const result=[],seen=new Map();let duplicateCount=0
 for(const input of rows){const row=storedReportingMetric(input),key=JSON.stringify([row.organization_id,row.project_id,semanticKey(row),row.period_start,row.period_end,row.source_observation_id]);const prior=seen.get(key)
  if(prior){if(prior.metric_value!==row.metric_value||prior.value_state!==row.value_state||prior.completeness!==row.completeness)throw new TypeError('Conflicting copies of the same source observation cannot be rolled up');duplicateCount+=1;continue}seen.set(key,row);result.push(row)
 }
 if(result.length===0)return Object.freeze({value:null,state:'empty',deduplicated:0,duplicate_count:0})
 const first=result[0],resourceIndependent=row=>JSON.stringify([row.provider,row.resource_kind,row.source_contract,row.metric_key,row.unit,row.dimensions_sha256,row.reporting_time_zone,row.aggregation,row.period_start,row.period_end])
 if(result.some(row=>row.organization_id!==first.organization_id||row.project_id!==first.project_id||resourceIndependent(row)!==resourceIndependent(first)))return Object.freeze({value:null,state:'mixed_source_semantics',deduplicated:result.length,duplicate_count:duplicateCount})
 // Overlapping records from one resource never become additional volume.
 if(new Set(result.map(row=>JSON.stringify([row.provider,row.resource_kind,row.resource_key]))).size!==result.length)return Object.freeze({value:null,state:'overlapping_resource_observations',deduplicated:result.length,duplicate_count:duplicateCount})
 if(result.some(row=>row.value_state!=='available'||row.completeness!=='complete'||row.aggregation!=='additive'))return Object.freeze({value:null,state:'partial_or_non_additive',deduplicated:result.length,duplicate_count:duplicateCount})
 const value=result.reduce((sum,row)=>sum+row.metric_value,0)
 return Object.freeze({value:Number.isFinite(value)?value:null,state:Number.isFinite(value)?'available':'numeric_range_exceeded',deduplicated:result.length,duplicate_count:duplicateCount,causal_claim:false,attribution_claim:false})
}
