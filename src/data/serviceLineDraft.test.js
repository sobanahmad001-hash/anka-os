import test from 'node:test'
import assert from 'node:assert/strict'
import {serviceLineDraft,retainServiceLineDrafts} from '../components/serviceLineDraft.js'
const saved={catalogue_version:1,service_group:'marketing',start_date:'2026-11-01',target_date:'2027-02-01',timezone:'Asia/Karachi',generation_horizon:3,scope_statement:'Saved scope',exclusions:'Saved exclusion'}
const snapshot={scopes:[{service_id:'a',start_date:'2026-11-03',target_date:null,scope_statement:'Current scope',exclusions:''}],state:{plan:{contributions:[{service_id:'a',service_line:saved}]}}}
test('service line editor starts from current canonical dates and scope, preserving provenance and explicit nulls',()=>{
 const draft=serviceLineDraft(snapshot,'a');assert.equal(draft.start_date,'2026-11-03');assert.equal(draft.target_date,null);assert.equal(draft.scope_statement,'Current scope');assert.equal(draft.exclusions,'');assert.equal(draft.timezone,'Asia/Karachi');assert.equal(draft.generation_horizon,3);assert.equal(saved.target_date,'2027-02-01')
})
test('upgrading all selected services retains edits and identity without inventing dates or a business group',()=>{
 const original={items:[{service_id:'a',quantity:12,cadence:'monthly'},{service_id:'b',quantity:3,cadence:'once'}],pipelines:['marketing']};assert.equal(retainServiceLineDrafts(original,snapshot),original)
 const upgraded=retainServiceLineDrafts(original,snapshot,true);assert.equal(upgraded.service_line_version,2);assert.equal(upgraded.items[0].quantity,12);assert.equal(upgraded.items[1].service_line.start_date,'');assert.equal(upgraded.items[1].service_line.service_group,'')
 upgraded.items[0].service_line.scope_statement='Unsaved refined scope';const refined=retainServiceLineDrafts({...upgraded,items:[...upgraded.items,{service_id:'c'}]},snapshot);assert.equal(refined.items[0].service_line.scope_statement,'Unsaved refined scope');assert.equal(refined.items[2].service_line.target_date,null);assert.equal(original.items[0].service_line,undefined)
})
