import { readMarketingWorkPages, organicServices } from '../data/manualMarketingWork.js'
import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase.js'
import { effectiveMarketingTimezone, monthInTimezone } from '../data/marketingCalendar.js'
import { organicSocialCycle } from '../data/organicSocialCycle.js'

const stages = ['draft','in_review','approved','scheduled','published']
const label = value => value.replaceAll('_',' ')

function SocialMonth({ workspace, service, month }) {
  const project = workspace.project.id
  const [data,setData] = useState(null)
  const [epoch,reload] = useState(0)
  const [error,setError] = useState('')
  const [busy,setBusy] = useState(false)
  const [goals,setGoals] = useState({post:'',reel:''})
  const [form,setForm] = useState(null)
  const [view,setView] = useState('Board')
  useEffect(() => {
    let active = true
    setData(null)
    async function read() {
      const [cycle,cards] = await Promise.all([
        supabase.from('social_monthly_cycles').select('*').eq('project_id',project).eq('engagement_service_id',service).eq('month_start',month+'-01').maybeSingle(),
        readMarketingWorkPages(()=>supabase.from('social_work_cards').select('*,work_items!inner(title,description,assignee_id,row_version,deleted_at)').eq('project_id',project)
          .eq('engagement_service_id',service).is('work_items.deleted_at',null)
          .or(['original_month','planned_date','scheduled_date','published_date'].map(field =>
            'and('+field+'.gte.'+month+'-01,'+field+'.lt.'+new Date(Date.UTC(Number(month.slice(0,4)),Number(month.slice(5)),1)).toISOString().slice(0,10)+')').join(','))
        )
      ])
      if (cycle.error) throw cycle.error
      if (!active) return
      const targets = {post:cycle.data?.post_goal ?? null,reel:cycle.data?.reel_goal ?? null}
      setGoals({post:targets.post ?? '',reel:targets.reel ?? ''})
      setData({cycle:cycle.data,...organicSocialCycle({projectId:project,month,cards,goals:targets})})
    }
    read().catch(err => { if (active) setError(err.message) })
    return () => { active=false }
  },[project,service,month,epoch])
  async function save(name,args) {
    if (busy) return
    setBusy(true)
    setError('')
    try {
      const result = name==='save_social_work_card'
        ? await supabase.functions.invoke('work-items',{body:{action:name,organizationId:workspace.project.organization_id,projectId:project,serviceId:service,cardId:args.p_card,expectedRevision:args.p_revision,details:args.p_details}})
        : await supabase.rpc(name,{p_project:project,p_service:service,...args})
      if (result.error) {
        const detail=await result.error.context?.json?.().catch(()=>null)
        throw new Error(detail?.error || result.error.message)
      }
      setForm(null)
      reload(n=>n+1)
    } catch (err) { setError(err.message) }
    finally { setBusy(false) }
  }
  function open(card) {
    setForm({...card,...card.work_items})
  }
  const set = (key,value) => setForm(old=>({...old,[key]:value}))
  function submit(event) {
    event.preventDefault()
    const scheduled = ['scheduled','published'].includes(form.stage)
    return save('save_social_work_card',{p_card:form.id,p_revision:form.row_version ?? null,p_details:{
      title:form.title, description:form.description, kind:form.kind, stage:form.stage, assignee_id:form.assignee_id,
      asset_version_id:form.asset_version_id || null, planned_date:form.planned_date,
      scheduled_date:scheduled ? form.scheduled_date : null, published_date:form.stage==='published' ? form.published_date : null
    }})
  }
  const cardButton = card => <button type="button" className="workspace-button" key={card.id} onClick={()=>open(card)}>
    {card.work_items.title} · {card.kind} · {label(card.stage)}
  </button>
  return <>
    {error && <p role="alert">{error} <button type="button" onClick={()=>{setForm(null);setError('');reload(n=>n+1)}}>Reopen month</button></p>}
    {data && <fieldset disabled={busy}>
      <form onSubmit={e=>{e.preventDefault();save('save_social_cycle',{p_month:month+'-01',p_posts:Number(goals.post),p_reels:Number(goals.reel),p_revision:data.cycle?.revision ?? null})}}>
        {['post','reel'].map(kind=><label key={kind}>Monthly {kind} goal <input required type="number" min="0" max="10000" value={goals[kind]} onChange={e=>setGoals({...goals,[kind]:e.target.value})}/></label>)}
        <button>Save monthly goals</button>
      </form>
      {Object.entries(data.counts).map(([kind,n])=><p key={kind}>{kind==='post'?'Posts':'Reels'} · Goal {n.goal ?? 'unset'} · Committed {n.committed} · Planned {n.planned} · Scheduled {n.scheduled} · Delivered {n.delivered}</p>)}
      <nav aria-label="Organic Social views">{['Board','Calendar'].map(name=><button type="button" key={name} aria-pressed={view===name} onClick={()=>setView(name)}>{name}</button>)}</nav>
      {view==='Board' ? <div className="grid gap-3 md:grid-cols-3">{stages.map(stage=><section key={stage}><h4>{label(stage)}</h4>{data.board.filter(c=>c.stage===stage).map(cardButton)}</section>)}</div>
      : <ol aria-label="Calendar by date">{[...data.calendar.keys()].sort().map(day=><li key={day}><time dateTime={day}>{day}</time> {data.calendar.get(day).map(cardButton)}</li>)}</ol>}
      {data.cycle && <button type="button" onClick={()=>setForm({id:crypto.randomUUID(),kind:'post',stage:'draft',title:'',description:'',assignee_id:'',planned_date:month+'-01'})}>New social card</button>}
      {form && <form onSubmit={submit} className="grid gap-2">
        <h4>{form.work_item_id?'Edit social card':'New social card'}</h4>
        {form.original_month && <p>Original commitment {form.original_month.slice(0,7)}</p>}
        <label>Format <select aria-label="Format" disabled={!!form.work_item_id} value={form.kind} onChange={e=>set('kind',e.target.value)}><option value="post">Post</option><option value="reel">Reel</option></select></label>
        <label>Title <input required maxLength={200} value={form.title} onChange={e=>set('title',e.target.value)}/></label>
        <label>Brief or caption <textarea maxLength={4000} value={form.description || ''} onChange={e=>set('description',e.target.value)}/></label>
        <label>Owner <select aria-label="Owner" required value={form.assignee_id || ''} onChange={e=>set('assignee_id',e.target.value)}><option value="">Choose owner</option>{workspace.teamMembers.map(m=><option key={m.id} value={m.id}>{m.name}</option>)}</select></label>
        <label>Asset version <select aria-label="Asset version" value={form.asset_version_id || ''} onChange={e=>set('asset_version_id',e.target.value)}><option value="">Choose asset version</option>{workspace.deliverables.flatMap(d=>d.versions.filter(v=>!v.withdrawn_at).map(v=><option key={v.id} value={v.id}>{d.title} · v{v.version_number}</option>))}</select></label>
        <label>Planned date <input type="date" required value={form.planned_date} onChange={e=>set('planned_date',e.target.value)}/></label>
        <label>Stage <select aria-label="Stage" disabled={!form.work_item_id} value={form.stage} onChange={e=>set('stage',e.target.value)}>{stages.map(s=><option key={s} value={s}>{label(s)}</option>)}</select></label>
        {['scheduled','published'].includes(form.stage) && <label>Scheduled date <input required type="date" value={form.scheduled_date || ''} onChange={e=>set('scheduled_date',e.target.value)}/></label>}
        {form.stage==='published' && <label>Actual publication date <input required type="date" value={form.published_date || ''} onChange={e=>set('published_date',e.target.value)}/></label>}
        {form.reviewed_at && <p>Internally reviewed {form.reviewed_at.slice(0,10)} · {workspace.teamMembers.find(m=>m.id===form.reviewed_by)?.name || 'Recorded reviewer'}</p>}
        <button disabled={data.board.find(c=>c.id===form.id)?.stage==='published'}>Save social card</button>
        <button type="button" onClick={()=>setForm(null)}>Close card</button>
      </form>}
    </fieldset>}
  </>
}
export default function OrganicSocialWork({workspace}) {
  const services=organicServices(workspace)
  const [service,select]=useState(services[0]?.id || '')
  const [month,setMonth]=useState(()=>monthInTimezone(new Date(),effectiveMarketingTimezone(workspace.project,workspace.client)))
  if (!services.length) return null
  return <section className="workspace-card p-4"><h3>Organic Social</h3>
    <label>Social service <select aria-label="Social service" value={service} onChange={e=>select(e.target.value)}>{services.map(s=><option key={s.id} value={s.id}>{s.service_catalog.name}</option>)}</select></label>
    <label>Cycle month <input type="month" value={month} onChange={e=>setMonth(e.target.value)}/></label>
    {month && service && <SocialMonth key={workspace.project.id+service+month} workspace={workspace} service={service} month={month}/>}
  </section>
}
