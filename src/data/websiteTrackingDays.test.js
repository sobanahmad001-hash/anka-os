import test from 'node:test'
import assert from 'node:assert/strict'
import {trackingDays,compareDailyTracking} from '../../supabase/functions/_shared/websiteTrackingDays.js'
test('daily plan refreshes recent finalized dates and uses bounded one-day backfill',()=>{
 const completed=[{date:'2026-11-16',refreshedOn:'2026-11-18'},{date:'2026-11-15',refreshedOn:'2026-11-19'}]
 const plan=trackingDays({today:'2026-11-19',completed,limit:3})
 assert.deepEqual(plan.map(x=>x.start),['2026-11-16','2026-11-14','2026-11-13'])
 assert.ok(plan.every(x=>x.start===x.end))
 assert.throws(()=>trackingDays({today:'2026-02-30'}))
})
test('missing or suppressed daily rows never become zero or fake position changes',()=>{
 const result=compareDailyTracking({days:[],through:'2026-11-16'})
 assert.equal(result.current.clicks,null);assert.equal(result.positionChange,null)
})
test('daily comparisons weight position by impressions and require both full windows',()=>{
 const days=Array.from({length:14},(_,i)=>({date:new Date(Date.parse('2026-11-16T12:00:00Z')-i*86400000).toISOString().slice(0,10),complete:true,clicks:2,impressions:10,position:i<7?4:6}))
 const result=compareDailyTracking({days,through:'2026-11-16'})
 assert.equal(result.current.clicks,14);assert.equal(result.current.ctr,.2);assert.equal(result.positionChange,2)
 days.pop();assert.equal(compareDailyTracking({days,through:'2026-11-16'}).positionChange,null)
})
