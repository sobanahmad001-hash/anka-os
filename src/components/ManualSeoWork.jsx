import { readMarketingWorkPages, seoServices } from '../data/manualMarketingWork.js'
import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase.js'
import { monthInTimezone, effectiveMarketingTimezone } from '../data/marketingCalendar.js'

function Month({workspace,service,month}) {
  const project=workspace.project
  const [rows,setRows]=useState([])
  const [selection,select]=useState('')
  const [refresh,reload]=useState(0)
  const [search,setSearch]=useState('')
  const [offset,setOffset]=useState(0)
  const [options,setOptions]=useState(null)
  const [chosen,choose]=useState('')
  const [requestId,newRequest]=useState(()=>crypto.randomUUID())
  const [title,setTitle]=useState('')
  const [owner,setOwner]=useState('')
  const [proof,setProof]=useState('')
  const [date,setDate]=useState('')
  const [position,setPosition]=useState('')
  const [busy,setBusy]=useState(false)
  const [error,setError]=useState('')
  const selected=rows.find(c=>c.id===selection)
  useEffect(()=>{
    let current=true
    async function read() {
      const data=await readMarketingWorkPages(()=>supabase.from('seo_work_cards').select('*,work_items!inner(title,assignee_id,row_version,deleted_at),seo_ranking_observations(id,observed_date,average_position,source_note)')
        .eq('project_id',project.id).eq('service_id',service).eq('month_start',month+'-01').is('work_items.deleted_at',null))
      if(current)setRows(data)
    }
    read().catch(e=>current&&setError(e.message))
    return ()=>{current=false}
  },[project.id,service,month,refresh])
  useEffect(()=>{
    let current=true
    setOptions(null);choose('')
    const timer=setTimeout(async()=>{
      try {
        const {data,error}=await supabase.rpc('website_page_index',{p_org:project.organization_id,p_project:project.id,p_search:search.trim(),p_offset:offset,p_view:'assignments'})
        if(error)throw error
        if(current)setOptions(data)
      }catch(e){if(current)setError(e.message)}
    },160)
    return ()=>{current=false;clearTimeout(timer)}
  },[project.id,project.organization_id,search,offset])
  function open(id){newRequest(crypto.randomUUID());select(id);setTitle('');setProof('');setDate('');setPosition('');setError('')}
  async function write(operation) {
    if(busy)return
    const target=options?.items[Number(chosen)]
    const creating=operation==='create'
    if(creating && (!owner || !title.trim() || (!selected && (!target || chosen==='')))){setError('Select a target, title and owner');return}
    const id=creating?requestId:selected.id
    setBusy(true);setError('')
    try{
      const {error}=await supabase.functions.invoke('work-items',{body:{action:'save_manual_seo_work',
        organizationId:project.organization_id,projectId:project.id,serviceId:service,cardId:id,
        expectedRevision:creating?null:selected.work_items.row_version,details:{operation,owner:owner||null,title,
        parent_review:creating?selected?.id:null,month_start:month+'-01',page_id:target?.id,target:target?.target,
        evidence:proof,date:date||null,position:position||null,observation:operation==='measure'?requestId:null}}})
      if(error){const details=await error.context?.json?.().catch(()=>null);throw new Error(details?.error || error.message)}
      open(id);reload(x=>x+1)
    }catch(e){setError(e.message)}
    finally{setBusy(false)}
  }
  const creator=<><label>Work title <input required maxLength="200" value={title} onChange={e=>setTitle(e.target.value)}/></label>
    <label>Work owner <select aria-label="Work owner" required value={owner} onChange={e=>setOwner(e.target.value)}><option value="">Select owner</option>{workspace.teamMembers.map(m=><option key={m.id} value={m.id}>{m.name}</option>)}</select></label></>
  return <fieldset disabled={busy} className="space-y-3">
    {error && <p role="alert">{error} <button type="button" onClick={()=>{setError('');reload(x=>x+1)}}>Reopen SEO Work</button></p>}
    <label>SEO card <select aria-label="SEO card" value={selection} onChange={e=>open(e.target.value)}><option value="">New monthly review</option>
      {rows.map(r=><option key={r.id} value={r.id}>{r.work_items.title} · {r.parent_review?'Action':'Review'} · {r.state}</option>)}</select></label>
    {!selected && <form onSubmit={e=>{e.preventDefault();write('create')}} className="grid gap-2">
      <label>Find Website page <input value={search} onChange={e=>{setSearch(e.target.value);setOffset(0)}}/></label>
      <label>Page and keyword <select aria-label="Page and keyword" required value={chosen} onChange={e=>choose(e.target.value)}><option value="">Select a Website keyword assignment</option>
        {options?.items.map((page,i)=><option key={page.id+'-'+i} value={i}>{page.path} · {page.target.query} · {page.target.locale}</option>)}</select></label>
      <div><button type="button" disabled={!offset} onClick={()=>setOffset(offset-25)}>Previous assignments</button>
        <button type="button" disabled={!options || offset+25>=options.total} onClick={()=>setOffset(offset+25)}>Next assignments</button></div>
      {creator}<button>Create monthly review</button></form>}
    {selected && <><h4>{selected.work_items.title}</h4>
      <p>{selected.page_path} · {selected.target.query} · {selected.target.locale} · {selected.state}</p>
      <p>Owner · {workspace.teamMembers.find(m=>m.id===selected.work_items.assignee_id)?.name || 'Recorded owner'}</p>
      {selected.parent_review && <button type="button" onClick={()=>open(selected.parent_review)}>Open monthly review</button>}
      {selected.evidence && <p>{selected.parent_review?'Fix verified':'Review completed'} {selected.verified_date} · {selected.evidence}</p>}
      {selected.seo_ranking_observations.map(m=><p key={m.id}>{m.observed_date} · Average position {m.average_position} · {m.source_note}</p>)}
      {selected.state!=='reviewed' && <form className="grid gap-2" onSubmit={e=>{e.preventDefault();write(selected.state==='verified'?'measure':'complete')}}>
        <label>{selected.state==='verified'?'Ranking observation date':'Evidence date'} <input type="date" required value={date} onChange={e=>setDate(e.target.value)}/></label>
        {selected.state==='verified' && <label>Average position <input type="number" min="1" step="any" required value={position} onChange={e=>setPosition(e.target.value)}/></label>}
        <label>{selected.state==='verified'?'Measurement source':'Evidence'} <textarea required maxLength="1500" value={proof} onChange={e=>setProof(e.target.value)}/></label>
        <button>{selected.state==='verified'?'Record ranking observation':selected.parent_review?'Verify fix':'Complete review'}</button></form>}
      {!selected.parent_review && <form className="grid gap-2" onSubmit={e=>{e.preventDefault();write('create')}}>{creator}<button>Add SEO action</button></form>}
    </>}
  </fieldset>
}
export default function ManualSeoWork({workspace}) {
  const services=seoServices(workspace)
  const [service,setService]=useState(services[0]?.id || '')
  const [month,setMonth]=useState(()=>monthInTimezone(new Date(),effectiveMarketingTimezone(workspace.project,workspace.client)))
  if(!services.length)return null
  return <section aria-label="Manual SEO" className="workspace-card p-4"><h3>SEO reviews and actions</h3>
    <label>SEO service <select aria-label="SEO service" value={service} onChange={e=>setService(e.target.value)}>{services.map(s=><option key={s.id} value={s.id}>{s.service_catalog.name}</option>)}</select></label>
    <label>Review month <input type="month" value={month} onChange={e=>setMonth(e.target.value)}/></label>
    {service && month && <Month key={workspace.project.id+service+month} workspace={workspace} service={service} month={month}/>}
  </section>
}
