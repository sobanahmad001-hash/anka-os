import test from 'node:test'
import assert from 'node:assert/strict'
import {websiteBulkPatch} from './websiteBulkOperations.js'
test('bulk supports only explicit template and internal progress without approval/publication/ownership fields',()=>{for(const patch of [{},{publication_state:'published'},{publication_state:'retired'},{assignee_id:'actor'},{work_item_id:null},{template:''},{template:' padded '},{template:'x'.repeat(161)},{template:'x\ny'}])assert.throws(()=>websiteBulkPatch(patch));assert.deepEqual(websiteBulkPatch({template:'Shared',publication_state:'review'}),{template:'Shared',publication_state:'review'})})
