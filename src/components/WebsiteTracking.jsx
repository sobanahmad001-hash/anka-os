import {useEffect,useState} from 'react'
import {supabase} from '../lib/supabase.js'
import {compareDailyTracking} from '../../supabase/functions/_shared/websiteTrackingDays.js'
import {pageSnapshotDiff} from '../../supabase/functions/_shared/websiteObservedChanges.js'

export function WebsiteTrackingOverview({project}){return <TrackingOverview key={project.organization_id+':'+project.id} project={project}/>}
function TrackingOverview({project}){
 const [data,setData]=useState(null),[error,setError]=useState('')
 useEffect(()=>{
  let active=true
  supabase.rpc('website_tracking_overview',{p_org:project.organization_id,p_project:project.id}).then(r=>{
   if(!active)return
   if(r.error)setError('Website tracking summary unavailable.');else setData(r.data)
  }).catch(()=>{if(active)setError('Website tracking summary unavailable.')})
  return()=>{active=false}
 },[project.id,project.organization_id])
 return <section className="workspace-card p-4 space-y-2" aria-label="Website tracking summary"><h3>Website tracking</h3>
 {error?<p role="alert">{error}</p>:!data?<p role="status">Loading tracking evidence…</p>:<>
 <p>Daily Search Console: {data.search?.enabled?'Enabled':'Paused or not configured'} · {data.search?.state||data.search?.job?.state||'No daily refresh recorded'}</p>
 <p>Last successful refresh: {data.search?.lastSuccess||'Unknown'} · Data through: {data.search?.dataThrough||'Unknown'}</p>
 <p>Page checks: {data.pageChecksEnabled?'Enabled':'Paused or not configured'} · {data.pages.fresh} of {data.pages.total} pages successfully observed in the last two days.</p>
 <p>{data.pages.failed} pages with an unavailable or excluded latest check · {data.pages.changedLast7Days} pages with changes detected in the last seven days.</p>
 <p>Latest page observation: {data.pages.lastObserved||'Unknown'} · Next scheduled page check: {data.pages.nextCheck||'Not scheduled'}</p>
 <p>Observed page content does not certify indexing or complete SEO review. Missing evidence remains unknown.</p>
 </>}</section>
}

