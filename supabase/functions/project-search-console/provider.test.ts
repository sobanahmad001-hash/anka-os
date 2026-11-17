import {dateWindow,fetchBatch} from './provider.ts'
Deno.test('90 days cross year and use Pacific dates',()=>{
 const w=dateWindow(new Date('2026-01-02T02:00:00Z'))
 if(w.end!=='2025-12-29'||Date.parse(w.end)-Date.parse(w.start)!==89*86400000)throw Error(JSON.stringify(w))
})
Deno.test('fetches unfiltered final web rows, separate totals and the requested cursor',async()=>{
 for(const phase of ['pages','queries']){
  let count=0
  const result=await fetchBatch('sc-domain:example.com','fixture','2026-01-01','2026-03-31',phase,1000,async(_,init)=>{
   if(!count++)return Response.json({siteUrl:'sc-domain:example.com',permissionLevel:'siteFullUser'})
   const b=JSON.parse(String(init?.body))
   if(b.startRow!==1000||b.type!=='web'||b.dataState!=='final'||b.dimensionFilterGroups||b.dimensions.join('/')!==(phase==='pages'?'page':'page/query'))throw Error('Wrong request')
   return Response.json({rows:[{keys:phase==='pages'?['https://example.com/']:['https://example.com/','organic'],clicks:1,impressions:2,ctr:0.5,position:3}]})
  })
  if(result[0].query!==(phase==='pages'?'':'organic'))throw Error('Incorrect row')
 }
})
