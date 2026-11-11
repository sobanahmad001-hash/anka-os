import {useEffect,useMemo,useState} from 'react'
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
export default function WebsiteInventoryBrowser({workspace,refresh,onOpen}){
 const {project}=workspace
 const [search,setSearch]=useState(''),[filter,setFilter]=useState('all'),[owner,setOwner]=useState(''),[view,setView]=useState('pages'),[offset,setOffset]=useState(0),[result,setResult]=useState(null),[error,setError]=useState('')
 const owners=useMemo(()=>[...new Map(workRecords(workspace).filter(w=>w.owner?.id).map(w=>[w.owner.id,w.owner.name])).entries()],[workspace])
 useEffect(()=>{
  let current=true;setResult(null);setError('')
  const timer=setTimeout(async()=>{
   try{const {data,error:e}=await supabase.rpc('website_page_index',{p_org:project.organization_id,p_project:project.id,p_search:search.trim(),p_filter:filter,p_owner:owner||null,p_offset:offset,p_view:view})
    if(e)throw e;if(current)setResult(data)
   }catch(e){if(current)setError(e.message)}
  },150);return()=>{current=false;clearTimeout(timer)}
 },[project.id,project.organization_id,search,filter,owner,offset,view,refresh])
 const change=(fn,val)=>{setOffset(0);fn(val)}
 return <section aria-label="Search website inventory" className="space-y-3"><div><button className={button} aria-pressed={view==='pages'} onClick={()=>change(setView,'pages')}>Pages</button> <button className={button} aria-pressed={view==='assignments'} onClick={()=>change(setView,'assignments')}>Site-wide keyword assignments</button></div>
 <label>Search title or URL <input maxLength={240} value={search} onChange={e=>change(setSearch,e.target.value)}/></label>
 <label>Work filter <select value={filter} onChange={e=>change(setFilter,e.target.value)}>{Object.entries({all:'All pages',open:'Open Work',seo:'SEO Work',overdue:'Overdue open Work',unlinked:'No linked Work'}).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select></label>
 <label>Work owner <select value={owner} onChange={e=>change(setOwner,e.target.value)}><option value="">All owners</option>{owners.map(([id,name])=><option key={id} value={id}>{name}</option>)}</select></label>
 {error&&<p role="alert">{error}</p>}{result?<><p role="status">{result.total?offset+1:0}–{Math.min(offset+25,result.total)} of {result.total} {view==='pages'?'pages':'assignments'}</p>
 <ul>{result.items.map((p,i)=><li key={p.id+':'+i}><button className={button} onClick={()=>onOpen(p.id)}>{p.title} · {p.path}</button> {p.target&&<span>{p.target.query} · {p.target.role} · {p.target.intent} · {p.target.locale} · {p.url||p.path}</span>}{p.work?.map(w=><span key={w.kind+w.id}> · {w.title} ({w.status}{w.seo?', SEO':''})</span>)}</li>)}</ul>
 <button className={button} disabled={!offset} onClick={()=>setOffset(Math.max(0,offset-25))}>Previous results</button> <button className={button} disabled={offset+25>=result.total} onClick={()=>setOffset(offset+25)}>Next results</button></>:!error&&<p>Loading results…</p>}</section>
}
