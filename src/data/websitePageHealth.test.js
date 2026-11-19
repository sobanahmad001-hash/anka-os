import test from 'node:test'
import assert from 'node:assert/strict'
import {summarizePageHealth,healthWorkStatus,workAspect} from './websitePageHealth.js'
const now=Date.parse('2026-11-18T12:00:00Z')
test('missing evidence is unknown and never green',()=>{
 const result=summarizePageHealth({},now)
 assert.ok(result.aspects.every(a=>a.status==='Not checked'&&a.unknown>0))
})
test('GSC page totals do not establish technical indexability or zero query position',()=>{
 const result=summarizePageHealth({tracking:{pageObserved:true,synced:'2026-11-18',through:'2026-11-15'}},now)
 assert.equal(result.aspects[0].status,'Checked')
 assert.equal(result.aspects[2].status,'Not checked')
 assert.equal(result.aspects[2].checks.find(c=>c.label==='Indexing').state,'unknown')
})
test('stored discovery findings remain stale without an observation time; URL changes invalidate metadata',()=>{
 const row={url:'https://example.com/',source:{url:'https://example.com/',meta:{url:'https://example.com/',title:'',description:'',h1:'Hello',status:404,canonical:''}}}
 const result=summarizePageHealth(row,now)
 assert.equal(result.aspects[1].status,'Needs attention')
 assert.equal(result.aspects[1].stale,true)
 assert.equal(result.aspects[2].issues,2)
 row.url='https://example.com/new'
 assert.equal(summarizePageHealth(row,now).aspects[1].issues,0)
})
test('stale version evidence cannot certify indexing and completed Work is not verification',()=>{
 const result=summarizePageHealth({manual:{recheck_required:true,check:{checked_at:'2026-11-18',evidence:{indexed:true,findings:[]}}}},now)
 assert.equal(result.aspects[2].checks.find(c=>c.label==='Indexing').state,'unknown')
 assert.equal(healthWorkStatus({status:'done'}),'Ready for review')
 assert.equal(healthWorkStatus({status:'done',review_state:'verified',evidence:'Checked',verified_date:'2026-11-17'}),'Verified')
 assert.equal(workAspect({service:'seo_operations'}),null)
 assert.equal(workAspect({service:'setup_marketing_technical_seo_audit'}),'technical')
})
