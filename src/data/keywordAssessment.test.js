import test from 'node:test'
import assert from 'node:assert/strict'
import {assessQuery} from './keywordAssessment.js'
test('query evidence produces explained review flags without inferring locations',()=>{
 const page={title:'Airport taxi Heathrow',brief:'Book a taxi transfer',path:'/heathrow'}
 const good=assessQuery({query:'book heathrow taxi',impressions:100,position:8,overlap_count:2},page)
 assert.equal(good.role,'primary');assert.equal(good.opportunity,true);assert.equal(good.intent,'Commercial / transactional')
 assert.ok(good.flags.some(x=>x.includes('Overlapping')))
 const weak=assessQuery({query:'manchester hotels',impressions:4,position:2,overlap_count:0},page)
 assert.equal(weak.role,'supporting');assert.equal(weak.opportunity,false);assert.equal(weak.flags.length,2)
})
