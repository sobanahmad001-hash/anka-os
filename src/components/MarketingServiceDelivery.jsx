import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import MarketingMeasurement from './MarketingMeasurement.jsx'
import { supabase } from '../lib/supabase.js'
import { readMarketingWorkPages } from '../data/manualMarketingWork.js'
import { addDays, deliveryServices, periodCards, periodEnd, serviceDefaults, sharedDeliveryMonth } from '../data/marketingServiceDelivery.js'

const stages={draft:'Draft',in_review:'In review',approved:'Approved',scheduled:'Scheduled',delivered:'Delivered'}
const cadences=['once','per_batch','weekly','monthly','quarterly','custom']
const today=()=>new Date().toLocaleDateString('en-CA')
async function checked(result){
  if(!result.error)return result.data
  const payload=await result.error.context?.json?.().catch(()=>null)
  throw new Error(payload?.error || result.error.message)
}
function PeriodForm({seed,onSave,busy}) {
  const [plan,setPlan]=useState(seed)
  const field=(key,value)=>setPlan(p=>({...p,[key]:value}))
  function dates(values){
    setPlan(p=>{const next={...p,...values};return {...next,ends_on:periodEnd(next.starts_on,next.cadence)}})
  }
  return <form className="grid gap-2" onSubmit={e=>{e.preventDefault();onSave(plan)}}>
    <fieldset disabled={busy || !!seed.revision}>
      <label>Cadence <select aria-label="Cadence" value={plan.cadence} onChange={e=>dates({cadence:e.target.value})}>{cadences.map(c=><option key={c}>{c}</option>)}</select></label>
      <label>Period start <input type="date" required value={plan.starts_on} onChange={e=>dates({starts_on:e.target.value})}/></label>
      <label>Period end <input type="date" required min={plan.starts_on} value={plan.ends_on} onChange={e=>field('ends_on',e.target.value)}/></label>
      <label>Delivery unit <input required maxLength="60" value={plan.unit} onChange={e=>field('unit',e.target.value)}/></label>
    </fieldset>
    <label>Scoped quantity <input type="number" min="0" max="100000" required value={plan.goal} onChange={e=>field('goal',e.target.value)}/></label>
    <label>Scope and exclusions <textarea aria-label="Scope and exclusions" maxLength="2000" value={plan.scope_note} onChange={e=>field('scope_note',e.target.value)}/></label>
    <button disabled={busy}>Save service period</button>
  </form>
}

