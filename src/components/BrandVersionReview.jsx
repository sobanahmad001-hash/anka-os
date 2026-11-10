import {useEffect,useState} from 'react'
import {createDeliverableGovernance} from '../data/deliverableGovernance.js'
import {supabase} from '../lib/supabase.js'
const governance=createDeliverableGovernance(supabase)
export default function BrandVersionReview({organizationId,version,members,run,refresh}){
 const [open,setOpen]=useState(false),[caps,setCaps]=useState(null),[reviewer,setReviewer]=useState(''),[feedback,setFeedback]=useState('')
 const [checks,setChecks]=useState({quality_standard:false,matches_brief:false,technically_ready:false})
 useEffect(()=>{
  let active=true
  if(open)supabase.rpc('read_brand_version_review',{p_organization_id:organizationId,p_deliverable_version_id:version.id}).then(({data,error})=>{if(active)setCaps(error?{error:error.message}:data)}).catch(()=>{if(active)setCaps(null)})
  return()=>{active=false}
 },[organizationId,version.id,version.review_status,open])
 async function decide(decision){
  const input={organizationId,deliverableVersionId:version.id,expectedStateVersion:caps.state_version}
  if(decision==='submit')await governance.submit({...input,reviewerId:reviewer})
  else await governance.review({...input,decision,rationale:feedback,checklistResult:checks})
  await refresh()
 }
 return <section aria-label={'Review version '+version.version_number}><button type="button" onClick={()=>setOpen(!open)}>Review v{version.version_number}</button>
 {open&&<>{caps?.error&&<p role="alert">{caps.error}</p>}{caps?.can_submit&&<><label>Reviewer<select aria-label="Reviewer" value={reviewer} onChange={e=>setReviewer(e.target.value)}><option value="">Choose reviewer</option>{members.map(m=><option key={m.id} value={m.id}>{m.name}</option>)}</select></label><button disabled={!reviewer} onClick={()=>run(()=>decide('submit'))}>Submit version for review</button></>}
 {caps?.can_review&&<><label>Review feedback<textarea value={feedback} onChange={e=>setFeedback(e.target.value)}/></label>
 {Object.entries(checks).map(([key,value])=><label key={key}><input type="checkbox" checked={value} onChange={e=>setChecks(old=>({...old,[key]:e.target.checked}))}/>{key.replaceAll('_',' ')}</label>)}
 <button disabled={!feedback.trim()} onClick={()=>run(()=>decide('changes_required'))}>Request changes</button><button disabled={!Object.values(checks).every(Boolean)} onClick={()=>run(()=>decide('approved'))}>Approve this version</button></>}
 {caps&&!caps.can_submit&&!caps.can_review&&<p>Review status: {version.review_status.replaceAll('_',' ')}</p>}</>}
 </section>
}
