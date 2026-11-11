import test from 'node:test'
import assert from 'node:assert/strict'
import {comparisonPeriod,pageRankingReport} from './websitePageRankings.js'
test('equal adjacent periods span a month or year boundary',()=>{
 assert.deepEqual(comparisonPeriod('2026-01-01','2026-01-03'),{start:'2026-01-01',end:'2026-01-03',previousStart:'2025-12-29',previousEnd:'2025-12-31'})
 assert.throws(()=>comparisonPeriod('2026-02-30','2026-03-01'))
})
test('exact URL/query, comparable filters, weighted position and honest missing rows',()=>{
 const period=comparisonPeriod('2026-01-03','2026-01-04')
 const row=(page,date,position,impressions,clicks,query='term',country='usa',device='mobile')=>({page,date,position,impressions,clicks,query,country,device})
 const rows=[row('/a','2026-01-03',2,5,1),row('/a','2026-01-04',4,15,2),row('/a','2026-01-02',6,12,2),row('/b','2026-01-03',1,10,5),row('/a','2026-01-04',3,2,0,'unplanned'),row('/a','2026-01-04',10,10,5,'term','can'),row('/a','2026-01-04',20,100,0,'term','usa','desktop')]
 const report=pageRankingReport({rows,url:'/a',targets:[{query:'term'},{query:'absent'}],period,country:'usa',device:'mobile'})
 assert.deepEqual(report.targets[0].current,{clicks:3,impressions:20,ctr:.15,position:3.5})
 assert.equal(report.targets[0].movement,2.5)
 assert.equal(report.targets[1].current,null)
 assert.equal(report.targets[1].movement,null)
 assert.deepEqual(report.discovered.map(x=>x.query),['unplanned'])
 assert.deepEqual(report.otherUrls.map(x=>x.page),['/b'])
})