function DeliveryCard({card,period,workspace,campaigns,subjectLabel,onSave,busy,onClose}){
 const [form,setForm]=useState(()=>({...card,title:card.work_items?.title || '',owner:card.work_items?.assignee_id || '',note:'',delivered_units:card.committed_units,delivered_on:today()}))
 const field=(key,value)=>setForm(previous=>({...previous,[key]:value}))
 const editable=!card.work_item_id || card.stage==='draft'
 const save=operation=>onSave({...form,operation,campaign_id:form.campaign_id||null,asset_version_id:form.asset_version_id||null})
 const workTitle=card.work_items?.title
 return <section aria-label="Delivery card" className="workspace-card p-3 space-y-2">
   <h4>{workTitle || 'New delivery card'}</h4>
   {card.work_item_id && <p>{stages[card.stage]} · Original commitment {card.original_date} · {card.committed_units} {card.marketing_service_periods.unit} · <Link to={'/sphere/workspace/items/engagement_work_item/'+card.work_item_id}>Open Work</Link></p>}
   <form onSubmit={e=>{e.preventDefault();save(card.work_item_id?'edit':'create')}}>
    <fieldset className="grid gap-2" disabled={!editable||busy}>
     <label>Card title <input required maxLength="200" value={form.title} onChange={e=>field('title',e.target.value)}/></label>
     <label>Card owner <select aria-label="Card owner" required value={form.owner} onChange={e=>field('owner',e.target.value)}><option value="">Choose owner</option>{workspace.teamMembers.map(m=><option key={m.id} value={m.id}>{m.name}</option>)}</select></label>
     <label>{subjectLabel} <input required maxLength="350" value={form.subject} onChange={e=>field('subject',e.target.value)}/></label>
     <label>Channel <input maxLength="100" value={form.channel||''} onChange={e=>field('channel',e.target.value)}/></label>
     <label>Contact or listing reference <input maxLength="350" value={form.contact_ref||''} onChange={e=>field('contact_ref',e.target.value)}/></label>
     <label>Follow-up date <input type="date" value={form.follow_up_on||''} onChange={e=>field('follow_up_on',e.target.value)}/></label>
     <label>Brief and acceptance criteria <textarea aria-label="Brief and acceptance criteria" maxLength="4000" value={form.brief} onChange={e=>field('brief',e.target.value)}/></label>
     <label>Planned delivery <input type="date" required min={!card.work_item_id?period.starts_on:undefined} max={!card.work_item_id?period.ends_on:undefined} value={form.planned_date} onChange={e=>field('planned_date',e.target.value)}/></label>
     {!card.work_item_id && <label>Committed units <input type="number" required min="1" max="100000" value={form.committed_units} onChange={e=>field('committed_units',e.target.value)}/></label>}
     <label>Campaign <select aria-label="Campaign" value={form.campaign_id || ''} onChange={e=>field('campaign_id',e.target.value)}><option value="">Standalone work</option>{campaigns.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
     <label>Asset version <select aria-label="Delivery asset version" value={form.asset_version_id || ''} onChange={e=>field('asset_version_id',e.target.value)}><option value="">No linked version</option>{workspace.deliverables.flatMap(d=>d.versions.filter(v=>!v.withdrawn_at).map(v=><option key={v.id} value={v.id}>{d.title} · v{v.version_number}</option>))}</select></label>
     {editable && <button>Save delivery card</button>}
    </fieldset>
   </form>
   {card.scheduled_on && <p>Scheduled {card.scheduled_on}</p>}{card.result_url && <p>Recorded URL · {card.result_url}</p>}
   {card.review_note && <p>Review feedback · {card.review_note}</p>}
   {card.reviewed_at && <p>Approved {card.reviewed_at.slice(0,10)} · {workspace.teamMembers.find(m=>m.id===card.reviewer)?.name || 'Recorded reviewer'}</p>}
   {card.stage==='delivered' && <p>Delivered {card.delivered_on} · {card.delivered_units} {card.marketing_service_periods.unit} · {card.delivery_evidence}</p>}
   <fieldset disabled={busy} className="space-y-2">
   {card.work_item_id && card.stage==='draft' && <button onClick={()=>onSave({...card,operation:'submit'})}>Submit saved card for review</button>}
   {['in_review','approved','scheduled'].includes(card.stage) && <>
    <label>{card.stage!=='in_review'?'Delivery evidence or return note':'Review feedback'} <textarea aria-label={card.stage!=='in_review'?'Delivery evidence or return note':'Review feedback'} maxLength="2000" value={form.note} onChange={e=>field('note',e.target.value)}/></label>
    <button onClick={()=>save('return')}>Return to draft</button>
    {card.stage==='in_review'?<button onClick={()=>save('approve')}>Approve submitted card</button>:<>
      <label>Schedule date <input type="date" value={form.scheduled_on||''} onChange={e=>field('scheduled_on',e.target.value)}/></label>
      <button disabled={!form.scheduled_on} onClick={()=>save('schedule')}>Record schedule</button>
      <label>Published or placement URL <input type="url" maxLength="2048" value={form.result_url||''} onChange={e=>field('result_url',e.target.value)}/></label>
      <label>Actual delivery date <input type="date" value={form.delivered_on} onChange={e=>field('delivered_on',e.target.value)}/></label>
      <label>Actual quantity <input type="number" min="1" max="100000" value={form.delivered_units} onChange={e=>field('delivered_units',e.target.value)}/></label>
      <button disabled={!form.note.trim()||!form.delivered_on||Number(form.delivered_units)<1} onClick={()=>save('deliver')}>Record completed delivery</button></>}
   </>}
   <button onClick={onClose}>Close delivery card</button></fieldset>
 </section>
}

function Service({workspace,service}){
 const project=workspace.project
 const [records,setRecords]=useState(null),[periodId,setPeriodId]=useState(''),[revision,refresh]=useState(0)
 const [editPeriod,setEditPeriod]=useState(null),[selection,select]=useState(null),[view,setView]=useState('Board')
 const [busy,setBusy]=useState(false),[error,setError]=useState('')
 useEffect(()=>{
  let current=true
  async function read(){
   const [periods,cards,campaigns,scope]=await Promise.all([
    readMarketingWorkPages(()=>supabase.from('marketing_service_periods').select('*').eq('project_id',project.id).eq('service_id',service.id)),
    readMarketingWorkPages(()=>supabase.from('marketing_delivery_cards').select('*,work_items!inner(title,assignee_id,row_version,deleted_at),marketing_service_periods!inner(unit)').eq('project_id',project.id).eq('service_id',service.id).is('work_items.deleted_at',null)),
    readMarketingWorkPages(()=>supabase.from('marketing_campaigns').select('id,name,starts_on,ends_on').eq('organization_id',project.organization_id).eq('engagement_id',workspace.engagement.id)),
    supabase.from('project_service_scopes').select('*').eq('project_id',project.id).eq('service_id',service.service_catalog.id).maybeSingle().then(checked)
   ])
   if(!current)return
   periods.sort((a,b)=>b.starts_on.localeCompare(a.starts_on))
   setRecords({periods,cards,campaigns,defaults:serviceDefaults(service,scope)})
   setPeriodId(id=>id || periods[0]?.id || '')
  }
  read().catch(e=>{if(current)setError(e.message)})
  return ()=>{current=false}
 },[service,project.id,project.organization_id,workspace.engagement.id,revision])
 const period=records?.periods.find(p=>p.id===periodId)
 const data=period?periodCards(period,records.cards):null
 const picked=records?.cards.find(c=>c.id===selection?.id) || selection
 function newPeriod(){
  const start=period?addDays(period.ends_on,1):today()
  const defaults=period || records.defaults
  setEditPeriod({id:crypto.randomUUID(),starts_on:start,ends_on:periodEnd(start,defaults.cadence),cadence:defaults.cadence,
   goal:defaults.goal,unit:defaults.unit,scope_note:defaults.scope_note})
  select(null)
 }
 async function write(fn,done){
  if(busy)return
  setBusy(true);setError('')
  try{await checked(await fn());done();refresh(n=>n+1)}
  catch(e){setError(e.message)}
  finally{setBusy(false)}
 }
 const cardButton=c=><button type="button" className="workspace-button" key={c.id} onClick={()=>{select(c);setEditPeriod(null)}}>{c.work_items.title}</button>
 return <>
  {error && <p role="alert">{error} <button onClick={()=>{setError('');select(null);setEditPeriod(null);refresh(n=>n+1)}}>Reopen service records</button></p>}
  {records && <fieldset disabled={busy}>
   <label>Service period <select aria-label="Service period" value={periodId} onChange={e=>{setPeriodId(e.target.value);select(null);setEditPeriod(null)}}>{!period && <option value="">Choose period</option>}{records.periods.map(p=><option key={p.id} value={p.id}>{p.starts_on} – {p.ends_on}</option>)}</select></label>
   <button onClick={newPeriod}>{period?'Plan next period':'Plan service period'}</button>
   {period && <button onClick={()=>{setEditPeriod(period);select(null)}}>Edit period goal</button>}
   {editPeriod && <PeriodForm key={editPeriod.id} seed={editPeriod} busy={busy} onSave={plan=>write(()=>supabase.rpc('save_marketing_service_period',{
    p_org:project.organization_id,p_project:project.id,p_service:service.id,p_id:plan.id,p_revision:plan.revision??null,p_plan:plan}),()=>{setPeriodId(plan.id);setEditPeriod(null)})}/>}
   {period && <>
    <p>Original goal {period.original_goal} · Current goal {period.goal} · Committed {data.committed} {period.unit}</p>
    <p>Actual delivery · {[...data.actual].map(([unit,n])=>n+' '+unit).join(', ') || '0 '+period.unit}</p>
    <p>Planned {data.planned} · Scheduled {data.scheduled} · Planning gap {Math.max(0,period.goal-data.planned)} {period.unit}</p>
    {period.scope_note && <p>{period.scope_note}</p>}
    <MarketingMeasurement key={period.id} workspace={workspace} service={service} period={period}/>
    <nav aria-label="Delivery views">{['Board','Calendar'].map(v=><button key={v} aria-pressed={view===v} onClick={()=>setView(v)}>{v}</button>)}</nav>
    {view==='Board'?<div className="grid gap-3 md:grid-cols-4">{Object.entries(stages).map(([stage,label])=><section key={stage}><h4>{label}</h4>{data.visible.filter(c=>c.stage===stage).map(cardButton)}</section>)}</div>:
     <ol>{[...data.calendar.keys()].sort().map(d=><li key={d}><time>{d}</time> {data.calendar.get(d).map(cardButton)}</li>)}</ol>}
    <button onClick={()=>{select({id:crypto.randomUUID(),period_id:period.id,planned_date:period.starts_on,committed_units:1,brief:'',subject:''});setEditPeriod(null)}}>New delivery card</button>
    {picked?.work_item_id && <MarketingMeasurement key={picked.id} workspace={workspace} service={service} period={period} card={picked}/>}
    {picked && <DeliveryCard key={picked.id+':'+(picked.work_items?.row_version || 'new')} card={picked} period={period} workspace={workspace} campaigns={records.campaigns}
      subjectLabel={records.defaults.subjectLabel} busy={busy} onClose={()=>select(null)} onSave={details=>write(()=>supabase.functions.invoke('work-items',{body:{
       action:'save_marketing_delivery_card',organizationId:project.organization_id,projectId:project.id,serviceId:service.id,cardId:picked.id,
       expectedRevision:picked.work_items?.row_version ?? null, details:{operation:details.operation,period_id:picked.period_id,title:details.title,owner:details.owner,
       channel:details.channel,contact_ref:details.contact_ref,follow_up_on:details.follow_up_on||null,scheduled_on:details.scheduled_on||null,result_url:details.result_url,subject:details.subject,brief:details.brief,planned_date:details.planned_date,committed_units:details.committed_units,campaign_id:details.campaign_id,
       asset_version_id:details.asset_version_id,delivered_on:details.delivered_on,delivered_units:details.delivered_units,note:details.note}}}),()=>select(null))}/>}
   </>}
  </fieldset>}
 </>
}
function SharedDelivery({projectId, services}) {
 const [cards,setCards]=useState(null)
 const [error,setError]=useState('')
 const [view,setView]=useState('Board')
 const [month,setMonth]=useState(()=>today().slice(0,7))
 const [revision,refresh]=useState(0)
 const names=new Map(services.map(service=>[service.id,service.service_catalog.name]))
 const scope=JSON.stringify([...names.keys()].sort())
 useEffect(()=>{
   let current=true
   setCards(null)
   setError('')
   const ids=JSON.parse(scope)
   readMarketingWorkPages(()=>supabase.from('marketing_delivery_cards')
     .select('id,service_id,stage,planned_date,scheduled_on,delivered_on,work_items!inner(title,deleted_at)')
     .eq('project_id',projectId).in('service_id',ids).is('work_items.deleted_at',null))
     .then(rows=>{if(current)setCards(rows)})
     .catch(e=>{if(current)setError(e.message)})
   return ()=>{current=false}
 },[projectId,scope,revision])
 const item=card=><li key={card.id}>{card.work_items.title} · {names.get(card.service_id)}</li>
 const days=cards && view==='Calendar'?sharedDeliveryMonth(cards,month):[]
 return <section aria-label="Shared delivery">
   <nav aria-label="Shared delivery views">{['Board','Calendar'].map(v=><button key={v} type="button" aria-pressed={view===v} onClick={()=>setView(v)}>{v}</button>)}</nav>
   {error?<p role="alert">{error} <button type="button" onClick={()=>refresh(n=>n+1)}>Retry</button></p>:!cards?<p role="status">Loading delivery cards…</p>:
    view==='Board'?(cards.length?<div className="grid gap-3 md:grid-cols-4">{Object.entries(stages).map(([stage,label])=><section key={stage}><h4>{label}</h4><ul>{cards.filter(c=>c.stage===stage).map(item)}</ul></section>)}</div>:<p>No delivery cards.</p>):
    <><label>Calendar month <input type="month" value={month} onChange={e=>setMonth(e.target.value)}/></label>
    {days.length?days.map(([day,entries])=><section key={day}><h4><time dateTime={day}>{day}</time></h4><ul>{entries.map(item)}</ul></section>):<p>No delivery cards this month.</p>}</>}
 </section>
}

export default function MarketingServiceDelivery({workspace}){
 const services=deliveryServices(workspace)
 const [id,setId]=useState('')
 const service=services.find(s=>s.id===id) || services[0]
 if(!service)return null
 return <section aria-label="Marketing service delivery" className="workspace-card p-4"><h3>Marketing service delivery</h3>
 <label>Delivery service <select aria-label="Delivery service" value={id==='all'?'all':service.id} onChange={e=>setId(e.target.value)}><option value="all">All delivery services</option>{services.map(s=><option key={s.id} value={s.id}>{s.service_catalog.name}</option>)}</select></label>
 <p><Link to={'/sphere/marketing/studio?tab=campaigns&engagement='+workspace.engagement.id}>Manage engagement campaigns</Link></p>
 {id==='all'?<SharedDelivery key={JSON.stringify([workspace.project.id,...services.map(s=>s.id).sort()])} projectId={workspace.project.id} services={services}/>:<Service key={service.id} workspace={workspace} service={service}/>}</section>
}
