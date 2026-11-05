// Canonical read-model adapter. It does not write Work, approvals, or completion.
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const HASH=/^[a-f0-9]{64}$/
const same=(a,b)=>a?.organization_id===b?.organization_id&&a?.project_id===b?.project_id&&a?.engagement_id===b?.engagement_id
const TRACKS=[['branding','Branding foundation','Shared direction for Website and Marketing.'],['website','Website','Each registered page progresses independently.'],['marketing','Marketing cycles','Existing campaign assets and recurring cycles.']]
export const PROJECT_STAGE_PHASES=Object.freeze([
  {
    "key": "branding.brief",
    "track": "branding",
    "label": "Business brief",
    "position": 1
  },
  {
    "key": "branding.positioning",
    "track": "branding",
    "label": "Brand positioning and statement",
    "position": 2
  },
  {
    "key": "branding.services",
    "track": "branding",
    "label": "Product and service structure",
    "position": 3
  },
  {
    "key": "branding.identity",
    "track": "branding",
    "label": "Messaging and visual identity",
    "position": 4
  },
  {
    "key": "website.goals",
    "track": "website",
    "label": "Goals and audience",
    "position": 5
  },
  {
    "key": "website.keywords",
    "track": "website",
    "label": "Keyword research and search intent",
    "position": 6
  },
  {
    "key": "website.sitemap",
    "track": "website",
    "label": "Sitemap and keyword-to-page mapping",
    "position": 7
  },
  {
    "key": "website.content",
    "track": "website",
    "label": "Page content",
    "position": 8
  },
  {
    "key": "website.design",
    "track": "website",
    "label": "Design",
    "position": 9
  },
  {
    "key": "website.build",
    "track": "website",
    "label": "Build",
    "position": 10
  },
  {
    "key": "website.qa",
    "track": "website",
    "label": "QA",
    "position": 11
  },
  {
    "key": "website.publish",
    "track": "website",
    "label": "Publish",
    "position": 12
  },
  {
    "key": "website.marketing_ready",
    "track": "website",
    "label": "Ready for marketing",
    "position": 13
  },
  {
    "key": "marketing.goals",
    "track": "marketing",
    "label": "Goals and baseline",
    "position": 14
  },
  {
    "key": "marketing.opportunities",
    "track": "marketing",
    "label": "Audience and keyword opportunities",
    "position": 15
  },
  {
    "key": "marketing.plan",
    "track": "marketing",
    "label": "Campaign and content plan",
    "position": 16
  },
  {
    "key": "marketing.assets",
    "track": "marketing",
    "label": "Create assets",
    "position": 17
  },
  {
    "key": "marketing.review",
    "track": "marketing",
    "label": "Review",
    "position": 18
  },
  {
    "key": "marketing.launch",
    "track": "marketing",
    "label": "Launch",
    "position": 19
  },
  {
    "key": "marketing.measure",
    "track": "marketing",
    "label": "Measure",
    "position": 20
  },
  {
    "key": "marketing.improve",
    "track": "marketing",
    "label": "Improve and next cycle",
    "position": 21
  }
])
const validId=v=>typeof v==='string'&&UUID.test(v)
const outputIdentity=o=>o&&validId(o.artifact_id)&&validId(o.artifact_version_id)&&Number.isSafeInteger(o.version_number)&&o.version_number>0
function checkedPartition(header,unit){
 if(!same(header,unit)||unit.plan_id!==header.plan_id||!header.groups.some(g=>g.id===unit.group_id)||!validId(unit.partition?.id)||!['engagement','website_page','campaign_asset','recurring_occurrence'].includes(unit.partition.kind)||!Array.isArray(unit.steps))throw Error('Stage progress belongs to another exact plan or partition')
 if(unit.state==='current'&&!HASH.test(unit.context_sha256||''))throw Error('Current stage evidence requires its exact checksum')
 const seen=new Set()
 for(const step of unit.steps){
  if(typeof step.key!=='string'||seen.has(step.key)||!Array.isArray(step.items)||!['run','reuse','omit','outside_scope'].includes(step.action))throw Error('Exact distinct reviewed stage evidence required')
  seen.add(step.key);const slots=new Set()
  for(const item of step.items){
   if(!Number.isSafeInteger(item.instance)||item.instance<1||item.instance>50||slots.has(item.instance)||typeof item.work_required!=='boolean'||typeof item.work_done!=='boolean'||typeof item.output_approved!=='boolean'||typeof item.material_current!=='boolean'||typeof item.needs_update!=='boolean'||typeof item.dependency_blocked!=='boolean')throw Error('Exact bounded required-slot evidence required')
   if(item.work_item_id!==null&&!validId(item.work_item_id))throw Error('Exact Work identity required')
   if(item.output_approved&&(!outputIdentity(item.output)||!validId(item.output.approval_id)||!HASH.test(item.output.content_checksum||'')))throw Error('Approved output identity is missing')
   slots.add(item.instance)
  }
  if(step.action==='run'&&(!step.items.length||step.items.some(x=>!x.work_required))||step.action==='reuse'&&(step.items.length!==1||step.items[0].work_required)||['omit','outside_scope'].includes(step.action)&&step.items.length)throw Error('Reviewed required-slot evidence differs from the action')
 }
 return unit
}
function projectOutput(item,scope){
 if(!outputIdentity(item.output))return null
 const o=item.output
 return {id:o.artifact_version_id,artifactId:o.artifact_id,versionId:o.artifact_version_id,title:'Recorded '+(o.artifact_type||'output'),versionLabel:'Version '+o.version_number,approved:item.output_approved,
  // Exact versions are opened by the existing output-library callback; no latest URL.
  scope:{organizationId:scope.organization_id,projectId:scope.project_id,engagementId:scope.engagement_id},path:null}
}
export function summarizeProjectStageSteps(steps,{available=true,scope={}}={}){
 const required=steps.filter(s=>['run','reuse'].includes(s.action)).flatMap(s=>s.items.map(i=>({...i,stepKey:s.key})))
 const outputs=[...new Map(required.map(i=>projectOutput(i,scope)).filter(Boolean).map(o=>[o.id,o])).values()]
 const excluded=steps.filter(s=>['omit','outside_scope'].includes(s.action)).map(s=>({key:s.key,action:s.action,reason:s.reason||null}))
 const needsUpdate=required.some(i=>i.needs_update)
 if(!available)return {status:'blocked',progress:null,needsUpdate,outputs,excluded,blockedReason:'Current source evidence is unavailable. Recorded outputs and history are retained.'}
 if(!required.length)return {status:null,progress:null,needsUpdate:false,outputs,excluded,blockedReason:'These reviewed steps are omitted or outside scope; no completion is inferred.'}
 const completed=required.filter(i=>(!i.work_required||i.work_done)&&i.output_approved&&i.material_current&&!i.needs_update&&!i.dependency_blocked&&!i.missing_work).length
 const approved=required.filter(i=>i.output_approved).length
 const blocked=required.some(i=>i.missing_work||i.dependency_blocked||i.work_status==='blocked')
 const reviewing=required.some(i=>i.work_done||i.output||i.work_status==='in_review'||i.work_status==='review')
 const started=required.some(i=>i.work_item_id&&i.work_status!=='not_started')
 const status=blocked?'blocked':completed===required.length?'done':needsUpdate||reviewing?'in_review':started?'in_progress':'not_started'
 return {status,progress:{completed,total:required.length,label:'current required items complete',approved},needsUpdate,outputs,excluded,
  blockedReason:blocked?'Required Work or a declared prerequisite needs attention.':null}
}
export function projectStagePlan(header,partitions=[]){
 if(!header||!validId(header.organization_id)||!validId(header.project_id)||!validId(header.engagement_id)||!Array.isArray(header.groups)||!Array.isArray(header.bindings)||!['available','unconfigured'].includes(header.state))throw Error('Exact scoped saved stage plan required')
 if(header.state==='available'&&!validId(header.plan_id))throw Error('Saved plan identity required')
 const units=partitions.map(p=>checkedPartition(header,p))
 const keys=new Set();for(const u of units){const key=[u.group_id,u.partition.kind,u.partition.id].join(':');if(keys.has(key))throw Error('Duplicate loaded canonical partition');keys.add(key)}
 const tracks=TRACKS.map(([id,title,description])=>({id,title,description,stages:PROJECT_STAGE_PHASES.filter(p=>p.track===id).map(phase=>{
  const bindings=header.bindings.filter(b=>b.phase===phase.key&&header.groups.some(g=>g.id===b.group_id&&g.publication_id===b.publication_id&&g.kind===id&&g.steps?.some(s=>s.key===b.step_key)))
  const items=[]
  for(const u of units){
   const expected=bindings.filter(b=>b.group_id===u.group_id);if(!expected.length)continue
   const steps=u.steps.filter(s=>expected.some(b=>b.step_key===s.key)&&s.phase===phase.key)
   const completeEvidence=steps.length===expected.length
   const summary=summarizeProjectStageSteps(steps,{available:u.state==='current'&&completeEvidence,scope:header})
   items.push({id:[u.group_id,u.partition.kind,u.partition.id].join(':'),title:u.page?.initial_path||u.occurrence?.period_start||u.partition.kind.replaceAll('_',' '),configured:u.state!=='unconfigured',...summary,
    partition:u.partition,context:completeEvidence&&u.state==='current'?{version:1,organization_id:header.organization_id,project_id:header.project_id,engagement_id:header.engagement_id,plan_id:header.plan_id,group_id:u.group_id,phase:phase.key,partition:u.partition,context_sha256:u.context_sha256}:null,
    keywords:(u.keywords?.targets||[]).map(t=>t.source?.term).filter(t=>typeof t==='string'),intent:[...new Set((u.keywords?.targets||[]).map(t=>t.source?.intent).filter(t=>typeof t==='string'))].join(', '),keywordTargets:u.keywords||null,performanceAssociation:u.performance_association||null,occurrence:u.occurrence||null})
  }
  const allSteps=units.flatMap(u=>u.steps.filter(s=>bindings.some(b=>b.group_id===u.group_id&&b.step_key===s.key)&&s.phase===phase.key))
  const summary=items.length?summarizeProjectStageSteps(allSteps,{available:items.every(i=>i.context!==null),scope:header}):{status:null,progress:null,needsUpdate:false,outputs:[],blockedReason:bindings.length?'Select a registered page, campaign asset, cycle or foundation to load exact progress.':null}
  return {id:phase.key,title:phase.label,configured:bindings.length>0,...summary,items,
   scopeLabel:items.length?'Only '+items.length+' loaded partition'+(items.length===1?'':'s')+'; not a whole-project total.':null,
   context:items.length===1?items[0].context:null}
 })}))
 return {state:header.state,planId:header.plan_id,planVersion:header.plan_version,canManage:header.can_manage===true,tracks,readOnly:true}
}
