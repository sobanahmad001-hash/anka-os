import {useEffect,useState} from 'react'
import {Link} from 'react-router-dom'
import {supabase} from '../lib/supabase.js'
import {summarizePageHealth} from '../data/websitePageHealth.js'
import {workRecordPath} from '../data/workItemExperience.js'

export function usePageHealth(project,ids,refresh){
 const key=ids.join(','),scope=project.organization_id+':'+project.id+':'+key,[state,setState]=useState({rows:[],error:''})
 useEffect(()=>{
  let active=true;setState({rows:[],error:''})
  if(key)supabase.rpc('website_page_health',{p_org:project.organization_id,p_project:project.id,p_pages:key.split(',')})
   .then(({data,error})=>{if(active)setState({scope,rows:error?[]:data||[],error:error?'Page health evidence is unavailable.':''})})
   .catch(()=>{if(active)setState({scope,rows:[],error:'Page health evidence is unavailable.'})})
  return()=>{active=false}
 },[project.id,project.organization_id,key,scope,refresh])
 return state.scope===scope?state:{rows:[],error:''}
}
function Work({rows,workspace}){
 return rows.length?<ul>{rows.map(w=><li key={w.kind+w.id}>
  <Link to={workRecordPath(w.kind,w.id)}>{w.title}</Link> · {w.state} · Owner: {workspace.teamMembers?.find(m=>m.id===w.owner)?.name||(w.owner?'Assigned':'Unassigned')}
  {w.due_date&&' · Due '+w.due_date}
 </li>)}</ul>:<p>No aspect-specific Work linked. Review evidence and link existing Work.</p>
}
export function HealthSummary({row,workspace,compact=false}){
 if(!row)return <p>Evidence not loaded · status unknown</p>
 const health=summarizePageHealth(row)
 if(compact)return <div className="space-y-1">{health.aspects.map(a=><p key={a.key}><strong>{a.label}</strong> · {a.status}{a.stale&&a.status!=='Stale'?' · Recheck':''}{a.issues?' · '+a.issues+' findings':''}</p>)}</div>
 return <div className="space-y-3">{health.aspects.map(a=><section key={a.key} aria-label={a.label+' status'}>
  <p><strong>{a.label}</strong> · {a.status}{a.stale&&a.status!=='Stale'?' · Recheck required':''}</p>
  <p>{a.issues} recorded findings{a.severity?' · '+a.severity:''} · {a.unknown} unchecked areas</p>
  <p>Last checked: {a.lastChecked||'Unknown'}{a.dataThrough?' · Data through '+a.dataThrough:''}</p>
  {!compact&&<><ul>{a.checks.map((c,i)=><li key={i}>{c.label}: {c.state==='checked'?'Evidence recorded':c.state==='issue'?'Needs attention':'Not checked'} · {c.detail}</li>)}</ul><Work rows={a.work} workspace={workspace}/></>}
  {compact&&<Work rows={a.work.filter(w=>w.state!=='Cancelled').slice(0,1)} workspace={workspace}/>}
 </section>)}
 {!compact&&<><p>Search performance does not verify indexability. Stored metadata does not verify current page content. No automatic refresh schedule is active in this summary.</p>
 {health.unclassifiedWork.length>0&&<section><h4>Other linked Work · aspect not classified</h4><Work rows={health.unclassifiedWork} workspace={workspace}/></section>}</>}
 </div>
}
export default function WebsitePageHealth({project,page,workspace,refresh}){
 const {rows,error}=usePageHealth(project,[page.id],refresh)
 return <section aria-label="Page health and work" className="workspace-card p-3"><h4>Page health and Work</h4>{error&&<p role="alert">{error}</p>}<HealthSummary row={rows.find(r=>r.id===page.id)} workspace={workspace}/></section>
}
