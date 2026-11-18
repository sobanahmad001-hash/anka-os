import {useMemo,useState} from 'react'
import {Link} from 'react-router-dom'
import {supabase} from '../lib/supabase.js'
import {projectWorkCard} from '../data/projectWorkCard.js'

const button='workspace-button'
function workRecords(workspace){
 return [['engagement_work_item',workspace.engagementWorkItems],['project_task',workspace.projectTasks]].flatMap(([kind,rows])=>(rows||[]).filter(w=>w.project_id===workspace.project.id&&w.organization_id===workspace.project.organization_id).map(w=>({kind,...w})))
}
export function PageWork({page,workspace,onChange}){
 const records=useMemo(()=>workRecords(workspace),[workspace]),[choice,setChoice]=useState(''),[seo,setSeo]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('')
 async function link(){
  const w=records.find(row=>row.kind+':'+row.id===choice);if(!w)return
  setBusy(true);setError('')
  try{const {error:e}=await supabase.rpc('website_page_work_link',{p_org:workspace.project.organization_id,p_project:workspace.project.id,p_page:page.id,p_kind:w.kind,p_work:w.id,p_seo:seo});if(e)throw e;setChoice('');onChange()}
  catch(e){setError(e.message)}finally{setBusy(false)}
 }
 return <section><h4>Linked Work</h4>{page.work?.length?<ul>{page.work.map(w=>{
 const record=records.find(r=>r.id===w.id&&r.kind===w.kind),next=projectWorkCard(workspace,w.kind,w.id)?.next
 return <li key={w.kind+w.id}>{w.title} · {w.status}{w.seo?' · SEO':''} · Owner: {record?.owner?.name||(w.owner?'Assigned':'Unassigned')} · Due: {w.due_date||'Unset'} · Next action: {next?<Link to={next.path}>{next.label}</Link>:'Open the linked Work record for details'}</li>
 })}</ul>:<p>No linked Work.</p>}
 <label>Existing project Work <select value={choice} disabled={busy} onChange={e=>setChoice(e.target.value)}><option value="">Choose existing Work</option>{records.map(w=><option key={w.kind+w.id} value={w.kind+':'+w.id}>{w.title}</option>)}</select></label>
 <label><input type="checkbox" checked={seo} onChange={e=>setSeo(e.target.checked)}/> SEO work</label> <button className={button} disabled={!choice||busy} onClick={link}>Link existing Work</button>{error&&<p role="alert">{error}</p>}</section>
}

export {default} from './WebsiteTables.jsx'
