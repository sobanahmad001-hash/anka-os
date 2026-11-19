const aspects=['tracking','onpage','technical']
const labels={tracking:'Tracking',onpage:'On-page SEO',technical:'Technical SEO'}
const technical=new Set(['setup_marketing_technical_seo_audit','setup_marketing_seo_issue_prioritization','setup_marketing_seo_implementation_verification'])
const onpage=new Set(['setup_marketing_on_page_seo_audit','setup_marketing_page_seo_optimization','setup_marketing_internal_linking','setup_marketing_local_page_optimization'])
export const workAspect=work=>technical.has(work.service)?'technical':onpage.has(work.service)?'onpage':null
export function healthWorkStatus(work){
 if(work.review_state==='verified'&&work.evidence&&work.verified_date)return 'Verified'
 return ({not_started:'To do',todo:'To do',in_progress:'In progress',blocked:'Blocked',in_review:'Ready for review',review:'Ready for review',done:'Ready for review',cancelled:'Cancelled'})[work.status]||'Status unknown'
}
const old=(date,days,now)=>!date||!Number.isFinite(Date.parse(date))||Date.parse(date)>now||now-Date.parse(date)>days*86400000
export function summarizePageHealth(row,now=Date.now()){
 const groups=Object.fromEntries(aspects.map(a=>[a,{key:a,label:labels[a],checks:[],work:[],lastChecked:null,stale:false}]))
 const add=(aspect,label,state,detail,severity='warning')=>groups[aspect].checks.push({label,state,detail,severity:state==='issue'?severity:null})
 const tracking=row.tracking||{}
 add('tracking','Search Console page totals',tracking.pageObserved?'checked':'unknown',tracking.pageObserved?'Exact page totals imported':'No page totals in the current authorized snapshot')
 groups.tracking.lastChecked=tracking.synced
 groups.tracking.dataThrough=tracking.through
 groups.tracking.stale=!!tracking.synced&&(old(tracking.synced,2,now)||old(tracking.through,5,now))
 const source=row.source,meta=source?.meta
 const sourceMatches=!!row.url&&!!meta&&source?.url===row.url&&meta.url===row.url
 for(const [key,label] of [['title','Title'],['description','Meta description'],['h1','H1']]){
  add('onpage',label,sourceMatches&&Object.hasOwn(meta,key)?meta[key]?.trim()?'checked':'issue':'unknown',sourceMatches?'Stored discovery metadata; current observation time is unrecorded':'No matching page observation')
 }
 for(const label of ['Content and intent relevance','Internal-link quality','Image descriptions'])add('onpage',label,'unknown','Manual or provider evidence required')
 add('technical','HTTP response',sourceMatches&&Number.isInteger(meta.status)?meta.status===200?'checked':'issue':'unknown',sourceMatches&&meta.status?'Stored HTTP '+meta.status:'No matching HTTP observation')
 add('technical','Canonical URL',sourceMatches&&Object.hasOwn(meta,'canonical')?meta.canonical===row.url?'checked':'issue':'unknown',sourceMatches?meta.canonical||'Canonical not recorded':'No matching canonical observation')
 for(const label of ['Redirect chain','Noindex directives'])add('technical',label,'unknown','Not retained by the current discovery source')
 const manual=row.manual,check=manual?.check,e=check?.evidence
 for(const [key,label] of [['indexed','Indexing'],['schema_valid','Schema'],['mobile_score','Mobile performance'],['desktop_score','Desktop performance']]){
  const known=e?.[key]!==null&&e?.[key]!==undefined&&!manual.recheck_required
  add('technical',label,known?e[key]===false?'issue':'checked':'unknown',known?'Manual evidence: '+e[key]:'No current exact-version evidence')
 }
 for(const finding of e?.findings||[])add(finding.category==='content'?'onpage':'technical',finding.description,'issue',finding.evidence,finding.severity)
 for(const a of ['onpage','technical']){
  const manualRelevant=a==='technical'?!!e&&Object.entries(e).some(([key,value])=>['indexed','schema_valid','mobile_score','desktop_score'].includes(key)&&value!==null)||(e?.findings||[]).some(f=>f.category!=='content'):(e?.findings||[]).some(f=>f.category==='content')
  groups[a].lastChecked=manualRelevant?check?.checked_at:null
  // Discovery currently retains scan-start time, not each response's observation time.
  groups[a].stale=!!source||!!manual?.recheck_required||!!check&&old(check.checked_at,7,now)
 }
 for(const work of row.work||[]){const a=workAspect(work);if(a)groups[a].work.push({...work,state:healthWorkStatus(work)})}
 return {aspects:aspects.map(a=>{
  const group=groups[a],issues=group.checks.filter(c=>c.state==='issue').length,unknown=group.checks.filter(c=>c.state==='unknown').length
  const severity=group.checks.some(c=>c.severity==='critical')?'critical':group.checks.some(c=>c.severity==='warning')?'warning':issues?'info':null
  return {...group,issues,unknown,severity,status:issues?'Needs attention':unknown?'Not checked':group.stale?'Stale':'Checked'}
 }),unclassifiedWork:(row.work||[]).filter(w=>!workAspect(w)).map(w=>({...w,state:healthWorkStatus(w)}))}
}
