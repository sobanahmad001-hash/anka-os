import test from 'node:test'
import assert from 'node:assert/strict'
import {createDailyGscAdapter,dailyGscContract} from '../../supabase/functions/_shared/dailyGscAdapter.js'
const context={resource_key:'sc-domain:example.com',binding_id:'binding',context_checksum:'scope',project_id:'project',organization_id:'org'}
const identity={...context,source_contract:dailyGscContract.sourceContract,period_start:'2026-11-16',period_end:'2026-11-16',reporting_time_zone:'America/Los_Angeles'}
test('retains page totals independently from suppressed query rows',async()=>{
 const requests=[]
 const adapter=createDailyGscAdapter({getToken:async()=> 'fixture',manifestSha256:'a'.repeat(64),fetcher:async(url,options)=>{
  const body=JSON.parse(options.body);requests.push(body)
  return Response.json({responseAggregationType:'byPage',rows:body.dimensions.length===1?[{keys:['https://example.com/'],clicks:10,impressions:100,ctr:.1,position:3}]:[]})
 }})
 const pages=await adapter.fetchPage({identity,context,cursor:null})
 assert.equal(pages.observations.length,4);assert.equal(pages.complete,false)
 assert.ok(pages.observations.every(r=>r.dimensions.series==='pages'&&!Object.hasOwn(r.dimensions,'query')))
 const queries=await adapter.fetchPage({identity,context,cursor:pages.next_cursor})
 assert.equal(queries.complete,true);assert.equal(queries.observations.length,0)
 assert.deepEqual(requests.map(r=>r.dimensions),[['page'],['page','query']])
 assert.ok(requests.every(r=>r.startDate===r.endDate&&r.dataState==='final'))
})
test('scope mismatches make no provider request; quota errors retain retry timing',async()=>{
 let calls=0
 const adapter=createDailyGscAdapter({getToken:async()=> 'fixture',manifestSha256:'a'.repeat(64),now:()=>0,fetcher:async()=>{calls++;return new Response(null,{status:429,headers:{'retry-after':'60'}})}})
 await assert.rejects(adapter.fetchPage({identity,context:{...context,project_id:'other'},cursor:null}),/scope/)
 assert.equal(calls,0)
 await assert.rejects(adapter.fetchPage({identity,context,cursor:null}),e=>e.reason==='rate_limited'&&e.retryAfter==='1970-01-01T00:01:00.000Z')
})
