import {createFacebookPageReportingProtocol,FACEBOOK_PAGE_METRICS} from './reportingFacebookProtocol.js'
import {reportingRefreshIdentity} from './reportingRefreshPolicy.js'
import {ReportingProviderFailure} from './reportingRefreshWorker.js'
export const FACEBOOK_REPORTING_CONTRACT=Object.freeze({sourceContract:'anka.meta.facebook-page.media-view.native-day.bounded.v26.v1',provider:'meta',resourceKind:'meta_facebook_page',metricDefinitions:FACEBOOK_PAGE_METRICS})
const sha=async value=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(value))))].map(x=>x.toString(16).padStart(2,'0')).join('')
// Policy timezone defines only the explicit request window. Provider daily bucket
// timezone remains unknown; end_time is retained verbatim and never relabelled a date.
function midnight(date,zone){
 const expected=Date.parse(date+'T00:00:00Z'),format=new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'});let guess=expected
 for(let i=0;i<4;i++){const p=Object.fromEntries(format.formatToParts(guess).map(x=>[x.type,x.value])),actual=Date.parse(`${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}Z`);if(actual===expected)return new Date(guess).toISOString();guess+=expected-actual}
 throw new TypeError('An exact representable request-window midnight is required')
}
export function createFacebookReportingAdapter({getCredential,getVerifierCredential,getRequestAudit,fetcher=fetch,now=()=>Date.now(),manifestSha256}){
 if(!/^[a-f0-9]{64}$/.test(manifestSha256||''))throw new TypeError('Reviewed Facebook source manifest required')
 const contract=FACEBOOK_REPORTING_CONTRACT,protocol=createFacebookPageReportingProtocol({getCredential,getVerifierCredential,getRequestAudit,fetcher,now})
 return Object.freeze({...contract,manifestSha256,maxRequestsPerDispatch:2,
  verifyResource:protocol.verifyResource,
  async fetchPage({identity:raw,context,limits,cursor,signal}){
   const {identity,days}=reportingRefreshIdentity(raw)
   if(cursor!==null||days>90||identity.provider!==contract.provider||identity.resource_kind!==contract.resourceKind||identity.source_contract!==contract.sourceContract||!Number.isSafeInteger(limits?.max_observations)||limits.max_observations<1||limits.max_observations>1000)throw new TypeError('Exact bounded Facebook snapshot required')
   for(const k of ['organization_id','project_id','binding_id','binding_revision_number','context_checksum','resource_key'])if(identity[k]!==context?.[k])throw new TypeError('Original Facebook claim identity changed')
   const nextDate=new Date(Date.parse(identity.period_end+'T00:00:00Z')+86400000).toISOString().slice(0,10)
   const since=midnight(identity.period_start,identity.reporting_time_zone),end=Date.parse(midnight(nextDate,identity.reporting_time_zone)),until=new Date(Math.min(end,now())).toISOString()
   const result=await protocol.readPageInsights({context,signal,window:{since,until},maxValues:limits.max_observations})
   if(!result.resource_matches||!result.observed_reporting_grant)throw new ReportingProviderFailure('permission_denied')
   const values=[...result.rows,...result.missing_metrics.map(metric_key=>({metric_key,metric_value:null,value_state:'unknown',provider_period:'day',provider_end_time:null,provider_bucket_time_zone:null,bucket_start:null}))]
   if(values.length>limits.max_observations)throw new TypeError('Missing-metric evidence exceeds original row bound')
   const observations=[]
   for(const value of values){
    const dimensions={provider_period:value.provider_period,provider_end_time:value.provider_end_time,provider_bucket_time_zone:null,bucket_start:null,request_since:since,request_until:until,request_time_zone:identity.reporting_time_zone,until_inclusivity:'unknown',coverage:value.value_state==='unknown'?'metric_not_returned':result.coverage==='partial'?'bounded_partial':'freshness_unknown',api_version:'v26.0'}
    const source_record_sha256=await sha({value,dimensions,provider_evidence:result.source_evidence_sha256}),source_observation_id=await sha({source:contract.sourceContract,resource:identity.resource_key,context:identity.context_checksum,record:source_record_sha256,observed_at:result.observed_at})
    observations.push({source_observation_id,source_record_sha256,metric_key:value.metric_key,metric_value:value.metric_value,value_state:value.value_state,dimensions,data_through:null,completeness:result.coverage==='partial'?'partial':'unknown'})
   }
   return {source_contract:contract.sourceContract,resource_key:identity.resource_key,period_start:identity.period_start,period_end:identity.period_end,reporting_time_zone:identity.reporting_time_zone,cursor:null,next_cursor:null,complete:true,retrieved_at:result.observed_at,observations}
  },
 })
}
