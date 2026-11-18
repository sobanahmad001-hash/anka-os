import {useEffect,useRef,useState} from 'react'
import {supabase} from '../lib/supabase.js'
import {assessQuery} from '../data/keywordAssessment.js'

export default function KeywordAssessment({project,page,onChanged}){
 const [data,setData]=useState(null),[offset,setOffset]=useState(0),[refresh,reload]=useState(0),[error,setError]=useState('')
 const [busy,setBusy]=useState(false),[selected,setSelected]=useState(null),[intent,setIntent]=useState(''),[locale,setLocale]=useState(''),[role,setRole]=useState('supporting')
 const flight=useRef(false),pending=useRef(null)
 const scope={p_org:project.organization_id,p_project:project.id,p_page:page.id}
 useEffect(()=>{
  let active=true;setData(null);setError('')
  supabase.rpc('website_keyword_assessment',{p_org:project.organization_id,p_project:project.id,p_page:page.id,p_offset:offset})
   .then(({data,error})=>{if(active){setData(data);setError(error?.message||'')}})
  return()=>{active=false}
 },[project.id,project.organization_id,page.id,page.revision,offset,refresh])
 async function decide(query,state,revision){
  if(flight.current)return
  flight.current=true;setBusy(true);setError('')
  const values={...scope,p_query:query,p_state:state,p_decision_revision:revision,p_page_revision:data.page.revision,
   p_role:state==='selected'?role:null,p_intent:state==='selected'?intent:null,p_locale:state==='selected'?locale:null}
  const signature=JSON.stringify(values)
  if(pending.current?.signature!==signature)pending.current={signature,id:crypto.randomUUID()}
  try{
   const {error}=await supabase.rpc('decide_website_keyword',{...values,p_request:pending.current.id})
   if(error)throw error
   pending.current=null;setSelected(null);reload(n=>n+1);onChanged?.()
  }catch(e){setError(e.message)}finally{flight.current=false;setBusy(false)}
 }
 function review(row,assessment){
  setSelected(row);setIntent(assessment.intent==='Review intent'?'':assessment.intent);setLocale('')
  const targets=data.page.mode==='undecided'?data.page.sourceTargets:data.page.targets
  setRole(targets.some(t=>t.role==='primary')?'supporting':assessment.role)
 }
 return <section className="workspace-card p-3 space-y-3"><h4>Current keyword assessment</h4>
 <p>Review service, location and search intent before accepting a query. Positions 4–20 are an opportunity heuristic; ranking improvements are uncertain.</p>
 {error&&<p role="alert">{error}</p>}
 {data&&<><p>{data.start?data.start+' to '+data.end+' · Last sync '+new Date(data.synced).toLocaleString():'No current Search Console snapshot.'}</p>
 <fieldset disabled={busy}>
 {data.rows.slice(0,50).map(row=>{
  const assessment=assessQuery(row,data.page,data.source,project.name),decision=data.decisions.find(d=>d.query===row.query)
  return <article className="workspace-card p-3 space-y-2" key={row.query}><h5>{row.query}</h5>
   <p>{row.clicks} clicks · {row.impressions} impressions · {(row.ctr*100).toFixed(2)}% CTR · Average position {row.position.toFixed(1)}</p>
   <p>{decision?.state||'suggested'} · Suggested role {assessment.role} · {assessment.explanation}</p>
   {assessment.opportunity&&<p>Average position 4–20 may merit a closer review.</p>}
   {assessment.flags.map(flag=><p key={flag}>{flag}</p>)}
   {!!row.overlaps?.length&&<ul>{row.overlaps.map(other=><li key={other.page}><a href={other.page} target="_blank" rel="noreferrer">{other.page}</a> · {other.clicks} clicks · Position {other.position.toFixed(1)}</li>)}</ul>}
   <button type="button" onClick={()=>review(row,assessment)}>Review acceptance</button>
   <button type="button" onClick={()=>decide(row.query,decision?.state==='dismissed'?'suggested':'dismissed',decision?.revision||0)}>{decision?.state==='dismissed'?'Restore suggestion':'Dismiss suggestion'}</button>
  </article>
 })}
 {!data.rows.length&&<p>No observed queries for this exact URL in the current snapshot. Review the URL coverage list for unmatched URLs.</p>}
 {data.decisions.filter(d=>!data.rows.some(r=>r.query===d.query)).length>0&&<details><summary>Saved decisions outside this result page</summary><ul>{data.decisions.filter(d=>!data.rows.some(r=>r.query===d.query)).map(d=><li key={d.query}>{d.query} · {d.state}</li>)}</ul></details>}
 {selected&&<section><h5>Accept {selected.query}</h5><label>Role <select value={role} onChange={e=>setRole(e.target.value)}><option value="supporting">Supporting</option><option value="primary">Primary</option></select></label>
 <label>Confirmed search intent <input value={intent} maxLength={250} onChange={e=>setIntent(e.target.value)}/></label>
 <label>Confirmed locale <input value={locale} maxLength={60} placeholder="e.g. en-GB" onChange={e=>setLocale(e.target.value)}/></label>
 <p>Acceptance adds this query to the existing targets. A saved primary target must be changed through Edit page and targets.</p>
 <button type="button" disabled={!intent.trim()||!locale.trim()} onClick={()=>decide(selected.query,'selected',data.decisions.find(d=>d.query===selected.query)?.revision||0)}>Accept into page targets</button>
 <button type="button" onClick={()=>setSelected(null)}>Cancel</button></section>}
 {offset>0&&<button type="button" onClick={()=>setOffset(offset-50)}>Previous queries</button>}
 {data.rows.length>50&&<button type="button" onClick={()=>setOffset(offset+50)}>Next queries</button>}
 </fieldset></>}
 </section>
}

export function KeywordUrlReview({project}){
 const [open,setOpen]=useState(false),[data,setData]=useState(null),[offset,setOffset]=useState(0),[error,setError]=useState('')
 useEffect(()=>{
  if(!open)return
  let current=true;setData(null);setError('')
  supabase.rpc('website_gsc_url_review',{p_org:project.organization_id,p_project:project.id,p_offset:offset}).then(({data,error})=>{if(current){setData(data);setError(error?.message||'')}})
  return()=>{current=false}
 },[open,project.id,project.organization_id,offset])
 return <section><button type="button" onClick={()=>setOpen(!open)} aria-expanded={open}>Review unmatched Search Console URLs</button>
 {open&&<>{error&&<p role="alert">{error}</p>}{data&&<><p>{data.total} URLs require review. Inspect redirect or canonical evidence before editing a page’s intended URL.</p>
 <ul>{data.rows.slice(0,50).map(row=><li key={row.url}><a href={row.url} target="_blank" rel="noreferrer">{row.url}</a>
 <p>{row.observed?'Observed '+new Date(row.observed_at).toLocaleDateString()+' · Final URL '+row.observed.url+' · Canonical '+(row.observed.canonical||'none'):'No saved redirect or canonical evidence. Unresolved.'}</p></li>)}</ul>
 {offset>0&&<button onClick={()=>setOffset(offset-50)}>Previous URLs</button>}{data.rows.length>50&&<button onClick={()=>setOffset(offset+50)}>Next URLs</button>}</>}</>}
 </section>
}
