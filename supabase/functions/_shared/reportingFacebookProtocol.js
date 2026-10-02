import {ReportingProviderFailure} from './reportingRefreshWorker.js'
// Source: user-supplied official v26.0 Page Insights and debug_token excerpts.
// Native reservation and one-use ordinal permits precede HTTP. The reviewed
// registry remains disabled until explicit resource activation.
const HOST='https://graph.facebook.com/v26.0/'
const ID=/^[0-9]{4,40}$/
const SCOPES=Object.freeze(['read_insights','pages_read_engagement'])
export const FACEBOOK_PAGE_METRICS=Object.freeze([
 Object.freeze({metric_key:'page_media_view',metric_label:'Facebook content plays or displays',unit:'count',aggregation:'unknown'}),
 Object.freeze({metric_key:'page_total_media_view_unique',metric_label:'Facebook unique media viewers',unit:'count',aggregation:'non_additive'}),
])
const failure=reason=>new ReportingProviderFailure(reason)
const unknown=()=>new Error('Exact Facebook reporting evidence unavailable')
const isId=x=>typeof x==='string'&&ID.test(x)
const targetId=x=>isId(x)?x:Number.isSafeInteger(x)&&x>=1000?String(x):null
const token=x=>typeof x==='string'&&x.length>0&&x.length<=16384&&!/[\s\u0000-\u001f\u007f]/.test(x)
const object=x=>x!==null&&typeof x==='object'&&!Array.isArray(x)
const sha=async value=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(value))))].map(x=>x.toString(16).padStart(2,'0')).join('')
function instant(value){
 if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|\+0000|\+00:00)$/.test(value)||value.startsWith('0000'))throw unknown()
 const n=Date.parse(value);if(!Number.isFinite(n)||new Date(n).toISOString().slice(0,19)!==value.slice(0,19))throw unknown();return n
}
async function body(response){
 if(!response.body)throw unknown()
 const reader=response.body.getReader(),parts=[];let length=0
 try{for(;;){const {done,value}=await reader.read();if(done)break;length+=value.byteLength;if(length>262144)throw unknown();parts.push(value)}}finally{await reader.cancel().catch(()=>{});reader.releaseLock()}
 const bytes=new Uint8Array(length);let offset=0;for(const part of parts){bytes.set(part,offset);offset+=part.byteLength}
 try{const data=JSON.parse(new TextDecoder('utf8',{fatal:true}).decode(bytes));if(!object(data))throw unknown();return data}catch{throw unknown()}
}
// This sanitised projection carries only explicitly reviewed validation fields.
// Neither raw provider bodies nor paging URLs / tokens leave the server boundary.
function tokenEvidence(raw,{appId,pageId,now}){
 const d=raw.data;if(!object(d)||typeof d.is_valid!=='boolean')throw unknown()
 if(!d.is_valid)return {valid:false,proof:{is_valid:false}}
 if(!isId(d.app_id)||!isId(d.profile_id)||!isId(d.user_id)||!Number.isSafeInteger(d.issued_at)||d.issued_at<=0||d.issued_at*1000>now||!Number.isSafeInteger(d.expires_at)||d.expires_at<=0||!Number.isSafeInteger(d.data_access_expires_at)||d.data_access_expires_at<=0||!Array.isArray(d.scopes)||d.scopes.length>100||d.scopes.some(x=>typeof x!=='string'||!/^[a-z_]{1,100}$/.test(x))||new Set(d.scopes).size!==d.scopes.length||!Array.isArray(d.granular_scopes)||d.granular_scopes.length>100)throw unknown()
 const granular=new Map()
 for(const g of d.granular_scopes){
  if(!object(g)||typeof g.scope!=='string'||!/^[a-z_]{1,100}$/.test(g.scope)||granular.has(g.scope))throw unknown()
  // Omitted targets explicitly mean all in the supplied reference. Null, empty,
  // unsafe integer target IDs never establish a resource grant. Documented integer
  // targets are accepted only when their exact decimal value survives JSON parsing.
  if(Object.hasOwn(g,'target_ids')&&(!Array.isArray(g.target_ids)||g.target_ids.length>1000||g.target_ids.some(x=>targetId(x)===null)))throw unknown()
  granular.set(g.scope,Object.hasOwn(g,'target_ids')?g.target_ids.map(targetId):null)
 }
 const proof={is_valid:d.is_valid,app_id:d.app_id,profile_id:d.profile_id,user_id:d.user_id,issued_at:d.issued_at,expires_at:d.expires_at,data_access_expires_at:d.data_access_expires_at,scopes:[...d.scopes],granular_scopes:[...granular].map(([scope,target_ids])=>({scope,target_ids}))}
 const valid=d.app_id===appId&&d.profile_id===pageId&&d.expires_at*1000>now&&d.data_access_expires_at*1000>now&&SCOPES.every(s=>d.scopes.includes(s)&&granular.has(s)&&(granular.get(s)===null||granular.get(s).includes(pageId)))
 return {valid,proof}
}
function pageEvidence(raw,pageId,{maxValues,since=null,until=null}={}){
 if(!Array.isArray(raw.data)||raw.data.length>FACEBOOK_PAGE_METRICS.length||raw.paging!==undefined&&!object(raw.paging))throw unknown()
 if(raw.paging?.next!==undefined&&(typeof raw.paging.next!=='string'||raw.paging.next.length===0))throw unknown()
 const seen=new Set(),rows=[]
 for(const metric of raw.data){
  if(!object(metric)||!FACEBOOK_PAGE_METRICS.some(x=>x.metric_key===metric.name)||seen.has(metric.name)||metric.period!=='day'||metric.id!==`${pageId}/insights/${metric.name}/day`||!Array.isArray(metric.values))throw unknown()
  seen.add(metric.name);const ends=new Set()
  for(const value of metric.values){
   if(!object(value)||typeof value.value!=='number'||!Number.isSafeInteger(value.value)||value.value<0)throw unknown()
   const end=instant(value.end_time);if(ends.has(end)||rows.length>=maxValues)throw unknown();ends.add(end)
   // The provider's bucket timezone and until inclusivity are unestablished.
   // Retain original end_time rather than invent a bucket start or date label.
   // Only a conservative transport envelope is checked, not calendar-day inclusion.
   if(since!==null&&(end<since-86400000||end>until+2*86400000))throw unknown()
   rows.push({metric_key:metric.name,metric_value:value.value,value_state:'available',provider_period:'day',provider_end_time:value.end_time,provider_bucket_time_zone:null,bucket_start:null})
  }
 }
 return {rows,missing_metrics:FACEBOOK_PAGE_METRICS.filter(x=>!rows.some(r=>r.metric_key===x.metric_key)).map(x=>x.metric_key),has_next:typeof raw.paging?.next==='string'&&raw.paging.next.length>0}
}
export function createFacebookPageReportingProtocol({getCredential,getVerifierCredential,getRequestAudit,fetcher=fetch,now=()=>Date.now()}){
 if(typeof getCredential!=='function'||typeof getVerifierCredential!=='function'||typeof getRequestAudit!=='function'||typeof fetcher!=='function')throw new TypeError('Exact server credential readers required')
 async function operation({context,signal,window=null,maxValues=1000}){
  if(signal?.aborted)throw unknown()
  if(context?.provider!=='meta'||context.resource_kind!=='meta_facebook_page'||!isId(context.resource_key)||!Number.isSafeInteger(maxValues)||maxValues<1||maxValues>1000)throw unknown()
  let since=null,until=null;const oldest=new Date(now());oldest.setUTCFullYear(oldest.getUTCFullYear()-2)
  if(window!==null){if(!object(window)||Object.keys(window).sort().join(',')!=='since,until')throw unknown();since=instant(window.since);until=instant(window.until);if(until<=since||until-since>90*86400000||since<oldest.getTime()||until>now())throw unknown()}
  let credentials,verifier
  try{credentials=await getCredential(context,signal);verifier=await getVerifierCredential()}catch{throw failure('disconnected')}
  if(!object(credentials)||credentials.facebookPageId!==context.resource_key||!token(credentials.token)||!object(verifier)||!isId(verifier.appId)||!token(verifier.token)||credentials.token===verifier.token)throw failure('disconnected')
  const checkLocal=()=>{if(signal?.aborted)throw unknown();const expires=Date.parse(credentials.expiresAt);if(!Number.isFinite(expires)||expires<=now())throw failure('disconnected')}
  checkLocal();let requests=0,pending=null,attempted=false,recordAttempted=false
  const audit=getRequestAudit(context)
  if(typeof audit?.claim!=='function'||typeof audit?.record!=='function')throw unknown()
  const record=async(outcome,evidence,validUntil=null)=>{recordAttempted=true;await audit.record(pending,outcome,evidence,validUntil)}
  async function read(path,accessToken,params){
   checkLocal();if(++requests>2)throw unknown()
   pending=await audit.claim(requests);attempted=false;recordAttempted=false;checkLocal()
   const url=new URL(HOST+path);for(const [k,v]of Object.entries(params))url.searchParams.set(k,v)
   let response,raw
   // Suppress transport exceptions, which can contain the debug input-token URL.
   try{attempted=true;response=await fetcher(url.toString(),{method:'GET',headers:{Authorization:`Bearer ${accessToken}`},signal,redirect:'error',cache:'no-store'});raw=await body(response)}catch{throw unknown()}
   checkLocal()
   if(raw.error!==undefined||!response.ok){
    const code=raw.error?.code
    if(code===190||code===104)throw failure('disconnected')
    if(code===200)throw failure('permission_denied')
    if(code===80001||response.status===429){
     const header=response.headers.get('retry-after');let retry=null
     if(header&&/^\d{1,8}$/.test(header)){const seconds=Number(header);if(seconds<=366*86400)retry=new Date(now()+seconds*1000).toISOString()}
     throw new ReportingProviderFailure('rate_limited',retry)
    }
    if(response.status>=500)throw failure('temporary_failure')
    throw unknown()
   }
   return raw
  }
  try{
   const debug=await read('debug_token',verifier.token,{input_token:credentials.token}),observed=tokenEvidence(debug,{appId:verifier.appId,pageId:context.resource_key,now:now()})
   const tokenSha=await sha({version:'v26.0',token:observed.proof})
   if(!observed.valid){await record('denied',tokenSha);return {observed_at:new Date(now()).toISOString(),resource_matches:false,observed_reporting_grant:false,source_evidence_sha256:tokenSha,request_count:requests,rows:[],missing_metrics:FACEBOOK_PAGE_METRICS.map(x=>x.metric_key),coverage:'unavailable'}}
   await record('validated',tokenSha,new Date(Math.min(observed.proof.expires_at*1000,observed.proof.data_access_expires_at*1000,Date.parse(credentials.expiresAt))).toISOString())
   const params={metric:FACEBOOK_PAGE_METRICS.map(x=>x.metric_key).join(','),period:'day',...(window?{since:String(since/1000),until:String(until/1000)}:{date_preset:'yesterday'})}
   let page
   try{page=pageEvidence(await read(context.resource_key+'/insights',credentials.token,params),context.resource_key,{maxValues,since,until})}catch(error){
    if(error instanceof ReportingProviderFailure&&['disconnected','permission_denied'].includes(error.reason)&&pending?.ordinal===2&&attempted&&!recordAttempted){const evidence=await sha({version:'v26.0',token:observed.proof,denial:error.reason});await record('denied',evidence);return {observed_at:new Date(now()).toISOString(),resource_matches:false,observed_reporting_grant:false,source_evidence_sha256:evidence,request_count:requests,rows:[],missing_metrics:FACEBOOK_PAGE_METRICS.map(x=>x.metric_key),coverage:'unavailable'}}
    throw error
   }
   if(observed.proof.expires_at*1000<=now()||observed.proof.data_access_expires_at*1000<=now())throw failure('disconnected')
   const evidence=await sha({version:'v26.0',token:observed.proof,window,params,page})
   await record('validated',evidence)
   return {observed_at:new Date(now()).toISOString(),resource_matches:true,observed_reporting_grant:true,source_evidence_sha256:evidence,request_count:requests,...page,coverage:page.has_next?'partial':'unknown',data_through:null,requested_window:window,provider_bucket_time_zone:null}
  }catch(error){
   if(pending&&attempted&&!recordAttempted){const outcome=error instanceof ReportingProviderFailure?'failed':'uncertain';await record(outcome,await sha({ordinal:pending.ordinal,outcome,reason:error instanceof ReportingProviderFailure?error.reason:'unobserved'}))}
   throw error
  }
 }
 return Object.freeze({apiVersion:'v26.0',maxRequestsPerDispatch:2,metricDefinitions:FACEBOOK_PAGE_METRICS,
  readPageInsights:operation,
  async verifyResource(input){const result=await operation(input);return Object.fromEntries(['observed_at','resource_matches','observed_reporting_grant','source_evidence_sha256'].map(k=>[k,result[k]]))},
 })
}
