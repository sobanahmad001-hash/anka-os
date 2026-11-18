import test from 'node:test'
import assert from 'node:assert/strict'
import {eligibleKeyword,submitKeywordReview} from './bulkKeywordReview.js'
test('bulk selection excludes existing targets, dismissed decisions and absent evidence',()=>{
 assert.equal(eligibleKeyword({roles:'primary',state:'selected',impressions:3}),false)
 assert.equal(eligibleKeyword({roles:null,state:'dismissed',impressions:3}),false)
 assert.equal(eligibleKeyword({roles:null,state:'suggested',impressions:null}),false)
 assert.equal(eligibleKeyword({roles:null,state:'suggested',impressions:3}),true)
})
test('partial success and lost response reuse the exact request; each acceptance reads the new page revision',async()=>{
 const scope={p_org:'org',p_project:'project'}
 const review={page:'page',action:'selected',rows:['one','two'].map(query=>({query,revision:0,intent:'Service enquiry',locale:'en-US',status:'ready',request:null}))}
 let revision=4,lost=true
 const receipts=new Map(),calls=[]
 const rpc=async(name,args)=>{
  if(name==='website_page_index')return {items:[{id:'page',revision}]}
  calls.push(structuredClone(args))
  assert.equal(args.p_role,'supporting');assert.equal(args.p_project,'project')
  if(!receipts.has(args.p_request)){
   assert.equal(args.p_page_revision,revision)
   receipts.set(args.p_request,true);revision++
  }
  if(args.p_query==='two'&&lost){lost=false;throw Error('Lost response')}
 }
 const save=()=>{}
 await submitKeywordReview({review,scope,rpc,save})
 assert.deepEqual(review.rows.map(r=>r.status),['saved','retry'])
 await submitKeywordReview({review,scope,rpc,save})
 assert.equal(receipts.size,2);assert.equal(calls.length,3);assert.deepEqual(calls[1],calls[2])
 assert.deepEqual(review.rows.map(r=>r.status),['saved','saved'])
})
test('conflicted rows are reported while other dismissals continue',async()=>{
 const review={page:'page',action:'dismissed',rows:['changed','available'].map(query=>({query,revision:0,status:'ready',request:null}))}
 let writes=0
 const rpc=async(name,args)=>{
  if(name==='website_page_index')return {items:[{id:'page',revision:1}]}
  writes++
  assert.equal(args.p_role,null)
  if(args.p_query==='changed')throw Object.assign(Error('Decision changed'),{code:'40001'})
 }
 await submitKeywordReview({review,scope:{p_org:'o',p_project:'p'},rpc,save:()=>{}})
 assert.deepEqual(review.rows.map(r=>r.status),['conflict','saved'])
 await submitKeywordReview({review,scope:{},rpc,save:()=>{}})
 assert.equal(writes,2)
})
