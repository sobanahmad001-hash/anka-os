import {createProjectPageKeywordTargetsRepository} from './projectPageKeywordTargetsRepository.js'
import {createProjectWebsiteSeoObservationsRepository} from './projectWebsiteSeoObservationsRepository.js'

const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i
const SHA=/^[a-f0-9]{64}$/
const fields=['actorId','organizationId','projectId','engagementId','brandId','pageId','architectureVersionId']
const copy=v=>JSON.parse(JSON.stringify(v))
const canonical=v=>v&&typeof v==='object'?Array.isArray(v)?v.map(canonical):Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v
const same=(a,b)=>JSON.stringify(canonical(a))===JSON.stringify(canonical(b))
const freeze=v=>{if(v&&typeof v==='object'){Object.values(v).forEach(freeze);Object.freeze(v)}return v}
const fail=message=>{throw Error(message)}
function scopeOf(v){
 if(!v||fields.some(k=>!UUID.test(v[k]||'')))fail('Exact actor, project, brand and registered page context required')
 return Object.fromEntries(fields.map(k=>[k,v[k]]))
}
function targeting(data,s){
 if(data?.page_id!==s.pageId||data.measurement_kind!=='planned_target'||!Number.isSafeInteger(data.revision)||data.revision<0)fail('Planned target scope changed')
 const r=data.current
 if(data.revision===0){if(r!==null)fail('Unverified planned target revision');return {revision:0,strategy_version_id:null,source_checksum:null,targets:[]}}
 if(!r||r.organization_id!==s.organizationId||r.project_id!==s.projectId||r.page_id!==s.pageId||r.revision!==data.revision||!UUID.test(r.strategy_version_id||'')||!SHA.test(r.source_checksum||'')||!Array.isArray(r.targets)||r.targets.length>200)fail('Exact persisted targeting revision required')
 const seen=new Set()
 const targets=r.targets.map(t=>{
  if(!Number.isSafeInteger(t.keyword_index)||t.keyword_index<0||seen.has(t.keyword_index)||!['primary','supporting'].includes(t.role)||typeof t.cluster!=='string'||!t.cluster.trim()||t.cluster.length>240||typeof t.source?.term!=='string'||!t.source.term.trim())fail('Exact persisted keyword source required')
  seen.add(t.keyword_index)
  return {keyword_index:t.keyword_index,role:t.role,cluster:t.cluster,term:t.source.term,locale:t.source.locale??null,evidence_source:t.source.evidence_source??null,observation_date:t.source.observation_date??null,measurement_kind:'planned_target'}
 })
 return {revision:r.revision,strategy_version_id:r.strategy_version_id,source_checksum:r.source_checksum,targets}
}

// Read-only local planning contract. Existing RPCs enforce access independently.
// No campaign save/approval, provider request, Work mutation or official brief is implied.
export function createProjectMarketingPagePlanning(client){
 if(!client?.auth?.getUser)throw TypeError('Authenticated canonical reader required')
 const targets=createProjectPageKeywordTargetsRepository(client),observations=createProjectWebsiteSeoObservationsRepository(client)
 let selected=null,generation=0,reviewed=null
 function select(scope){selected=scope===null?null:scopeOf(scope);generation++;reviewed=null}
 async function read(s,token,signal){
  const current=()=>{if(signal?.aborted||token!==generation||!same(selected,s))fail('Planning context changed; review the selected page again')}
  const actor=async()=>{current();const {data,error}=await client.auth.getUser();current();if(error||data?.user?.id!==s.actorId)fail('Current authenticated planning access denied')}
  await actor()
  const [planned,...evidence]=await Promise.all([targets.read(s,{signal}),...['page_audits','query_observations'].map(category=>observations.list({...s,category,limit:25,offset:0},{signal}))])
  current()
  const contexts=evidence.map(r=>r.context)
  if(contexts.some(c=>c.brand_id!==s.brandId||c.source_state!=='available'||typeof c.page_key!=='string'||!c.page_key||!same(c,contexts[0])))fail('Page architecture or evidence context changed')
  const targetingSnapshot=targeting(planned,s)
  if(!same(targetingSnapshot,targeting(await targets.read(s,{signal}),s)))fail('Planned targets changed during review')
  await actor();current()
  const c=contexts[0]
  return freeze({version:1,kind:'marketing_page_planning_review',scope:copy(s),page:{id:s.pageId,page_key:c.page_key,architecture_version_id:s.architectureVersionId,planned_path:c.planned_page?.path??null,title:c.planned_page?.title??null},targeting:targetingSnapshot,
   evidence_binding:{tracked_page_id:c.tracked_page?.id??null,seo_link_id:c.seo_link?.id??null,seo_link_number:c.seo_link?.link_number??null,reporting_binding_id:c.reporting_binding_id},
   evidence:evidence.map(r=>({category:r.category,items:r.items.map(row=>({id:row.id,source_type:row.source_type??null,record_kind:row.record_kind??null,version_binding:'unknown',observed_on:row.audit_date??row.observation_date??null,
    indexed:row.source_type==='manual'?row.indexed??null:null,schema_valid:row.source_type==='manual'?row.schema_valid??null:null})),total:r.total,matching:r.matching,has_more:r.has_more})),
   limitations:{version_binding:'unknown',provider_metrics:'withheld',provider_period:'unknown',recheck_reasons:copy(c.recheck_reasons),history_complete:evidence.every(r=>!r.has_more)},
   next_action:'review_local_marketing_plan',official:false,provider_request_made:false})
 }
 return Object.freeze({select,
  async review({signal}={}){if(!selected)fail('Select an exact registered page');const s=copy(selected),token=++generation;reviewed=null;const result=await read(s,token,signal);reviewed=result;return result},
  async preparePlanningSeed(review,{confirmed=false,signal}={}){
   if(!confirmed||review!==reviewed)fail('Explicit review of this exact planning snapshot required')
   const token=generation,s=copy(selected),fresh=await read(s,token,signal)
   if(!same(review,fresh)){reviewed=null;fail('Page targets or evidence changed; review again')}
   return freeze({version:1,kind:'local_marketing_page_plan',scope:copy(s),source_review:copy(review),campaign_goal:null,channels:[],measurement_value:null,measurement_unit:null,official:false,work_created:false,provider_request_made:false,publication_authorized:false})
  },
 })
}
