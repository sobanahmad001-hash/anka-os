import { SERVICE_CATALOGUE } from './serviceCatalogue.js'

import { SERVICE_BUSINESS_GROUP_MAPPINGS } from './serviceBusinessGroups.js'
const mapped = new Set(SERVICE_BUSINESS_GROUP_MAPPINGS.filter(x=>x.groups.includes('marketing')).map(x=>x.service_id))
const catalogue = new Map(SERVICE_CATALOGUE.map(service=>[service.slug,service]))
const socialCards = new Set(['social_planning','setup_marketing_social_calendar','setup_marketing_social_scheduling_and_publishing'])

export function deliveryServices(workspace) {
  return (workspace.services || []).filter(s=>['planned','active'].includes(s.status) &&
    (s.service_catalog?.department_id==='marketing' || mapped.has(s.service_catalog?.id)) && !socialCards.has(s.service_catalog.slug))
}
const contextLabels = {
  Strategy:'Audience, channels and objective',
  'Organic distribution':'Article, outlet or distribution target',
  'Organic social management':'Community, channel and response scope',
  'On-page SEO':'Page or site area',
  'Off-page SEO':'Outreach target, placement or referring domain',
  'Technical SEO management':'Site issue, affected URLs and validation method',
  'Local SEO':'Location, listing or citation',
  'Google Business Profile':'Business location and profile',
  'Paid search':'Search account, campaign and objective',
  'Paid social':'Social account, campaign and audience',
  'Paid placements':'Publication, placement and terms',
  'Email distribution':'Audience, message or automation sequence',
  'SMS & push distribution':'Audience, delivery channel and consent scope',
  'Measurement & analytics':'Property, metric and reporting scope',
  'Reporting & optimization':'Question, KPI and comparison period',
}
export function serviceDefaults(service,scope) {
  const leaf=catalogue.get(service.service_catalog.slug)
  return {unit:scope?.unit || leaf?.unit || 'deliverable', cadence:scope?.recurrence || leaf?.recurrence || 'custom',
    goal:scope?.quantity ?? 1,scope_note:scope?.scope_statement || '',subjectLabel:contextLabels[leaf?.group] || 'Channel, audience or work subject'}
}
function addMonths(date,count){
  const d=new Date(date+'T00:00:00Z'), day=d.getUTCDate()
  d.setUTCDate(1);d.setUTCMonth(d.getUTCMonth()+count)
  const end=new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+1,0)).getUTCDate()
  d.setUTCDate(Math.min(day,end));return d.toISOString().slice(0,10)
}
export function addDays(day,n){
  const date=new Date(day+'T00:00:00Z');date.setUTCDate(date.getUTCDate()+n);return date.toISOString().slice(0,10)
}
export function periodEnd(start,cadence) {
  if(!start)return ''
  if(cadence==='weekly')return addDays(start,6)
  if(cadence==='monthly'||cadence==='quarterly')return addDays(addMonths(start,cadence==='monthly'?1:3),-1)
  return start
}
export function periodCards(period,cards) {
  const within=date=>date && date>=period.starts_on && date<=period.ends_on
  const visible=[],calendar=new Map(),actual=new Map()
  let committed=0,planned=0,scheduled=0
  for(const c of cards){
    if(c.project_id!==period.project_id || c.service_id!==period.service_id)throw new Error('Marketing Work scope mismatch')
    const original=c.period_id===period.id
    if(original)committed+=c.committed_units
    if(within(c.planned_date)&&c.marketing_service_periods.unit===period.unit)planned+=c.committed_units
    if(within(c.scheduled_on)&&c.marketing_service_periods.unit===period.unit)scheduled+=c.committed_units
    if(within(c.delivered_on)){
      const unit=c.marketing_service_periods.unit
      actual.set(unit,(actual.get(unit)||0)+c.delivered_units)
    }
    if(original || within(c.planned_date) || within(c.scheduled_on) || within(c.delivered_on))visible.push(c)
    const day=within(c.delivered_on)?c.delivered_on:within(c.scheduled_on)?c.scheduled_on:within(c.planned_date)?c.planned_date:null
    if(day){if(!calendar.has(day))calendar.set(day,[]);calendar.get(day).push(c)}
  }
  return {visible,calendar,committed,planned,scheduled,actual}
}
