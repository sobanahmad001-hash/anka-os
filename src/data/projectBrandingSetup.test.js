import test from 'node:test'
import assert from 'node:assert/strict'
import {SERVICE_CATALOGUE} from './serviceCatalogue.js'
import {SETUP_PIPELINES,validateProjectSetup,defaultSetupItem} from './projectSetup.js'
const leaf=SERVICE_CATALOGUE.find(row=>row.slug==='setup_content_discovery_brief')
const snapshot={token:'a'.repeat(32),leaves:[leaf],catalog:[leaf],scopes:[],state:null}
const metadata={catalogue_version:1,service_group:'branding',start_date:'2026-11-02',target_date:null,timezone:'Asia/Karachi',generation_horizon:null,scope_statement:'Reviewed brand discovery',exclusions:'No distribution'}
const proposal={service_line_version:2,items:[{...defaultSetupItem(leaf),quantity:1,pipeline:'branding',service_line:metadata}],pipelines:['branding','website','marketing'],questions:[],explanation:'Explicit Branding contribution'}
test('three independent tracks accept an explicit reviewed v2 Branding contribution without changing quantity or unit',()=>{
 assert.deepEqual(SETUP_PIPELINES,['branding','website','marketing']);assert.ok(Object.isFrozen(SETUP_PIPELINES))
 const v=validateProjectSetup(proposal,snapshot)
 assert.equal(v.ready,true);assert.equal(v.items[0].pipeline,'branding');assert.equal(v.items[0].quantity,1);assert.equal(v.items[0].unit,leaf.unit);assert.equal(v.items[0].service_line.service_group,'branding')
 assert.equal(snapshot.scopes.length,0);assert.equal(Object.hasOwn(v,'activate'),false)
})
test('legacy/implicit Branding and mismatched business scope cannot bypass the v2 source review',()=>{
 const old={...proposal,items:proposal.items.map(({service_line:_line,...row})=>row)};delete old.service_line_version
 assert.throws(()=>validateProjectSetup(old,snapshot),/version 2 Branding/)
 assert.throws(()=>validateProjectSetup({...proposal,items:[{...proposal.items[0],service_line:{...metadata,service_group:'website'}}]},snapshot),/version 2 Branding/)
 assert.throws(()=>validateProjectSetup({...proposal,pipelines:[...proposal.pipelines,'other']},snapshot),/bounded/)
})
