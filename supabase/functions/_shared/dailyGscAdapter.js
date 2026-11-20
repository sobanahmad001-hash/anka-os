import {ReportingProviderFailure} from './reportingRefreshWorker.js'
import {reportingSha256} from './reportingGoogleAdapters.js'

export const dailyGscContract=Object.freeze({
 sourceContract:'anka.gsc.page-and-query.daily.final.v1',provider:'google_search_console',resourceKind:'gsc_site',
 metricDefinitions:['clicks','impressions','ctr','position'].map(key=>({metric_key:key,metric_label:'GSC '+key,unit:key==='ctr'?'ratio':key==='position'?'position':'count',aggregation:['clicks','impressions'].includes(key)?'additive':'non_additive'}))
})
export function createDailyGscAdapter({getToken,manifestSha256,fetcher=fetch,now=Date.now}){
 if(typeof getToken!=='function'||!/^[a-f0-9]{64}$/.test(manifestSha256))throw Error('Installed adapter identity required')
 async function request(context,path,body,signal){
  const token=await getToken(context,signal)
  if(signal?.aborted)throw Error('Aborted')
  const response=await fetcher('https://www.googleapis.com/webmasters/v3/sites/'+encodeURIComponent(context.resource_key)+path,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{}),redirect:'error',signal})
  if(!response.ok){
   const reason=[401,403].includes(response.status)?'permission_denied':response.status===404?'disconnected':response.status===429?'rate_limited':'temporary_failure'
   const raw=response.headers.get('retry-after'),seconds=raw&&/^\d+$/.test(raw)?Math.min(Number(raw),86400):null
   await response.body?.cancel()
   throw new ReportingProviderFailure(reason,seconds!==null?new Date(now()+seconds*1000).toISOString():null)
  }
  const reader=response.body?.getReader();if(!reader)throw Error('Response body missing')
  const chunks=[];let size=0
  try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>512000)throw Error('Response exceeds bound');chunks.push(value)}}finally{await reader.cancel().catch(()=>{});reader.releaseLock()}
  const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length}
  return JSON.parse(new TextDecoder().decode(bytes))
 }
 return {...dailyGscContract,manifestSha256,
  async verifyResource({context,signal}){
   const data=await request(context,'',null,signal)
   return {observed_at:new Date(now()).toISOString(),resource_matches:data.siteUrl===context.resource_key,observed_reporting_grant:['siteOwner','siteFullUser','siteRestrictedUser'].includes(data.permissionLevel),source_evidence_sha256:await reportingSha256(JSON.stringify(data))}
  },
  async fetchPage({identity,context,cursor,signal}){
   if(identity.source_contract!==dailyGscContract.sourceContract||identity.period_start!==identity.period_end||identity.reporting_time_zone!=='America/Los_Angeles'||identity.resource_key!==context.resource_key||identity.binding_id!==context.binding_id||identity.context_checksum!==context.context_checksum||identity.project_id!==context.project_id||identity.organization_id!==context.organization_id)throw Error('Exact daily property scope required')
   const position=cursor===null?{phase:'pages',offset:0}:JSON.parse(cursor)
   if(!['pages','queries'].includes(position.phase)||!Number.isSafeInteger(position.offset)||position.offset<0||position.offset>50000)throw Error('Invalid daily cursor')
   const dimensions=position.phase==='pages'?['page']:['page','query'],limit=50
   const data=await request(context,'/searchAnalytics/query',{startDate:identity.period_start,endDate:identity.period_end,dimensions,type:'web',dataState:'final',aggregationType:'byPage',rowLimit:limit,startRow:position.offset},signal)
   const rows=data.rows??[];if(!Array.isArray(rows)||rows.length>limit||data.responseAggregationType&&data.responseAggregationType!=='byPage')throw Error('Unexpected daily response')
   const observations=[],retrieved_at=new Date(now()).toISOString()
   for(const row of rows){
    if(!Array.isArray(row.keys)||row.keys.length!==dimensions.length||row.keys.some(k=>typeof k!=='string'||!k||k.length>2048))throw Error('Invalid daily dimensions')
    const source_record_sha256=await reportingSha256(JSON.stringify(row)),source_observation_id=await reportingSha256(JSON.stringify([identity.binding_id,identity.period_start,position.phase,retrieved_at,source_record_sha256]))
    for(const {metric_key} of dailyGscContract.metricDefinitions){
     const value=row[metric_key]??null
     if(value!==null&&(!Number.isFinite(value)||value<0||metric_key==='ctr'&&value>1))throw Error('Invalid metric')
     observations.push({source_observation_id,source_record_sha256,metric_key,metric_value:value,value_state:value===null?'unknown':'available',dimensions:{date:identity.period_start,page:row.keys[0],...(position.phase==='queries'?{query:row.keys[1]}:{}),series:position.phase,search_type:'web',data_state:'final'},data_through:null,completeness:'partial'})
    }
   }
   if(rows.length===limit&&position.offset+limit>=50000)throw Error('Daily provider row cap reached; coverage incomplete')
   const next_cursor=rows.length===limit?JSON.stringify({...position,offset:position.offset+limit}):position.phase==='pages'?JSON.stringify({phase:'queries',offset:0}):null
   return {source_contract:identity.source_contract,resource_key:identity.resource_key,period_start:identity.period_start,period_end:identity.period_end,reporting_time_zone:identity.reporting_time_zone,cursor,next_cursor,complete:next_cursor===null,retrieved_at,observations}
  }
 }
}
