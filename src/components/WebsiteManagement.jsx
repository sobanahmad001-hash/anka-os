import WebsiteInventoryBrowser, {PageWork} from './WebsiteInventoryBrowser.jsx'
import WebsiteImport, {WebsiteImportSource} from './WebsiteImport.jsx'
import {useEffect,useState} from 'react'
import {supabase} from '../lib/supabase.js'
import {comparisonPeriod,pageRankingReport} from '../data/websitePageRankings.js'

const emptyTarget=()=>({query:'',role:'supporting',intent:'',locale:''})
const effective=p=>p.mode==='undecided'?p.sourceTargets.map(t=>({query:t.source.term,intent:t.source.intent||'',locale:t.source.locale||'',role:t.role})):p.targets
const button='workspace-button'
const field='block w-full rounded-lg border border-[var(--anka-line)] bg-[var(--anka-surface)] p-2'
const fmt=(v,d=1)=>v==null?'—':Number(v).toLocaleString(undefined,{maximumFractionDigits:d})
function Metrics({rows}){
  if(!rows.length)return <p>No matching queries.</p>
  return <div className="overflow-x-auto"><table><thead><tr>{['Query / observed URL','Period','Avg. position','Impressions','Clicks','CTR','Position change'].map(t=><th key={t} className="p-2">{t}</th>)}</tr></thead><tbody>{rows.flatMap((r,i)=>['current','previous'].map(k=><tr key={i+k}><td className="p-2">{r.query}<br/>{r.page}</td><td>{k==='current'?'Selected':'Previous'}</td>{r[k]?<><td>{fmt(r[k].position)}</td><td>{fmt(r[k].impressions,0)}</td><td>{fmt(r[k].clicks,0)}</td><td>{r[k].ctr==null?'—':fmt(r[k].ctr*100,2)+'%'}</td></>:<td colSpan="4">No data</td>}<td>{k==='current'?fmt(r.movement):'—'}</td></tr>))}</tbody></table></div>
}
function Rankings({page,project}){
  const ago=n=>new Date(Date.now()-n*86400000).toISOString().slice(0,10)
  const [filters,setFilters]=useState({start:ago(30),end:ago(3),country:'',device:''}),[report,setReport]=useState(null),[busy,setBusy]=useState(false),[status,setStatus]=useState('')
  async function measure(){
    setBusy(true);setReport(null);setStatus('')
    try{
      const period=comparisonPeriod(filters.start,filters.end)
      const {data,error}=await supabase.functions.invoke('website-rankings',{body:{organization:project.organization_id,project:project.id,page:page.id,...filters}})
      if(error)throw Error('Could not load the project Search Console report.')
      if(data.state!=='ready'){setStatus(({unconfigured:'Search Console is not configured for this project.',outside_property:'The intended URL is outside the configured property.',incomplete:'Incomplete provider report. Narrow the dates and try again.'})[data.state]||'Search Console data is unavailable.');return}
      setReport({...pageRankingReport({rows:data.rows,url:page.url,targets:effective(page),period,...filters}),period})
    }catch(e){setStatus(e.message)}finally{setBusy(false)}
  }
  return <section className="space-y-3"><h4>Search Console rankings</h4><p>Compare the exact intended URL and query. Positive position change means improved rank.</p><fieldset disabled={busy} className="grid gap-2 sm:grid-cols-2">{Object.keys(filters).map(k=><label key={k}>{({start:'Start date',end:'End date',country:'Country (provider code)',device:'Device (provider value)'})[k]}<input className={field} type={['start','end'].includes(k)?'date':'text'} value={filters[k]} placeholder={k==='country'||k==='device'?'All':''} onChange={e=>{setFilters({...filters,[k]:e.target.value});setReport(null);setStatus('')}}/></label>)}<button className={button} onClick={measure}>Load rankings</button></fieldset>{busy&&<p>Loading rankings…</p>}{status&&<p role="status">{status}</p>}{report&&<><p>{report.period.start} – {report.period.end} compared with {report.period.previousStart} – {report.period.previousEnd}</p>{[['Assigned queries',report.targets],['Discovered queries',report.discovered],['Other observed ranking URLs',report.otherUrls]].map(([label,rows])=><section key={label}><h5>{label}</h5><Metrics rows={rows}/></section>)}</>}</section>
}
function Editor({page,onSave,onClose,busy}){
  const [v,set]=useState(()=>({...page,state:page.state||'existing'}))
  const update=(k,val)=>set({...v,[k]:val})
  const target=(i,k,val)=>update('targets',v.targets.map((t,j)=>j===i?{...t,[k]:val}:t))
  return <form className="space-y-3" onSubmit={e=>{e.preventDefault();onSave(v)}}><fieldset disabled={busy} className="grid gap-3"><label>Page title<input className={field} required maxLength={240} value={v.title} onChange={e=>update('title',e.target.value)}/></label><label>Page path<input className={field} required readOnly={!!v.sourceId} value={v.path} placeholder="/about" onChange={e=>update('path',e.target.value)}/></label><label>Intended URL<input className={field} type="url" value={v.url} required={v.mode==='targets'} onChange={e=>update('url',e.target.value)}/></label><label>Inventory type<select className={field} value={v.state} onChange={e=>update('state',e.target.value)}><option value="new">New page</option><option value="existing">Existing page</option></select></label><label>Page brief<textarea className={field} rows={5} maxLength={6000} value={v.brief} onChange={e=>update('brief',e.target.value)}/></label><label>Organic targeting<select className={field} value={v.mode} onChange={e=>{const mode=e.target.value;set({...v,mode,targets:mode==='targets'?(effective(v).length?effective(v):[{...emptyTarget(),role:'primary'}]):[]})}}><option value="undecided">{v.sourceTargets.length?'Use saved strategy targets':'Undecided'}</option><option value="targets">Manual targets</option><option value="none">No organic target</option></select></label>
  {v.mode==='targets'&&<>{v.targets.map((t,i)=><fieldset className="grid gap-2 sm:grid-cols-2" key={i}><legend>Keyword {i+1}</legend>{['query','intent','locale'].map(k=><label key={k}>{({query:'Keyword',intent:'Search intent',locale:'Locale'})[k]}<input required className={field} value={t[k]} onChange={e=>target(i,k,e.target.value)}/></label>)}<label>Role<select className={field} value={t.role} onChange={e=>target(i,'role',e.target.value)}><option value="primary">Primary</option><option value="supporting">Supporting</option></select></label><button type="button" className={button} onClick={()=>update('targets',v.targets.filter((_,j)=>j!==i))}>Remove keyword</button></fieldset>)}<button type="button" className={button} onClick={()=>update('targets',[...v.targets,emptyTarget()])}>Add keyword</button></>}
  <div><button className={button} type="submit">Save page</button> <button type="button" className={button} onClick={onClose}>Cancel</button></div></fieldset></form>
}
export default function WebsiteManagement({project,workspace}){
  const [page,setPage]=useState(null),[edit,setEdit]=useState(null),[selected,setSelected]=useState(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[refresh,reload]=useState(0)
  const [importing,setImporting]=useState(false)
  const org=project.organization_id,id=project.id
  useEffect(()=>{
    let active=true;setPage(null);if(!selected)return
    supabase.rpc('website_page_index',{p_org:org,p_project:id,p_page:selected}).then(({data,error:e})=>{
      if(active){if(e)setError(e.message);else setPage(data.items[0]||null)}
    });return()=>{active=false}
  },[id,org,selected,refresh])
  async function save(v){
    if(busy)return
    setBusy(true);setError('')
    try{const {error:e}=await supabase.rpc('save_website_manual_page',{p_org:org,p_project:id,p_id:v.id,p_revision:v.revision,p_source:v.sourceId,p_page:v});if(e)throw e
      setEdit(null);setSelected(v.id);reload(r=>r+1)
    }catch(e){setError(e.message)}finally{setBusy(false)}
  }

  return <section aria-label="Website management" className="workspace-card p-4 space-y-4"><h2>Website page inventory</h2>{error&&<p role="alert">{error}</p>}
  {importing?<WebsiteImport project={project} onClose={()=>setImporting(false)} onApplied={()=>reload(r=>r+1)}/>:edit?<Editor key={edit.id} page={edit} onSave={save} onClose={()=>setEdit(null)} busy={busy}/>:<><button className={button} onClick={()=>setImporting(true)}>Import existing website</button> <button className={button} onClick={()=>setEdit({id:crypto.randomUUID(),sourceId:null,title:'',path:'',url:'',state:'new',brief:'',mode:'undecided',targets:[],sourceTargets:[],revision:0})}>Add page</button><WebsiteInventoryBrowser workspace={workspace} refresh={refresh} onOpen={setSelected}/>
{page&&<section className="space-y-3"><h3>{page.title}</h3><WebsiteImportSource key={page.id} project={project} pageId={page.id}/><p>{page.url||page.path}</p><h4>Page brief</h4><p className="whitespace-pre-wrap">{page.brief||'No manual brief recorded.'}</p><button className={button} onClick={()=>setEdit(page)}>Edit page and targets</button><h4>Page keyword assignments</h4><Assignments pages={[page]}/><PageWork page={page} workspace={workspace} onChange={()=>reload(r=>r+1)}/><Rankings key={page.id+':'+page.revision} page={page} project={project}/></section>}
  </>}</section>
}
function Assignments({pages}){
  return <ul>{pages.flatMap(p=>{const terms=effective(p);return terms.length?terms.map((t,i)=><li key={p.id+i}>{t.query} · {t.role} · {t.intent||'Intent unspecified'} · {t.locale||'Locale unspecified'} · {p.url||p.path}</li>):[<li key={p.id}>{p.url||p.path} · {p.mode==='none'?'No organic target':'Targets undecided'}</li>]})}</ul>
}
