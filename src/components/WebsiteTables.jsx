import BulkKeywordReview from './BulkKeywordReview.jsx'
import {eligibleKeyword} from '../data/bulkKeywordReview.js'
import {useAuth} from '../context/AuthContext.jsx'
import {useEffect,useState} from 'react'
import {supabase} from '../lib/supabase.js'
import {assessQuery} from '../data/keywordAssessment.js'
const table='w-full text-left text-sm [&_th]:p-2 [&_td]:p-2 [&_td]:align-top [&_tr]:border-b [&_tr]:border-[var(--anka-line)]'
function Filter({label,value,options,onChange}){
 return <label>{label} <select value={value} onChange={e=>onChange(e.target.value)}>{options.map(([v,text])=><option key={v} value={v}>{text}</option>)}</select></label>
}
function Pager({offset,total,onChange,label}){
 return <div className="flex flex-wrap items-center gap-3"><p role="status">{total?offset+1:0}–{Math.min(offset+25,total)} of {total} {label}</p><button type="button" disabled={!offset} onClick={()=>onChange(offset-25)}>Previous {label}</button><button type="button" disabled={offset+25>=total} onClick={()=>onChange(offset+25)}>Next {label}</button></div>
}
export default function WebsiteTables({workspace,refresh,onOpen}){
 const {project}=workspace
 const [tableRevision,updateTable]=useState(0)
 const [view,setView]=useState('pages'),[search,setSearch]=useState(''),[sort,setSort]=useState('title'),[attention,setAttention]=useState('all')
 const [filter,setFilter]=useState('all'),[owner,setOwner]=useState(''),[offset,setOffset]=useState(0),[expanded,setExpanded]=useState(null),[data,setData]=useState(null),[error,setError]=useState('')
 const owners=[...new Map([...(workspace.engagementWorkItems||[]),...(workspace.projectTasks||[])].filter(w=>w.owner?.id).map(w=>[w.owner.id,w.owner.name])).entries()]
 const change=(fn,v)=>{setOffset(0);setExpanded(null);fn(v)}
 useEffect(()=>{
  let active=true;setData(null);setError('');setSelected([]);setExpanded(null)
  const timer=setTimeout(()=>{
   supabase.rpc('website_pages_table',{p_org:project.organization_id,p_project:project.id,p_search:search.trim(),p_filter:filter,p_owner:owner||null,p_offset:offset,p_sort:sort,p_attention:attention})
    .then(({data,error})=>{if(active){setData(data);setError(error?.message||'')}}).catch(e=>{if(active)setError(e.message)})
  },150)
  return()=>{active=false;clearTimeout(timer)}
 },[project.id,project.organization_id,search,sort,attention,filter,owner,offset,refresh,tableRevision])
 const expand=p=><button type="button" className="workspace-button" aria-expanded={expanded===p.id} onClick={()=>setExpanded(expanded===p.id?null:p.id)}>Keywords for {p.title}</button>
 const group=p=><KeywordGroup key={p.id+':'+refresh} project={project} page={p} onOpen={onOpen} onUpdated={()=>updateTable(n=>n+1)}/>
 return <section aria-label="Website tables" className="min-w-0 space-y-3">
 <div className="flex gap-2">{['pages','keywords'].map(v=><button type="button" className="workspace-button" key={v} aria-pressed={view===v} onClick={()=>{setView(v);setExpanded(null)}}>{v==='pages'?'Pages':'Keywords'}</button>)}</div>
 <div className="flex flex-wrap gap-3">
 <label>Search pages or keywords <input value={search} maxLength={240} onChange={e=>change(setSearch,e.target.value)}/></label>
 <Filter label="Sort pages" value={sort} options={Object.entries({title:'Title A–Z',url:'URL A–Z',clicks:'Clicks, highest first',impressions:'Impressions, highest first',keywords:'Selected keywords'})} onChange={v=>change(setSort,v)}/>
 <Filter label="Evidence" value={attention} options={Object.entries({all:'All pages',unassigned:'No selected keywords',observed:'Observed queries',missing:'No observed queries'})} onChange={v=>change(setAttention,v)}/>
 <Filter label="Work filter" value={filter} options={Object.entries({all:'All pages',open:'Open Work',seo:'SEO Work',overdue:'Overdue Work',unlinked:'No linked Work'})} onChange={v=>change(setFilter,v)}/>
 <Filter label="Work owner" value={owner} options={[['','All owners'],...owners]} onChange={v=>change(setOwner,v)}/>
 </div>
 {error&&<p role="alert">{error}</p>}
 {!data&&!error&&<p role="status">Loading pages…</p>}
 {data&&<><p>{data.start?data.start+' to '+data.end:'No completed reporting period.'}</p>
 {view==='pages'?<><div className="overflow-x-auto" role="region" aria-label="Website page table" tabIndex={0}><table className={table}><caption className="text-left font-semibold">Website pages</caption>
 <thead><tr>{['Page','URL','Selected keywords','Clicks','Impressions','Attention','Actions'].map(v=><th scope="col" key={v}>{v}</th>)}</tr></thead>
 <tbody>{data.items.map(p=><tr key={p.id}><th scope="row">{p.title}</th><td className="max-w-64 break-words">{p.url||p.path}</td><td>{p.keywords}</td><td>{p.clicks??'—'}</td><td>{p.impressions??'—'}</td><td>{!p.observed?'No observed query evidence':!p.keywords?'Review observed queries':'—'}</td>
 <td><button type="button" className="workspace-button" onClick={()=>onOpen(p.id)}>Open {p.title}</button>{expand(p)}</td></tr>)}</tbody></table></div>
 {expanded&&data.items.filter(p=>p.id===expanded).map(group)}</>:<div className="space-y-2">{data.items.map(p=><section key={p.id} className="rounded-lg border border-[var(--anka-line)] p-3"><h3>{expand(p)}</h3><p className="break-words">{p.url||p.path} · {p.keywords} selected keywords</p>{expanded===p.id&&group(p)}</section>)}</div>}
 {!data.total&&<p>No pages match these filters.</p>}
 <Pager offset={offset} total={data.total} onChange={setOffset} label="pages"/>
 </>}
 </section>
}
function KeywordGroup({project,page,onOpen,onUpdated}){
 const {user}=useAuth()
 const [selected,setSelected]=useState([]),[reviewing,setReviewing]=useState(false),[revision,reload]=useState(0)
 const recoveryKey='anka:keyword-review:'+user?.id+':'+project.organization_id+':'+project.id+':'+page.id
 const [search,setSearch]=useState(''),[sort,setSort]=useState('clicks'),[state,setState]=useState('all'),[offset,setOffset]=useState(0),[data,setData]=useState(null),[error,setError]=useState('')
 const change=(fn,v)=>{setOffset(0);fn(v)}
 useEffect(()=>{try{if(sessionStorage.getItem(recoveryKey))setReviewing(true)}catch{}},[recoveryKey])
 useEffect(()=>{
  let active=true;setData(null);setError('');setSelected([])
  const timer=setTimeout(()=>{
   supabase.rpc('website_keywords_table',{p_org:project.organization_id,p_project:project.id,p_page:page.id,p_search:search,p_state:state,p_sort:sort,p_offset:offset})
    .then(({data,error})=>{if(active){setData(data);setError(error?.message||'')}}).catch(e=>{if(active)setError(e.message)})
  },150)
  return()=>{active=false;clearTimeout(timer)}
 },[project.id,project.organization_id,page.id,search,sort,state,offset,revision])
 return <section aria-label={'Keywords for '+page.title} className="min-w-0 space-y-3 p-2"><h3>{page.title} keywords</h3>
 <fieldset disabled={reviewing} className="flex flex-wrap gap-3"><label>Search this page’s keywords <input maxLength={240} value={search} onChange={e=>change(setSearch,e.target.value)}/></label>
 <Filter label="Decision" value={state} options={['all','assigned','selected','dismissed','suggested'].map(v=>[v,v])} onChange={v=>change(setState,v)}/>
 <Filter label="Sort keywords" value={sort} options={['clicks','impressions','position','query'].map(v=>[v,v])} onChange={v=>change(setSort,v)}/></fieldset>
 {error&&<p role="alert">{error}</p>}{!data&&!error&&<p role="status">Loading keywords…</p>}
 {data&&<><p>{data.start?data.start+' to '+data.end:'No observed reporting period.'}</p>
 <div className="overflow-x-auto" role="region" aria-label={'Keyword table for '+page.title} tabIndex={0}><table className={table}><caption className="text-left">{page.url||page.path}</caption>
 <thead><tr>{['Select','Keyword','Role','Decision','Clicks','Impressions','Average position','Review flags'].map(v=><th scope="col" key={v}>{v}</th>)}</tr></thead>
 <tbody>{data.items.map(row=>{
  const assessment=row.impressions!==null?assessQuery(row,data.page,data.source,project.name):null
  return <tr key={row.query}><td><input type="checkbox" aria-label={"Select "+row.query} disabled={reviewing||!eligibleKeyword(row)} checked={selected.includes(row.query)} onChange={e=>setSelected(e.target.checked?[...selected,row.query]:selected.filter(q=>q!==row.query))}/></td><th scope="row">{row.query}</th><td>{row.roles||(assessment?'Suggested '+assessment.role:'Unassigned')}</td><td>{row.state}</td><td>{row.clicks??'—'}</td><td>{row.impressions??'—'}</td><td>{row.position?.toFixed(1)??'—'}</td><td>{assessment?<><p>{assessment.explanation}</p>{assessment.flags.map(f=><p key={f}>{f}</p>)}</>:'No current query evidence'}</td></tr>
 })}</tbody></table></div>
 {!data.total&&<p>No keywords match these filters.</p>}
 {!reviewing&&<><label><input type="checkbox" checked={data.items.some(eligibleKeyword)&&data.items.filter(eligibleKeyword).every(row=>selected.includes(row.query))} onChange={e=>setSelected(e.target.checked?data.items.filter(eligibleKeyword).map(row=>row.query):[])}/> Select all eligible suggestions on this visible page</label>
 <button type="button" disabled={!selected.length} onClick={()=>setReviewing(true)}>Review {selected.length} selected rows</button>
 <Pager offset={offset} total={data.total} onChange={setOffset} label="keywords"/></>}
 {reviewing&&<BulkKeywordReview key={recoveryKey} recoveryKey={recoveryKey} project={project} page={page} items={data.items.filter(row=>selected.includes(row.query))}
 onClose={()=>{setReviewing(false);reload(n=>n+1);onUpdated()}} onSaved={()=>{setReviewing(false);reload(n=>n+1);onUpdated()}}/>}
 <button type="button" className="workspace-button" onClick={()=>onOpen(page.id)}>Review and accept keywords on {page.title}</button>
 </>}
 </section>
}
