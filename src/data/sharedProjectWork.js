import { supabase } from '../lib/supabase.js'
import { deliveryCalendarDate } from './marketingServiceDelivery.js'

async function pages(query, key = 'id') {
  const rows = []
  let cursor
  while (true) {
    let request = query().order(key).limit(250)
    if (cursor) request = request.gt(key, cursor)
    const {data, error} = await request
    if (error) throw error
    rows.push(...data)
    if (data.length < 250) return rows
    cursor = data.at(-1)[key]
  }
}

export async function readSharedWork(workspace, signal, {includePageAssets=true}={}) {
  const {project, engagement} = workspace
  const org = project.organization_id
  const scoped = (table, fields) => supabase.from(table).select(fields).eq('project_id',project.id).abortSignal(signal)
  const base = (table, fields) => scoped(table,fields).eq('organization_id',org)
  const services = new Map(workspace.services.filter(s=>['planned','active'].includes(s.status)).map(s=>[s.id,s]))
  const owners = new Map(workspace.teamMembers.map(m=>[m.id,m.name]))
  const projectPath = '/sphere/workspace/projects/'+project.id+'?'
  const ownerPath = params => projectPath+new URLSearchParams(params)
  async function inventory() {
    const rows=[]
    for(let offset=0;;){
      const {data,error}=await supabase.rpc('website_page_index',{p_org:org,p_project:project.id,p_offset:offset}).abortSignal(signal)
      if(error){if(error.code==='42501')return []; throw error}
      rows.push(...data.items)
      offset+=data.items.length
      if(!data.items.length || offset>=data.total)return rows
    }
  }
  const [work,tasks,brand,social,seo,delivery,website]=await Promise.all([
    engagement?pages(()=>base('work_items','id,title,department_id,status,assignee_id,due_date').eq('engagement_id',engagement.id).is('deleted_at',null)):[],
    pages(()=>base('tasks','id,title,status,assigned_to,due_date,department_id').is('archived_at',null)),
    pages(()=>base('brand_deliverable_cards','work_item_id,deliverable_id,engagement_service_id,stage'),'work_item_id'),
    pages(()=>scoped('social_work_cards','id,work_item_id,engagement_service_id,stage,original_month,planned_date,scheduled_date,published_date')),
    pages(()=>scoped('seo_work_cards','id,work_item_id,service_id,state,month_start')),
    pages(()=>scoped('marketing_delivery_cards','id,work_item_id,service_id,period_id,stage,planned_date,scheduled_on,delivered_on')),
    inventory()
  ])
  const overlays=new Map()
  function attach(c,group,serviceId,params,status,day){
    if(services.has(serviceId))overlays.set(c.work_item_id,{group,status,day,href:ownerPath(params)})
  }
  for(const c of brand)attach(c,'Branding & Design',c.engagement_service_id,{tab:'branding-work',deliverable:c.deliverable_id},c.stage)
  for(const c of social)attach(c,'Marketing',c.engagement_service_id,{tab:'marketing-work',source:'social',card:c.id,service:c.engagement_service_id,month:c.original_month.slice(0,7)},c.stage,c.published_date||c.scheduled_date||c.planned_date)
  for(const c of seo)attach(c,'Marketing',c.service_id,{tab:'marketing-work',source:'seo',card:c.id,service:c.service_id,month:c.month_start.slice(0,7)},c.state)
  for(const c of delivery)attach(c,'Marketing',c.service_id,{tab:'marketing-work',source:'delivery',card:c.id,service:c.service_id,period:c.period_id},c.stage,deliveryCalendarDate(c))
  const groups={design:'Branding & Design',content:'Content',marketing:'Marketing',website:'Website',web:'Website'}
  const websiteWork=new Set(website.flatMap(p=>(p.work||[]).map(w=>w.kind+':'+w.id)))
  function canonical(item,kind){
    const key=kind+':'+item.id
    const overlay=kind==='engagement_work_item'?overlays.get(item.id):null
    return {key,title:item.title,group:overlay?.group||(websiteWork.has(key)?'Website':groups[item.department_id]||item.department_id||'Project'),
      status:overlay?.status||item.status,workStatus:item.status,dueDate:item.due_date,day:overlay?.day||item.due_date,owner:owners.get(item.assignee_id||item.assigned_to),
      href:overlay?.href||'/sphere/workspace/items/'+kind+'/'+item.id}
  }
  const pageRows=new Map(website.map(p=>[p.id,{key:'page:'+p.id,title:p.title,group:'Website',status:p.state||'Page',
    href:ownerPath({tab:'website-work',page:p.id})}]))
  return [...work.map(w=>canonical(w,'engagement_work_item')),...tasks.map(t=>canonical(t,'project_task')),...(includePageAssets?[...pageRows.values()]:[])]
}
