import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase.js'
import { readMarketingWorkPages } from '../data/manualMarketingWork.js'

function requireData(response) {
  if (response.error) throw response.error
  return response.data
}

export default function MarketingMeasurement({workspace,service,card,period}) {
  const [records,setRecords]=useState(null)
  const [error,setError]=useState('')
  const [busy,setBusy]=useState(false)
  const [revision,refresh]=useState(0)
  const [request,setRequest]=useState(()=>crypto.randomUUID())
  const [uncertain,setUncertain]=useState(false)
  const project=workspace.project
  useEffect(()=>{
    let current=true
    async function read(){
      if(card){
        const plan=requireData(await supabase.from('marketing_measurement_plans').select('*').eq('project_id',project.id).eq('card_id',card.id).maybeSingle())
        const results=plan?await readMarketingWorkPages(()=>supabase.from('marketing_measurement_results').select('*').eq('plan_id',plan.id)):[]
        results.sort((a,b)=>b.observed_on.localeCompare(a.observed_on))
        if(current){setRecords({plan,results});setUncertain(false)}
      }else{
        const review=requireData(await supabase.from('marketing_period_reviews').select('*').eq('period_id',period.id).maybeSingle())
        if(current){setRecords({review});setUncertain(false)}
      }
    }
    read().catch(e=>{if(current)setError(e.message)})
    return ()=>{current=false}
  },[card?.id,period.id,project.id,revision])
  async function save(event){
    event.preventDefault()
    if(busy||uncertain)return
    const form=event.currentTarget
    const fields=Object.fromEntries(new FormData(form))
    for(const field of ['baseline','target','actual','next_work'])if(fields[field]==='')fields[field]=null
    const operation=card?(records.plan?'result':'plan'):'close_period'
    setBusy(true);setError('')
    try{
      requireData(await supabase.rpc('record_marketing_measurement',{p_org:project.organization_id,p_project:project.id,p_service:service.id,p_id:request,p_details:{
        ...fields,operation,period_id:period.id,card_id:card?.id,plan_id:records.plan?.id
      }}))
      form.reset();setRequest(crypto.randomUUID());refresh(n=>n+1)
    }catch(e){setError(e.message);setUncertain(true)}
    finally{setBusy(false)}
  }
  const work=workspace.engagementWorkItems||[]
  const nextFields=<><label>Next action <input name="next_action" required maxLength={1000}/></label>
    <label>Related Work <select name="next_work"><option value="">Choose if applicable</option>{work.filter(w=>w.project_id===project.id&&!w.deleted_at).map(w=><option key={w.id} value={w.id}>{w.title}</option>)}</select></label></>
  const related=id=>{
    const item=work.find(w=>w.id===id && !w.deleted_at)
    return item?<Link to={'/sphere/workspace/items/engagement_work_item/'+id}>{item.title}</Link>:(id?'Linked Work unavailable':'')
  }
  const plan=records?.plan,review=records?.review
  return <details className="workspace-card p-3"><summary>{card?'Manual measurement':'Period review'}</summary>
    {error && <p role="alert">{error}</p>}
    <button type="button" disabled={busy} onClick={()=>{refresh(n=>n+1);setError('')}}>Check saved records</button>
    {records && (review?<><p>{review.summary}</p><p>Original goal {review.results.original_goal} · Current goal {review.results.goal} · Committed {review.results.committed} · Open commitments {review.results.open_committed} {review.results.unit}</p>
      <p>Delivered in period {Object.entries(review.results.actual_by_unit).map(([unit,count])=>count+' '+unit).join(', ')||'0 '+review.results.unit}</p><p>{review.next_action} {related(review.next_work_id)}</p></>:<>
      {plan && <section><h4>{plan.question}</h4><p>{plan.metric} ({plan.unit}), {plan.starts_on} – {plan.ends_on}</p>
        <p>Baseline {plan.baseline??'unspecified'} · Target {plan.target??'unspecified'}</p><p>{plan.source_note}</p>
        {records.results.map(r=><article key={r.id}><p>{r.observed_on} · {r.actual??'Unavailable'} {r.actual!==null&&plan.unit} · {r.decision}</p>
          <p>{r.source_note}</p><p>{r.conclusion}</p><p>{r.next_action} {related(r.next_work_id)}</p></article>)}</section>}
      <form key={plan?.id||period.id} onSubmit={save}><fieldset disabled={busy||uncertain} className="grid gap-2">
        {!card?<label>Period summary <textarea name="summary" required maxLength={2000}/></label>:plan?<>
          <label>Observation date <input type="date" name="observed_on" min={plan.ends_on} required/></label>
          <label>Actual measurement <input type="number" step="any" name="actual"/></label>
          <label>Observation source <input name="source_note" required maxLength={1500}/></label>
          <label>Conclusion <textarea name="conclusion" required maxLength={2000}/></label>
          <label>Decision <select name="decision">{['continue','revise','stop','monitor','inconclusive'].map(value=><option key={value}>{value}</option>)}</select></label>
        </>:<>
          <label>Measurement question <input name="question" required maxLength={2000}/></label>
          <label>Metric <input name="metric" required maxLength={180}/></label>
          <label>Measurement unit <input name="unit" required maxLength={60}/></label>
          <label>Baseline <input type="number" step="any" name="baseline"/></label>
          <label>Target <input type="number" step="any" name="target"/></label>
          <label>Window starts <input type="date" name="starts_on" required/></label>
          <label>Window ends <input type="date" name="ends_on" required/></label>
          <label>Measurement source <input name="source_note" required maxLength={1000}/></label>
        </>}
        {(!card||plan)&&nextFields}<button>{card?(plan?'Record observation':'Save measurement plan'):'Save period review'}</button>
      </fieldset></form></>)}
  </details>
}
