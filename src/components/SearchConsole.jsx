import {useEffect,useRef,useState} from 'react'
import {supabase} from '../lib/supabase.js'


export function SearchConsoleSettings({workspace}){
 const project=workspace.project
 const [property,setProperty]=useState(''),[choices,setChoices]=useState([]),[selection,setSelection]=useState('')
 const [settings,setSettings]=useState(null)
 const [busy,setBusy]=useState(false),[notice,setNotice]=useState('')
 const alive=useRef(true),flight=useRef(false)
 useEffect(()=>{alive.current=true;return()=>{alive.current=false}},[])
 async function act(fn){
  if(flight.current)return
  flight.current=true;setBusy(true);setNotice('')
  try{await fn()}catch(e){if(alive.current)setNotice(e.message)}finally{flight.current=false;if(alive.current)setBusy(false)}
 }
 async function connect(){
  const {data,error}=await supabase.functions.invoke('google-oauth',{body:{action:'start',provider:'google_search_console',public_config:{site_url:property.trim()},display_name:project.name+' Search Console',department_ids:['development'],return_path:window.location.pathname+'?tab=overview'}})
  if(error||!data?.authorize_url)throw Error('Google OAuth could not start. Check administrator access and server OAuth configuration.')
  window.location.assign(data.authorize_url)
 }
 async function load(){
  const {data,error}=await supabase.rpc('gsc_settings',{p_org:project.organization_id,p_project:project.id})
  if(error)throw error
  if(alive.current){setSettings(data);setChoices(data.choices);setSelection(data.choices[0]?.connection||'');if(!data.choices.length)setNotice('Connect Google with access to the exact property.')}
 }
 async function bind(){
  const choice=choices.find(x=>x.connection===selection)
  const {data,error}=await supabase.functions.invoke('project-search-console',{body:{action:'bind',org:project.organization_id,project:project.id,connection:selection,site:choice.site,revision:settings.revision}})
  if(error)throw Error('Could not verify and bind this Google property.')
  if(alive.current){setSettings(data);setNotice('Property verified and bound.')}
 }
 async function sync(){
  let phase
  do{
   const {data,error}=await supabase.functions.invoke('project-search-console',{body:{org:project.organization_id,project:project.id,binding:settings.binding}})
   if(error){const body=await error.context?.json?.().catch(()=>null);throw Error(body?.error||'Sync interrupted. Resume to continue.')}
   phase=data.phase
   if(alive.current)setNotice(phase==='done'?'Import complete. Open a Website page to view performance.':'Importing '+phase+'…')
  }while(alive.current&&phase!=='done')
 }
 return <details className="workspace-card p-3"><summary>Google Search Console</summary>
 <fieldset disabled={busy}><label>Exact Search Console property <input value={property} onChange={e=>setProperty(e.target.value)} placeholder="sc-domain:example.com"/></label>
 <button type="button" disabled={!property.trim()} onClick={()=>act(connect)}>Connect Google read-only</button></fieldset>
 <fieldset disabled={busy}><button type="button" onClick={()=>act(load)}>Load authorized properties</button>
 {choices.length>0&&<><select aria-label="Authorized property" value={selection} onChange={e=>setSelection(e.target.value)}>{choices.map(x=><option key={x.connection} value={x.connection}>{x.label} · {x.site}</option>)}</select>
 <button type="button" onClick={()=>act(bind)}>Verify and bind property</button></>}
 {settings?.binding&&<><p>Bound property · {settings.site}</p><button type="button" onClick={()=>act(sync)}>Import or resume 90 days</button></>}</fieldset> {notice&&<p role="status">{notice}</p>}</details>
}

export function SearchConsolePage({project,page}){
 const [report,setReport]=useState(undefined),[error,setError]=useState(''),[offset,setOffset]=useState(0)
 useEffect(()=>{
  let current=true
  setReport(undefined);setError('')
  supabase.rpc('gsc_page_performance',{p_org:project.organization_id,p_project:project.id,p_page:page.id,p_offset:offset})
   .then(({data,error})=>{if(current){setReport(data);setError(error?.message||'')}})
  return()=>{current=false}
 },[project.organization_id,project.id,page.id,offset])
 const cells=row=><><td>{row.clicks}</td><td>{row.impressions}</td><td>{(row.ctr*100).toFixed(2)}%</td><td>{row.position.toFixed(1)}</td></>
 return <section className="workspace-card p-3"><h4>Google organic search</h4>
 {error?<p role="alert">{error}</p>:report===undefined?<p>Loading performance…</p>:!report?<p>No completed Search Console import for this project.</p>:<>
 <p>{report.site} · {report.start} to {report.end} · Last sync {new Date(report.synced).toLocaleString()}</p>
 <p>Google omits some queries for privacy. Page totals include traffic from those queries.</p><div className="overflow-x-auto"><table><thead><tr>{['Page or query','Clicks','Impressions','CTR','Average position'].map(label=><th key={label}>{label}</th>)}</tr></thead>
 <tbody>{report.totals&&<tr><th>Page total</th>{cells(report.totals)}</tr>}{report.queries.slice(0,50).map(row=><tr key={row.query}><th>{row.query}</th>{cells(row)}</tr>)}</tbody></table></div>
 {!report.totals&&<p>Google returned no page total for this URL.</p>}{!report.queries.length&&<p>No reported queries for this URL.</p>}
 {offset>0&&<button onClick={()=>setOffset(offset-50)}>Previous queries</button>}{report.queries.length>50&&<button onClick={()=>setOffset(offset+50)}>Next queries</button>}
 </>}</section>
}
