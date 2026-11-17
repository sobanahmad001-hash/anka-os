export const batchSize = 1000
export function dateWindow(now=new Date()) {
  const today=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Los_Angeles',year:'numeric',month:'2-digit',day:'2-digit'}).format(now)
  const day=(n:number)=>new Date(Date.parse(today+'T12:00:00Z')-n*86400000).toISOString().slice(0,10)
  return {start:day(92),end:day(3)}
}
export async function fetchBatch(site:string,token:string,start:string,end:string,phase:string,offset:number,get=fetch) {
  const base='https://www.googleapis.com/webmasters/v3/sites/'+encodeURIComponent(site)
  const options={headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},redirect:'error' as const,signal:AbortSignal.timeout(25000)}
  const access=await get(base,options)
  if(!access.ok)throw Error('Search Console property access is unavailable.')
  const property=await access.json()
  if(property.siteUrl!==site||!['siteOwner','siteFullUser','siteRestrictedUser'].includes(property.permissionLevel))throw Error('Google did not confirm access to the exact property.')
  const dimensions=phase==='pages'?['page']:['page','query']
  const response=await get(base+'/searchAnalytics/query',{...options,method:'POST',body:JSON.stringify({startDate:start,endDate:end,dimensions,type:'web',dataState:'final',aggregationType:'byPage',startRow:offset,rowLimit:batchSize})})
  if(!response.ok)throw Error('Google returned HTTP '+response.status+'. Resume to retry this batch.')
  const data=await response.json(),rows=data.rows??[]
  if(!Array.isArray(rows)||rows.length>batchSize)throw Error('Invalid Google reporting response.')
  return rows.map(row=>{
    if(!Array.isArray(row.keys)||row.keys.length!==dimensions.length||row.keys.some((key:unknown)=>typeof key!=='string'||!key)||
      ![row.clicks,row.impressions,row.ctr,row.position].every(Number.isFinite))throw Error('Invalid Google reporting row.')
    return {page:row.keys[0],query:row.keys[1]??'',clicks:row.clicks,impressions:row.impressions,ctr:row.ctr,position:row.position}
  })
}
