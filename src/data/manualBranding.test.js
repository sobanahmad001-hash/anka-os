import test from 'node:test'
import assert from 'node:assert/strict'
import {brandingGroups,brandKinds,approvedBrandVersion} from './manualBranding.js'

test('Branding has six asset types, with Primary logo in the Logo suite',()=>{
  assert.deepEqual(brandingGroups.map(g=>g.title),['Brand strategy & messaging','Visual identity'])
  assert.deepEqual(brandKinds.map(k=>k.label),['Brand statement','Messaging guide','Tone of voice','Mood board','Logo suite','Visual identity guide'])
  assert.equal(brandKinds.find(k=>k.key==='logo_suite').example,'Primary logo')
})

test('shared Branding resolves the pinned, approved version after a later draft',()=>{
  const pinned={id:'v1',review_status:'ready_for_client_review',client_approval_required:false,approvals:[{approval_type:'internal_quality',decision:'approved'}]}
  const draft={...pinned,id:'v2',approvals:[]}
  const deliverable={versions:[draft,pinned]}
  assert.equal(approvedBrandVersion(deliverable,'v1'),pinned)
  assert.equal(approvedBrandVersion(deliverable,'v2'),null)
  assert.equal(approvedBrandVersion(deliverable,null),null)
  assert.equal(approvedBrandVersion({versions:[{...pinned,withdrawn_at:'yesterday'}]},'v1'),null)
  assert.equal(approvedBrandVersion({versions:[{...pinned,client_approval_required:true}]},'v1'),null)
})
