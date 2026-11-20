import test from 'node:test'
import assert from 'node:assert/strict'
import {runTrackingBatch} from '../../supabase/functions/_shared/websiteTrackingBatch.js'
test('wake resumes bounded pages and stops on retry or an uncertain result',async()=>{
 let calls=0
 await runTrackingBatch({run:async()=>{calls++;return {state:'queued'}},now:()=>0,maxPages:8})
 assert.equal(calls,8)
 for(const state of ['retry','uncertain','outcome_unknown','succeeded','disconnected']){
  calls=0;await runTrackingBatch({run:async()=>{calls++;return {state}},now:()=>0})
  assert.equal(calls,1,state)
 }
})
test('wake stops dispatching when its time budget is exhausted',async()=>{
 let elapsed=0,calls=0
 await runTrackingBatch({run:async()=>{calls++;elapsed+=21000;return {state:'queued'}},now:()=>elapsed})
 assert.equal(calls,2)
})
