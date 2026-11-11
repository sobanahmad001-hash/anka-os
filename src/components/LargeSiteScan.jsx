import {useEffect,useRef,useState} from 'react'
import {supabase} from '../lib/supabase.js'
import {approvedRows,importPreview} from '../data/websiteImport.js'

const button='workspace-button'
async function rpc(name,args){
 const {data,error}=await supabase.rpc(name,args)
 if(error)throw Object.assign(Error(error.message),{code:error.code})
 return data
}
export default function LargeSiteScan({project,domain,keywords,onApplied}){
 const scope={p_org:project.organization_id,p_project:project.id}
 const [jobs,setJobs]=useState([]),[job,choose]=useState(''),[state,setState]=useState(null),[batch,setBatch]=useState(null)
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[pending,setPending]=useState(''),[offset,setOffset]=useState(0)
 const alive=useRef(true),stop=useRef(false),flight=useRef(false)
 const base={...scope,p_job:job},key='anka.scan.review.'+scope.p_org+'.'+scope.p_project+'.'+job
 useEffect(()=>{alive.current=true;rpc('website_scan_status',{p_org:project.organization_id,p_project:project.id}).then(v=>{if(alive.current)setJobs(v)}).catch(e=>{if(alive.current)setError(e.message)});return()=>{alive.current=false;stop.current=true}},[project.id,project.organization_id])
 useEffect(()=>{let current=true;setBatch(null);setState(null);setOffset(0);setPending(sessionStorage.getItem(key)||'')
  if(job)rpc('website_scan_status',{p_org:project.organization_id,p_project:project.id,p_job:job}).then(v=>{if(current)setState(v)}).catch(e=>{if(current)setError(e.message)})
  return()=>{current=false}},[job,key,project.organization_id,project.id])
 async function run(fn){
  if(flight.current)return;flight.current=true;setBusy(true);setError('')
  try{await fn()}catch(e){if(alive.current)setError(e.message)}finally{flight.current=false;if(alive.current)setBusy(false)}
 }
 async function status(){const v=await rpc('website_scan_status',base);if(alive.current)setState(v);return v}
 async function start(){
  const u=new URL(domain.includes('://')?domain:'https://'+domain)
  if(u.protocol!=='https:'||u.username||u.password||u.pathname!=='/'||u.search||u.hash||u.port)throw Error('Enter a public HTTPS domain.')
  const id=crypto.randomUUID()
  await rpc('website_scan_start',{...scope,p_job:id,p_origin:u.origin,p_keywords:keywords()})
  const v=await rpc('website_scan_status',scope);if(alive.current){setJobs(v);choose(id)}
 }
 async function resume(){
  stop.current=false;let current=await status()
  while(alive.current&&!stop.current&&current.remaining){
   const {error:e}=await supabase.functions.invoke('website-discovery',{body:{organization:scope.p_org,project:scope.p_project,job}})
   if(e){await status();throw Error('Discovery paused. The counters show the last saved checkpoint.')}
   current=await status()
  }
 }
 async function review(n=0){
  const v=await rpc('website_scan_review',{...base,p_offset:n})
  const data=importPreview({origin:state.origin,pages:v.batch.map(({collision,...meta})=>meta)},v.pages,v.sources,v.keywords)
  data.candidates.forEach((c,i)=>{if(v.batch[i].collision){c.state='ambiguous';c.reason='Multiple URLs share this WordPress identity.';c.selected=false}})
  if(alive.current){setBatch({...data,unmatched:v.unmatched});setOffset(n)}
 }
 function edit(i,patch){setBatch(b=>({...b,candidates:b.candidates.map((c,j)=>j===i?{...c,...patch}:c)}))}
 async function decide(skipped){
  const edits=approvedRows(batch.candidates)
  const choices=skipped?batch.candidates.filter(c=>!c.selected).map(c=>({url:c.meta.url,edit:null})):edits.map(edit=>({url:edit.meta.url,edit}))
  if(!choices.length)return
  const id=crypto.randomUUID();sessionStorage.setItem(key,id);setPending(id)
  try{await rpc('website_scan_decide',{...base,p_request:id,p_choices:choices})}
  catch(e){if(/^(22|23|40|42|P0)/.test(e.code||'')){sessionStorage.removeItem(key);setPending('')}throw e}
  sessionStorage.removeItem(key);if(alive.current){setPending('');setBatch(null);await status();await review(0);onApplied()}
 }
 async function recover(){const receipt=await rpc('website_scan_receipt',{...base,p_request:pending})
  if(!receipt)throw Error('Original batch is not visible. Check again before applying another batch.')
  sessionStorage.removeItem(key);setPending('');setBatch(null);await status();onApplied()
 }
 return <section aria-label="Resumable website discovery" className="space-y-3"><h4>Large-site discovery</h4>
 <p>Progress is saved after each chunk. You can close this view and resume from the saved scan.</p>
 <button className={button} disabled={busy||!domain.trim()} onClick={()=>run(start)}>Start resumable scan</button>
 <label>Saved scans <select value={job} disabled={busy} onChange={e=>choose(e.target.value)}><option value="">Select a scan</option>{jobs.map(s=><option key={s.id} value={s.id}>{s.origin} · {new Date(s.created_at).toLocaleString()}</option>)}</select></label>
 {state&&<><p role="status">{state.remaining?'Discovery in progress':state.failed||state.limited||state.excluded?'Discovery ended with gaps':'Discovery queue exhausted'} · {state.discovered} pages discovered · {state.remaining} requests remaining · {state.failed} failed · {state.excluded} excluded or unavailable{state.limited?' · Discovery cap reached':''}</p>
 <p>{state.reviewed} reviewed · {state.applied} applied · {state.discovered-state.reviewed} awaiting review</p>
 {busy?<button className={button} onClick={()=>{stop.current=true}}>Pause after current chunk</button>:<><button className={button} disabled={!state.remaining} onClick={()=>run(resume)}>Resume discovery</button>{state.retryable>0&&<button className={button} onClick={()=>run(async()=>{await rpc('website_scan_retry',{...base,p_revision:state.revision});await status()})}>Retry failed reads</button>}</>}
 {pending?<button className={button} disabled={busy} onClick={()=>run(recover)}>Check original batch</button>:<button className={button} disabled={busy||!!state.remaining||state.reviewed===state.discovered} onClick={()=>run(()=>review(0))}>Review discovered pages</button>}
 </>}
 {batch&&!pending&&<fieldset className="space-y-2" disabled={busy}><legend>Review batch · up to 25 pages</legend>{batch.unmatched>0&&<p>{batch.unmatched} spreadsheet rows have no exact discovered URL match.</p>}
 {batch.candidates.map((c,i)=><article key={c.id+c.meta.url} className="border p-2"><label><input type="checkbox" checked={c.selected} disabled={!['new','changed'].includes(c.state)} onChange={e=>edit(i,{selected:e.target.checked})}/> {c.state} · {c.meta.url}</label><p>{c.reason||c.meta.h1} · HTTP {c.meta.status}{c.wpId?' · WordPress #'+c.wpId:''}</p><p>{c.meta.description} · Canonical: {c.meta.canonical||'Not declared'}</p>
 <label>Inventory title <input disabled={!c.selected} maxLength={240} value={c.title} onChange={e=>edit(i,{title:e.target.value})}/></label>
 {c.additions.map((t,j)=><label key={j}><input type="checkbox" checked={t.selected} disabled={!c.selected||t.state!=='new'} onChange={e=>edit(i,{additions:c.additions.map((k,n)=>n===j?{...k,selected:e.target.checked}:k)})}/>{t.state} · {t.query} · {t.role} · {t.intent} · {t.locale}</label>)}</article>)}
 <button className={button} disabled={!approvedRows(batch.candidates).length} onClick={()=>run(()=>decide(false))}>Apply selected batch</button>
 <button className={button} disabled={!batch.candidates.some(c=>!c.selected)} onClick={()=>run(()=>decide(true))}>Mark unchecked pages skipped</button>
 {offset>0&&<button className={button} onClick={()=>run(()=>review(Math.max(0,offset-25)))}>Previous review batch</button>}
 {offset+25<state.discovered-state.reviewed&&<button className={button} onClick={()=>run(()=>review(offset+25))}>Next review batch</button>}</fieldset>}
 {error&&<p role="alert">{error}</p>}</section>
}
