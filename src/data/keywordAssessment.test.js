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

test('empty Home context labels full project-name evidence and brand destinations',()=>{
 const row={query:'  ROYAL Executive Limo! ',impressions:90,position:8,overlap_count:3}
 const result=assessQuery(row,{title:'Home',path:'/',brief:''},null,'Royal Executive Limo')
 assert.equal(result.brandCandidate,true)
 assert.equal(result.role,'supporting')
 assert.match(result.explanation,/project name/)
 assert.match(result.intent,/Navigational/)
 assert.ok(result.flags.some(flag=>flag.startsWith('Missing page context')))
 assert.ok(result.flags.some(flag=>flag.includes('Review whether each destination')))
 assert.ok(result.flags.every(flag=>!flag.includes('Weak relevance')&&!flag.includes('Overlapping URLs')))
})

test('partial names and service queries require page evidence',()=>{
 const page={title:'Home',path:'/',brief:''}
 for(const query of ['royal executive','royal executive limo airport transfer','another limo company']){
  const result=assessQuery({query,impressions:90,position:8,overlap_count:2},page,null,'Royal Executive Limo')
  assert.equal(result.brandCandidate,false)
  assert.ok(result.flags.some(flag=>flag.startsWith('Missing page context')))
  assert.ok(result.flags.some(flag=>flag.startsWith('Overlapping URLs')))
 }
 assert.equal(assessQuery({query:'royal executive limo',impressions:90,position:8},page,null,'Airport website redesign').brandCandidate,false)
 assert.equal(assessQuery({query:'royal executive limo',impressions:90,position:8},{...page,path:'/airport'},null,'Royal Executive Limo').brandCandidate,false)
})

test('real metadata still supports relevance and assessment leaves a selected target intact',()=>{
 const page={title:'Home',path:'/',brief:'',targets:[{query:'royal executive limo',role:'supporting',locale:'en-US',intent:'Navigational'}]}
 const decision={query:'royal executive limo',state:'selected',revision:1}
 const before=JSON.stringify({page,decision})
 const result=assessQuery({query:'airport transfers',impressions:90,position:8,overlap_count:1},page,{title:'Airport transfers in New York'},'Royal Executive Limo')
 assert.equal(result.role,'primary')
 assert.ok(result.flags.every(flag=>!flag.startsWith('Missing')))
 assert.equal(JSON.stringify({page,decision}),before)
})
