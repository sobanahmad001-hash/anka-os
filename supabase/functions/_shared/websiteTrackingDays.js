// One-day finalized GSC slices. The caller persists completion per exact binding revision.
const DAY=86400000
function day(value){
 const stamp=Date.parse(value+'T12:00:00Z')
 if(!/^\d{4}-\d{2}-\d{2}$/.test(value)||!Number.isFinite(stamp)||new Date(stamp).toISOString().slice(0,10)!==value)throw Error('Real reporting date required')
 return stamp
}
export function trackingDays({today,completed=[],limit=7,historyDays=56,refreshDays=7}){
 if(!Number.isInteger(limit)||limit<1||limit>25||!Number.isInteger(historyDays)||historyDays<56||historyDays>366||!Number.isInteger(refreshDays)||refreshDays<1||refreshDays>14)throw Error('Bounded daily tracking policy required')
 const current=day(today),through=current-3*DAY,earliest=through-(historyDays-1)*DAY
 const known=new Map()
 for(const row of completed){const stamp=day(row.date);if(stamp>=earliest&&stamp<=through)known.set(row.date,row.refreshedOn)}
 const candidates=[]
 for(let stamp=through;stamp>=earliest;stamp-=DAY){
  const date=new Date(stamp).toISOString().slice(0,10),last=known.get(date)
  if(!last)candidates.push({date,priority:0})
  else if(stamp>through-refreshDays*DAY&&day(last)<current)candidates.push({date,priority:1})
 }
 // Recent rechecks cannot be starved by a large initial backfill.
 return candidates.sort((a,b)=>b.priority-a.priority||b.date.localeCompare(a.date)).slice(0,limit).map(({date})=>({start:date,end:date}))
}
export function compareDailyTracking({days,through,window=7}){
 if(![7,28].includes(window))throw Error('Choose a 7 or 28 day comparison')
 const end=day(through),rows=new Map(days.map(row=>[row.date,row]))
 function aggregate(last){
  let clicks=0,impressions=0,weighted=0,available=0,positions=0
  for(let i=0;i<window;i++){
   const key=new Date(last-i*DAY).toISOString().slice(0,10),r=rows.get(key)
   if(!r||r.complete!==true||!Number.isFinite(r.clicks)||!Number.isFinite(r.impressions))continue
   available++;clicks+=r.clicks;impressions+=r.impressions
   if(Number.isFinite(r.position)&&r.impressions>0){weighted+=r.position*r.impressions;positions+=r.impressions}
  }
  if(available!==window)return {state:'incomplete',availableDays:available,requiredDays:window,clicks:null,impressions:null,ctr:null,position:null}
  return {state:'available',availableDays:available,requiredDays:window,clicks,impressions,ctr:impressions?clicks/impressions:null,position:positions===impressions&&positions>0?weighted/positions:null}
 }
 const current=aggregate(end),previous=aggregate(end-window*DAY)
 return {current,previous,clickChange:current.clicks!==null&&previous.clicks!==null?current.clicks-previous.clicks:null,positionChange:current.position!==null&&previous.position!==null?previous.position-current.position:null}
}
