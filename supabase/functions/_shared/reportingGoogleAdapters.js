import {ReportingProviderFailure} from './reportingRefreshWorker.js'
const SCOPE={google_analytics:'https://www.googleapis.com/auth/analytics.readonly',google_search_console:'https://www.googleapis.com/auth/webmasters.readonly'}
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const HASH=/^[a-f0-9]{64}$/
const metric=(metric_key,metric_label,unit,aggregation)=>Object.freeze({metric_key,metric_label,unit,aggregation})
export const GOOGLE_REPORTING_CONTRACTS=Object.freeze([
 Object.freeze({sourceContract:'anka.ga4.page-day.bounded.v1',provider:'google_analytics',resourceKind:'ga4_property',metricDefinitions:Object.freeze([metric('screenPageViews','GA4 views','count','additive'),metric('sessions','GA4 sessions','count','non_additive'),metric('totalUsers','GA4 total users','count','non_additive')])}),
 Object.freeze({sourceContract:'anka.gsc.page-query-day.web.final.bounded.v1',provider:'google_search_console',resourceKind:'gsc_site',metricDefinitions:Object.freeze([metric('clicks','GSC clicks','count','additive'),metric('impressions','GSC impressions','count','additive'),metric('ctr','GSC click-through rate','ratio','non_additive'),metric('position','GSC average position','position','non_additive')])}),
])
export async function reportingSha256(value){const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value));return [...new Uint8Array(digest)].map(x=>x.toString(16).padStart(2,'0')).join('')}
function resource(context,contract){
 if(!context||context.provider!==contract.provider||context.resource_kind!==contract.resourceKind||!UUID.test(context.connection_id)||!UUID.test(context.organization_id)||!HASH.test(context.context_checksum))throw new TypeError('Exact claimed Google resource required')
 const key=context.resource_key
 if(contract.provider==='google_analytics'){if(typeof key!=='string'||!/^\d{4,20}$/.test(key))throw new TypeError('Exact GA4 property required')}
 else if(typeof key!=='string'||key.length>500||/[\u0000-\u001f\u007f]/.test(key))throw new TypeError('Exact Search Console property required')
 else if(key.startsWith('sc-domain:')){if(!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(key.slice(10)))throw new TypeError('Exact domain property required')}
 else{const parsed=new URL(key);if(!['https:','http:'].includes(parsed.protocol)||parsed.username||parsed.password||parsed.hash||parsed.toString()!==key)throw new TypeError('Exact URL-prefix property required')}
 return key
}
// Read only the exact currently pinned observed credential; no refresh, secret writes
// or hidden OAuth call. Rotation/expiry requires the normal existing connector review.
export function createReportingGoogleTokenReader({admin,decrypt,encryptionMaterial,now=()=>Date.now()}){
 return async(context,signal)=>{
  if(signal?.aborted)throw new Error('Original request aborted')
  const contract=GOOGLE_REPORTING_CONTRACTS.find(x=>x.provider===context?.provider);if(!contract)throw new ReportingProviderFailure('disconnected');resource(context,contract)
  const material=encryptionMaterial();if(typeof material!=='string'||material.length<32)throw new ReportingProviderFailure('disconnected')
  const {data:c,error}=await admin().from('integration_oauth_credentials').select('connection_id,organization_id,provider,updated_at,access_token_expires_at,granted_scopes,access_token_ciphertext,access_token_iv').eq('connection_id',context.connection_id).eq('organization_id',context.organization_id).eq('provider',context.provider).maybeSingle()
  // Compare exact database timestamp strings at microsecond precision, not rounded JS milliseconds.
  const stamp=value=>typeof value==='string'?value.replace('Z','+00:00').replace(/\.([0-9]{1,6})(?=\+)/,(_,fraction)=>'.'+fraction.padEnd(6,'0')).replace(/:(\d{2})(?=\+)/,':$1.000000'):null
  if(error||!c||c.connection_id!==context.connection_id||c.organization_id!==context.organization_id||c.provider!==context.provider||!stamp(c.updated_at)||stamp(c.updated_at)!==stamp(context.credential_revision)||!Number.isFinite(Date.parse(c.access_token_expires_at))||Date.parse(c.access_token_expires_at)<=now()||!Array.isArray(c.granted_scopes)||!c.granted_scopes.includes(SCOPE[context.provider]))throw new ReportingProviderFailure('disconnected')
  let token;try{token=await decrypt(c.access_token_ciphertext,c.access_token_iv,material)}catch{throw new ReportingProviderFailure('disconnected')}
  if(signal?.aborted||typeof token!=='string'||!token||token.length>16384||/[\s\u0000-\u001f\u007f]/.test(token))throw new ReportingProviderFailure('disconnected')
  return token
 }
}
async function readJson(response){
 if(!response.body)throw new Error('Provider body missing')
 const reader=response.body.getReader(),chunks=[];let size=0
 try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>262144)throw new Error('Provider response exceeds bounded envelope');chunks.push(value)}}finally{await reader.cancel().catch(()=>{});reader.releaseLock()}
 const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength}
 const raw=new TextDecoder('utf-8',{fatal:true}).decode(bytes),data=JSON.parse(raw)
 if(!data||typeof data!=='object'||Array.isArray(data))throw new Error('Exact provider response object required')
 return {data,sha:await reportingSha256(raw)}
}
function numeric(raw,integer=false){
 if(raw===null||raw===undefined)return null
 if(typeof raw!=='number'&&!(typeof raw==='string'&&/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(raw)))throw new TypeError('Exact original numeric value required')
 const value=Number(raw);if(!Number.isFinite(value)||value<0||value>Number.MAX_SAFE_INTEGER||(integer&&!Number.isSafeInteger(value)))throw new TypeError('Bounded original numeric value required');return value
}
const safeText=value=>{if(typeof value!=='string'||value.length>2048||/[\u0000-\u001f\u007f]/.test(value))throw new TypeError('Exact bounded dimension required');return value}
const date=value=>{if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value)||!Number.isFinite(Date.parse(value+'T00:00:00Z'))||new Date(value+'T00:00:00Z').toISOString().slice(0,10)!==value)throw new TypeError('Exact source date required');return value}
function ga4Shape(data,limit){
 if(!Number.isSafeInteger(data.rowCount??0)||(data.rowCount??0)<0||!Array.isArray(data.dimensionHeaders)||data.dimensionHeaders.map(x=>x.name).join('|')!=='date|pageLocation'||!Array.isArray(data.metricHeaders)||data.metricHeaders.map(x=>x.name).join('|')!=='screenPageViews|sessions|totalUsers'||data.metricHeaders.some(x=>x.type!=='TYPE_INTEGER')||typeof data.metadata?.timeZone!=='string'||data.metadata.emptyReason)throw new Error('Exact GA4 report schema required')
 try{new Intl.DateTimeFormat('en',{timeZone:data.metadata.timeZone})}catch{throw new Error('Exact property timezone required')}
 const total=data.rowCount??0,rows=data.rows??[];if(!Array.isArray(rows)||rows.length>limit||rows.length>total||(total>0&&rows.length===0))throw new Error('Consistent bounded GA4 rows required')
 return rows
}
export function createGoogleReportingAdapters({getToken,manifests,fetcher=fetch,now=()=>Date.now()}){
 if(typeof getToken!=='function')throw new TypeError('Exact server credential reader required')
 return GOOGLE_REPORTING_CONTRACTS.map(contract=>{
  const manifestSha256=manifests?.[contract.sourceContract];if(!HASH.test(manifestSha256))throw new TypeError('Reviewed exact adapter manifest required')
  async function call(context,signal,{url,body},verification=false){
   resource(context,contract);if(signal?.aborted)throw new Error('Original request aborted')
   const token=await getToken(context,signal);if(signal?.aborted)throw new Error('Original request aborted')
   const response=await fetcher(url,{method:body?'POST':'GET',headers:{Authorization:`Bearer ${token}`,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{}),redirect:'error',signal})
   if(!response.ok){await response.body?.cancel().catch(()=>{});if(verification&&[401,403,404].includes(response.status))return {negative:true,sha:await reportingSha256(JSON.stringify({url,status:response.status,observed_at:new Date(now()).toISOString()}))};if(response.status===401||response.status===403)throw new ReportingProviderFailure('permission_denied');if(response.status===404)throw new ReportingProviderFailure('disconnected');if(response.status===429||response.status>=500){const raw=response.headers.get('retry-after');let retry=null;if(raw){const delay=/^\d+$/.test(raw)?now()+Number(raw)*1000:Date.parse(raw);if(Number.isFinite(delay)&&delay>=now()&&delay<=now()+366*86400000)retry=new Date(delay).toISOString()}throw new ReportingProviderFailure(response.status===429?'rate_limited':'temporary_failure',retry)}throw new Error('Provider read rejected')}
   return readJson(response)
  }
  const gaBody=(startDate,endDate,limit)=>({dimensions:[{name:'date'},{name:'pageLocation'}],metrics:contract.metricDefinitions.map(x=>({name:x.metric_key})),dateRanges:[{startDate,endDate}],offset:'0',limit:String(limit),orderBys:[{dimension:{dimensionName:'date'}},{dimension:{dimensionName:'pageLocation'}}],keepEmptyRows:true})
  const base=context=>contract.provider==='google_analytics'?`https://analyticsdata.googleapis.com/v1beta/properties/${resource(context,contract)}:runReport`:`https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(resource(context,contract))}`
  return Object.freeze({...contract,manifestSha256,
   async verifyResource({context,signal}){
    const response=await call(context,signal,{url:base(context),...(contract.provider==='google_analytics'?{body:gaBody('today','today',1)}:{})},true)
    if(response.negative)return {observed_at:new Date(now()).toISOString(),resource_matches:false,observed_reporting_grant:false,source_evidence_sha256:response.sha}
    let matches,granted
    if(contract.provider==='google_analytics'){ga4Shape(response.data,1);matches=true;granted=true}
    else{matches=response.data.siteUrl===context.resource_key;granted=['siteOwner','siteFullUser','siteRestrictedUser'].includes(response.data.permissionLevel);if(typeof response.data.siteUrl!=='string'||!['siteOwner','siteFullUser','siteRestrictedUser','siteUnverifiedUser'].includes(response.data.permissionLevel))throw new Error('Observed exact site permission required')}
    return {observed_at:new Date(now()).toISOString(),resource_matches:matches,observed_reporting_grant:granted,source_evidence_sha256:response.sha}
   },
   async fetchPage({identity,context,limits,cursor,signal}){
    if(cursor!==null||identity.source_contract!==contract.sourceContract||identity.resource_key!==resource(context,contract)||identity.context_checksum!==context.context_checksum||identity.organization_id!==context.organization_id||identity.project_id!==context.project_id||identity.binding_id!==context.binding_id||identity.binding_revision_number!==context.binding_revision_number)throw new TypeError('Original bounded snapshot identity required')
    const start=date(identity.period_start),end=date(identity.period_end),limit=Math.floor(limits.max_observations/contract.metricDefinitions.length)
    if(end<start||!Number.isSafeInteger(limit)||limit<1||limit>1000)throw new TypeError('Policy must allow one full original metric row')
    const ga=contract.provider==='google_analytics'
    if(!ga&&identity.reporting_time_zone!=='America/Los_Angeles')throw new TypeError('Search Console uses its original Pacific reporting timezone')
    const body=ga?gaBody(start,end,limit):{startDate:start,endDate:end,dimensions:['date','page','query'],type:'web',aggregationType:'auto',dataState:'final',rowLimit:limit,startRow:0}
    const response=await call(context,signal,{url:base(context)+(ga?'':'/searchAnalytics/query'),body})
    const rows=ga?ga4Shape(response.data,limit):(response.data.rows??[])
    if(!Array.isArray(rows)||rows.length>limit||(!ga&&response.data.responseAggregationType!==undefined&&response.data.responseAggregationType!=='byPage'))throw new Error('Exact source aggregation required')
    if(ga&&response.data.metadata.timeZone!==identity.reporting_time_zone)throw new Error('Original GA4 property timezone changed')
    const retrieved_at=new Date(now()).toISOString(),observations=[]
    for(const row of rows){
     let dimensions,values,completeness
     if(ga){
      if(!Array.isArray(row.dimensionValues)||row.dimensionValues.length!==2||!Array.isArray(row.metricValues)||row.metricValues.length!==3)throw new Error('Exact GA4 row required')
      const rawDate=safeText(row.dimensionValues[0].value);if(!/^\d{8}$/.test(rawDate))throw new TypeError('Exact GA4 date required')
      const sourceDate=date(rawDate.slice(0,4)+'-'+rawDate.slice(4,6)+'-'+rawDate.slice(6));if(sourceDate<start||sourceDate>end)throw new Error('Date outside original report')
      const metadata=response.data.metadata
      const partial=response.data.rowCount>rows.length||metadata.subjectToThresholding===true||metadata.dataLossFromOtherRow===true||(metadata.samplingMetadatas?.length??0)>0||(metadata.dataTruncationReasons?.length??0)>0
      dimensions={date:sourceDate,pageLocation:safeText(row.dimensionValues[1].value),coverage:partial?'bounded_or_provider_partial':'freshness_unknown'};completeness=partial?'partial':'unknown'
      const restrictions=metadata.schemaRestrictionResponse?.activeMetricRestrictions??[];if(!Array.isArray(restrictions))throw new Error('Exact GA4 restrictions required')
      values=row.metricValues.map((v,i)=>restrictions.some(x=>x.metricName===contract.metricDefinitions[i].metric_key)?null:numeric(v.value,true))
     }else{
      if(!Array.isArray(row.keys)||row.keys.length!==3)throw new Error('Exact Search Console dimensions required')
      const sourceDate=date(row.keys[0]);if(sourceDate<start||sourceDate>end)throw new Error('Date outside original report')
      dimensions={date:sourceDate,page:safeText(row.keys[1]),query:safeText(row.keys[2]),search_type:'web',data_state:'final',aggregation:'byPage',coverage:'provider_top_rows'};completeness='partial'
      values=contract.metricDefinitions.map((m,i)=>numeric(row[m.metric_key],i<2));if(values[2]!==null&&values[2]>1)throw new Error('Original CTR ratio required')
     }
     const recordSha=await reportingSha256(JSON.stringify({row,response_sha256:response.sha})),sourceId=await reportingSha256(JSON.stringify({source:contract.sourceContract,resource:identity.resource_key,period:[start,end],context:identity.context_checksum,retrieved_at,recordSha}))
     for(let i=0;i<values.length;i++)observations.push({source_observation_id:sourceId,source_record_sha256:recordSha,metric_key:contract.metricDefinitions[i].metric_key,metric_value:values[i],value_state:values[i]===null?'unknown':'available',dimensions,data_through:null,completeness})
    }
    // One configured bounded snapshot, never an implicit full-history export. Source
    // coverage remains partial/unknown independently of transport completion.
    return {source_contract:contract.sourceContract,resource_key:identity.resource_key,period_start:start,period_end:end,reporting_time_zone:identity.reporting_time_zone,cursor:null,next_cursor:null,complete:true,retrieved_at,observations}
   },
  })
 })
}
