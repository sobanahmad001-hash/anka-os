import {useEffect,useState} from 'react'
import {Link} from 'react-router-dom'
import {readSharedWork} from '../data/sharedProjectWork.js'

export default function SharedProjectWork({workspace,searchParams,setSearchParams,onOpenService}){
 const [rows,setRows]=useState(null),[error,setError]=useState('')
 useEffect(()=>{
   const controller=new AbortController()
   setRows(null);setError('')
   readSharedWork(workspace,controller.signal).then(items=>{if(!controller.signal.aborted)setRows(items)})
     .catch(e=>{if(!controller.signal.aborted)setError(e.message)})
   return ()=>controller.abort()
 },[workspace])
 const view=searchParams.get('workView')||'board',group=searchParams.get('serviceGroup')||''
 const month=searchParams.get('workMonth')||new Date().toISOString().slice(0,7)
 function change(key,value){const next=new URLSearchParams(searchParams);next.set(key,value);setSearchParams(next,{replace:true})}
 const cards=(rows||[]).filter(c=>!group||c.group===group)
 const entry=c=><li className="workspace-card p-3" key={c.key}><Link className="font-semibold underline" to={c.href}>{c.title}</Link><p>{c.group} · {c.status} · {c.owner||'Unassigned'} · {c.day||'No date'}</p></li>
 const buckets=new Map()
 for(const c of cards){
   const key=view==='calendar'?c.day:c.status
   if(view==='calendar'&&(!key||!key.startsWith(month+'-')))continue
   if(!buckets.has(key))buckets.set(key,[])
   buckets.get(key).push(c)
 }
 return <section aria-label="Shared project work" className="space-y-4"><nav aria-label="Work views">{['board','list','calendar'].map(v=><button key={v} className="workspace-button capitalize" aria-pressed={view===v} onClick={()=>change('workView',v)}>{v}</button>)}</nav>
 <details><summary>Manage service cards</summary>{[['branding-work','Branding & Design'],['website-work','Website'],['marketing-work','Marketing']].map(([id,name])=><button type="button" className="workspace-button" key={id} onClick={()=>onOpenService(id)}>{name}</button>)}</details>
 <label>Service <select value={group} onChange={e=>change('serviceGroup',e.target.value)}><option value="">All services</option>{[...new Set((rows||[]).map(c=>c.group))].sort().map(g=><option key={g}>{g}</option>)}</select></label>
 {view==='calendar'&&<label>Month <input type="month" value={month} onChange={e=>change('workMonth',e.target.value)}/></label>}
 {error?<p role="alert">{error}</p>:!rows?<p role="status">Loading Work…</p>:view==='list'?<ul className="space-y-2">{cards.map(entry)}</ul>:
 <div className={view==='calendar'?'space-y-3':'grid gap-3 md:grid-cols-3'}>{[...buckets].sort(([a],[b])=>String(a).localeCompare(String(b))).map(([key,items])=><section key={key}><h3>{key}</h3><ul>{items.map(entry)}</ul></section>)}</div>}
 {rows&&!error&&(view==='calendar'?!buckets.size:!cards.length)&&<p>No matching Work.</p>}</section>
}