export function WebsiteTrackingSettings({project}){return <TrackingSettings key={project.organization_id+project.id} project={project}/>}
function TrackingSettings({project}){
 const [status,setStatus]=useState(null),[choice,setChoice]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false)
 async function load(){const r=await supabase.rpc('website_tracking_status',{p_org:project.organization_id,p_project:project.id});if(r.error)throw r.error;setStatus(r.data);setChoice('0')}
 useEffect(()=>{setStatus(null);setError('')},[project.id])
 async function action(body){
  setBusy(true);setError('')
  try{const r=await supabase.functions.invoke('website-tracking',{body:{org:project.organization_id,project:project.id,...body}});if(r.error){const message=await r.error.context?.json?.().catch(()=>null);throw Error(message?.error||r.error.message)}await load()}
  catch(e){setError(e.message)}finally{setBusy(false)}
 }
 return <section aria-label="Scheduled website tracking" className="workspace-card p-3 space-y-2"><h4>Scheduled website tracking</h4>
 {error&&<p role="alert">{error}</p>}<fieldset disabled={busy}>
 <button type="button" onClick={()=>load().catch(e=>setError(e.message))}>Load tracking settings</button>
 {status&&<><p>Daily search tracking: {status.enabled?'Enabled':'Paused or not configured'} · {status.state||status.job?.state||'No completed refresh'}</p>
 <p>Last success: {status.lastSuccess||'Not yet recorded'} · Data through: {status.dataThrough||'Unknown'}</p>
 {!!status.choices?.length&&<><label>Mapped engagement <select value={choice} onChange={e=>setChoice(e.target.value)}>{status.choices.map((c,i)=><option key={c.engagement+c.department} value={i}>{c.department} · {c.engagement}</option>)}</select></label>
 <button type="button" onClick={()=>action({action:'configure',enabled:true,...status.choices[Number(choice)]})}>Enable or reconnect daily search tracking</button></>}
 {!status.choices?.length&&<p>Map the connected Search Console property to this project’s engagement in Integrations to enable tracking.</p>}
 {status.enabled&&<button type="button" onClick={()=>action({action:'configure',enabled:false})}>Pause search tracking</button>}</>}
 <button type="button" onClick={()=>action({action:'observations',enabled:true})}>Enable daily page checks</button>
 <button type="button" onClick={()=>action({action:'observations',enabled:false})}>Pause page checks</button>
 </fieldset></section>
}
export default function WebsiteTrackingPanel({project,page}){return <TrackingPanel key={[project.organization_id,project.id,page.id].join(':')} {...{project,page}}/>}
function TrackingPanel({project,page}){
 const [data,setData]=useState(null),[error,setError]=useState(''),[window,setWindow]=useState(7),[revision,reload]=useState(0),[busy,setBusy]=useState(false),[notice,setNotice]=useState('')
 useEffect(()=>{
  let active=true;setData(null);setError('')
  Promise.all([supabase.rpc('website_tracking_status',{p_org:project.organization_id,p_project:project.id,p_page:page.id}),supabase.rpc('website_observation_history',{p_org:project.organization_id,p_project:project.id,p_page:page.id})])
   .then(([tracking,observations])=>{if(!active)return;if(tracking.error||observations.error)throw Error('Tracking evidence unavailable');setData({tracking:tracking.data,observations:observations.data})})
   .catch(e=>{if(active)setError(e.message)})
  return()=>{active=false}
 },[project.id,project.organization_id,page.id,revision])
 const t=data?.tracking,o=data?.observations,comparison=t?.dataThrough?compareDailyTracking({days:t.days||[],through:t.dataThrough,window}):null
 async function recheck(){
  if(busy)return
  setBusy(true);setError('');setNotice('')
  try{const r=await supabase.functions.invoke('website-tracking',{body:{action:'recheck',org:project.organization_id,project:project.id,page:page.id}})
   if(r.error)throw Error('Could not queue recheck. Verify access and enable page checks.')
   setNotice(r.data?.queued?'Page check queued.':'A check is already running, the page is awaiting its first scheduled check, or the five-minute cooldown is active.');reload(n=>n+1)
  }catch(e){setError(e.message)}finally{setBusy(false)}
 }
 return <section aria-label="Website tracking history" className="workspace-card p-3 space-y-3"><h4>Tracking and live page changes</h4>
 <button type="button" onClick={()=>reload(n=>n+1)}>Refresh stored tracking</button>{error&&<p role="alert">{error}</p>}
 <button type="button" disabled={busy} onClick={recheck}>Recheck page after fixes</button>{notice&&<p role="status">{notice}</p>}
 {t&&<><p>Last successful search refresh: {t.lastSuccess||'Unknown'} · Data through: {t.dataThrough||'Unknown'} · {t.state||t.job?.state||'Not configured'}</p>
 <p>Next job attempt: {t.job?.next_attempt_at||'Not scheduled yet'}</p>
 <label>Compare <select value={window} onChange={e=>setWindow(Number(e.target.value))}><option value={7}>7 days</option><option value={28}>28 days</option></select></label>
 {comparison&&<p>{comparison.current.state==='available'&&comparison.previous.state==='available'?`Clicks ${comparison.current.clicks} vs ${comparison.previous.clicks}; impressions ${comparison.current.impressions} vs ${comparison.previous.impressions}; position improvement ${comparison.positionChange??'Unknown'}`:`Incomplete history: ${comparison.current.availableDays}/${window} current days, ${comparison.previous.availableDays}/${window} previous days. Missing values are unknown.`}</p>}</>}
 {o&&<><p>Last page check: {o.current?.last_checked||'Not checked'} · Next check: {o.current?.next_check||'Not scheduled'} · {o.current?.last_state||'Unknown'}</p>
 {o.current?.last_changed&&<p>Recheck required · Live change detected {o.current.last_changed}</p>}
 {o.current?.latest_snapshot&&<details><summary>Latest retained page observation</summary><p>Title: {o.current.latest_snapshot.title}</p><p>Description: {o.current.latest_snapshot.description||'Not recorded'}</p><p>H1: {o.current.latest_snapshot.h1||'Not recorded'}</p><p>Canonical: {o.current.latest_snapshot.canonical||'Not recorded'}</p></details>}
 {(o.history||[]).map(h=><details key={h.id}><summary>{h.detected_at} · {h.changed?'Change detected':'Baseline recorded'} · {h.snapshot.state}</summary><p>Changed fields: {pageSnapshotDiff(h.previous_snapshot,h.snapshot).fields.join(', ')||'Initial observation'}</p><p>Detection time is when Anka observed this result, not the website’s edit time.</p><p>Previous title: {h.previous_snapshot?.title||'Unknown'}</p><p>Observed title: {h.snapshot.title||'Unavailable'}</p>{h.snapshot.content&&<p className="whitespace-pre-wrap">{h.snapshot.content}</p>}</details>)}</>}
 </section>
}
