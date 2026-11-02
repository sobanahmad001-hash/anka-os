import test from 'node:test'
import assert from 'node:assert/strict'
import {SERVICE_CATALOGUE} from './serviceCatalogue.js'
import {validateProjectSetup,defaultSetupItem,setupDiff,setupRequest,setupAnswer} from './projectSetup.js'
const leaf=SERVICE_CATALOGUE.find(x=>x.slug==='setup_content_social_post_copy')
const snapshot={token:'a'.repeat(32),leaves:[leaf],catalog:[leaf],scopes:[],state:null}
const line={catalogue_version:1,service_group:'marketing',start_date:'2026-11-01',target_date:'2027-01-31',timezone:'Asia/Karachi',generation_horizon:1,scope_statement:'  Twelve reviewed posts per month  ',exclusions:' No paid distribution '}
const proposal={items:[{...defaultSetupItem(leaf),quantity:12,pipeline:'marketing'}],pipelines:['marketing'],questions:[],explanation:'Explicit manual scope'}

test('v1 proposals retain their exact shape and v2 intent cannot be hidden in an old command',()=>{
 const result=validateProjectSetup(proposal,snapshot)
 assert.equal(result.service_line_version,undefined)
 assert.equal(result.items[0].service_line,undefined)
 assert.throws(()=>validateProjectSetup({...proposal,items:[{...proposal.items[0],service_line:line}]},snapshot),/version 2/)
 assert.throws(()=>validateProjectSetup({...proposal,service_line_version:1},snapshot),/Unsupported/)
})
test('v2 carries explicit normalized scope and dates with unchanged quantity, canonical unit and pipeline identity',()=>{
 const result=validateProjectSetup({...proposal,service_line_version:2,items:[{...proposal.items[0],service_line:line}]},snapshot)
 assert.equal(result.ready,true);assert.equal(result.items[0].quantity,12);assert.equal(result.items[0].unit,leaf.unit)
 assert.equal(result.items[0].pipeline,'marketing');assert.equal(result.items[0].service_line.scope_statement,'Twelve reviewed posts per month')
 assert.equal(result.items[0].service_line.timezone,'Asia/Karachi');assert.equal(result.service_line_version,2)
 assert.deepEqual(setupDiff(result,snapshot)[0].after.service_line,result.items[0].service_line)
 assert.throws(()=>validateProjectSetup({...proposal,service_line_version:2},snapshot),/complete service-line/)
})
test('existing v2 lines require a v2 review and show actual canonical date/scope preimages',()=>{
 const existing={...snapshot,scopes:[{service_id:leaf.id,status:'proposed',revision:3,quantity:10,unit:leaf.unit,recurrence:'monthly',start_date:'2026-10-01',target_date:'2026-12-31',scope_statement:'Original ten posts',exclusions:'Original exclusion'}],state:{plan:{contributions:[{service_id:leaf.id,service_line:{...line,start_date:'2026-09-01'}}]}}}
 assert.throws(()=>validateProjectSetup(proposal,existing),/version 2/)
 const result=validateProjectSetup({...proposal,service_line_version:2,items:[{...proposal.items[0],service_line:line}]},existing)
 const diff=setupDiff(result,existing)[0]
 assert.equal(diff.before.service_line.start_date,'2026-10-01');assert.equal(diff.before.service_line.scope_statement,'Original ten posts')
 assert.equal(diff.after.service_line.start_date,'2026-11-01');assert.equal(result.items[0].expected_revision,3)
 assert.throws(()=>validateProjectSetup({...proposal,service_line_version:2,items:[{...proposal.items[0],service_line:line}]},{...existing,scopes:[{...existing.scopes[0],status:'completed'}]}),/historical/)
})
test('saved chat refinement cannot downgrade explicit v2 dates or erase retained intent',()=>{
 const previous={...proposal,service_line_version:2,items:[{...proposal.items[0],service_line:line}]}
 const disclosure=setupRequest(snapshot,'Refine the wording without changing dates',previous,['content'])
 assert.equal(disclosure.previous.service_line_version,2)
 const {service_id:_id,unit:_unit,expected_revision:_revision,...item}=previous.items[0]
 const answer={items:[{...item,service_index:0}],pipelines:['marketing'],questions:[],explanation:'Same dates'}
 assert.throws(()=>setupAnswer(JSON.stringify(answer),disclosure,snapshot),/did not retain/)
 assert.equal(setupAnswer(JSON.stringify({...answer,service_line_version:2}),disclosure,snapshot).items[0].service_line.start_date,line.start_date)
})
