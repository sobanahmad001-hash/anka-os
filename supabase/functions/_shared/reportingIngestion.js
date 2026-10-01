import {reportingRefreshIdentity,reportingRefreshPolicy} from './reportingRefreshPolicy.js'
// Validate a bounded adapter page before an atomic, currently-authorized server commit.
// This is neither a provider-capability registry nor permission to insert observations.
const text=(v,k,max)=>{if(typeof v!=='string'||!v.trim()||v.length>max||/[\u0000-\u001f\u007f]/.test(v))throw new TypeError(`${k} must be explicit bounded text`);return v}
const closed=(v,keys)=>{if(!v||typeof v!=='object'||Array.isArray(v)||Object.keys(v).some(k=>!keys.includes(k))||keys.some(k=>!Object.hasOwn(v,k)))throw new TypeError('Exact adapter contract required')}
const stable=v=>JSON.stringify(Object.keys(v).sort().map(k=>[k,v[k]]))
export function validateReportingIngestionPage({identity:rawIdentity,policy:rawPolicy,metricDefinitions,page}){
 const {identity}=reportingRefreshIdentity(rawIdentity),policy=reportingRefreshPolicy(rawPolicy)
 if(!Array.isArray(metricDefinitions)||!metricDefinitions.length||metricDefinitions.length>100)throw new TypeError('Explicit bounded adapter metric definitions required')
 const definitions=new Map()
 for(const metric of metricDefinitions){closed(metric,['metric_key','metric_label','unit','aggregation']);for(const k of ['metric_key','metric_label','unit'])text(metric[k],k,k==='unit'?80:240);if(!['additive','non_additive','unknown'].includes(metric.aggregation)||definitions.has(metric.metric_key))throw new TypeError('Distinct exact adapter semantics required');definitions.set(metric.metric_key,metric)}
 closed(page,['source_contract','resource_key','period_start','period_end','reporting_time_zone','cursor','next_cursor','complete','retrieved_at','observations'])
 for(const k of ['source_contract','resource_key','period_start','period_end','reporting_time_zone'])if(page[k]!==identity[k])throw new TypeError('Adapter page does not match the pinned request')
 if(typeof page.complete!=='boolean'||!Array.isArray(page.observations)||page.observations.length>policy.max_observations)throw new TypeError('Bounded rows and explicit completeness required')
 for(const k of ['cursor','next_cursor'])if(page[k]!==null)text(page[k],k,4096)
 if(page.complete!==(page.next_cursor===null)||page.next_cursor!==null&&page.next_cursor===page.cursor)throw new TypeError('Pagination must advance and preserve explicit completion')
 const stamp=(v,k)=>{if(typeof v!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(v)||!Number.isFinite(Date.parse(v))||new Date(Date.parse(v)).toISOString().slice(0,19)!==v.slice(0,19)||v.startsWith('0000'))throw new TypeError(`${k} requires an exact UTC instant`);return Date.parse(v)}
 const retrieved=stamp(page.retrieved_at,'retrieved_at'),seen=new Map(),observations=[]
 for(const row of page.observations){
  closed(row,['source_observation_id','source_record_sha256','metric_key','metric_value','value_state','dimensions','data_through','completeness'])
  text(row.source_observation_id,'source_observation_id',240)
  if(!/^[a-f0-9]{64}$/.test(row.source_record_sha256||'')||!definitions.has(row.metric_key)||!['available','unknown'].includes(row.value_state)||!['complete','partial','unknown'].includes(row.completeness))throw new TypeError('Exact source fingerprint and known metric semantics required')
  if(row.value_state==='unknown'?row.metric_value!==null:typeof row.metric_value!=='number'||!Number.isFinite(row.metric_value)||(Number.isInteger(row.metric_value)&&!Number.isSafeInteger(row.metric_value)))throw new TypeError('Do not coerce missing/invalid provider values to zero')
  if(row.data_through!==null&&stamp(row.data_through,'data_through')>retrieved)throw new TypeError('Data-through cannot be later than original retrieval')
  const dims=row.dimensions
  if(!dims||typeof dims!=='object'||Array.isArray(dims))throw new TypeError('Explicit dimension object required')
  for(const [k,v] of Object.entries(dims)){text(k,'dimension key',240);if(v!==null&&typeof v!=='string'&&typeof v!=='boolean'&&!(typeof v==='number'&&Number.isFinite(v)&&(!Number.isInteger(v)||Number.isSafeInteger(v))))throw new TypeError('Only explicit scalar dimensions are supported');if(typeof v==='string'&&(v.length>2048||/[\u0000-\u001f\u007f]/.test(v)))throw new TypeError('Bounded original dimension text required')}
  if(new TextEncoder().encode(JSON.stringify(dims)).length>4096)throw new TypeError('Dimension envelope too large')
  const key=JSON.stringify([row.source_observation_id,row.metric_key,stable(dims)]),signature=stable({...row,dimensions:stable(dims)})
  if(seen.has(key)){if(seen.get(key)!==signature)throw new TypeError('Conflicting duplicate provider observation');continue}seen.set(key,signature)
  observations.push(Object.freeze({...row,...definitions.get(row.metric_key),dimensions:Object.freeze({...dims})}))
 }
 return Object.freeze({identity,observations:Object.freeze(observations),retrieved_at:page.retrieved_at,cursor:page.cursor,next_cursor:page.next_cursor,complete:page.complete,result_state:page.complete&&observations.length===0?'successful_empty':page.complete?'complete':'partial',duplicate_count:page.observations.length-observations.length,ingestion_authorized:false})
}
