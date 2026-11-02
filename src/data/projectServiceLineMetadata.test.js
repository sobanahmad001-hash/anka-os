import test from 'node:test'
import assert from 'node:assert/strict'
import {SERVICE_CATALOGUE} from './serviceCatalogue.js'
import {validateServiceLineMetadata} from './projectServiceLineMetadata.js'
const leaf=SERVICE_CATALOGUE.find(row => row.slug==='setup_content_social_post_copy')
const input={catalogue_version:1,service_group:'marketing',start_date:'2026-11-01',target_date:null,timezone:'Asia/Karachi',generation_horizon:1,scope_statement:'12 reviewed social posts per month',exclusions:'Paid distribution excluded'}

test('explicit service intent retains the exact catalogue identity and does not grant execution or opt into scheduling', () => {
  const original=JSON.stringify(input), row=validateServiceLineMetadata(input,leaf,'monthly')
  assert.deepEqual(row,input)
  assert.equal(JSON.stringify(input),original)
  assert.equal(row.enabled,undefined)
  assert.equal(row.scheduler,undefined)
  assert.equal(row.assignee_id,undefined)
})

test('calendar dates, target bounds and known IANA timezone are required without rollover or offset guesses', () => {
  for (const change of [{start_date:'2026-02-29'},{start_date:'0000-01-01'},{start_date:'2026-1-01'},{target_date:'2026-10-31'},{timezone:'+05:00'},{timezone:'Mars/Olympus'},{timezone:''}]) assert.throws(()=>validateServiceLineMetadata({...input,...change},leaf,'monthly'))
  assert.equal(validateServiceLineMetadata({...input,start_date:'2028-02-29',target_date:'2028-03-01',timezone:'America/New_York'},leaf,'monthly').start_date,'2028-02-29')
  assert.equal(validateServiceLineMetadata({...input,timezone:'CET'},leaf,'monthly').timezone,'CET')
})

test('only a current explicit group mapping can classify this canonical service', () => {
  for (const change of [{catalogue_version:2},{service_group:'branding'},{service_group:'website'}]) assert.throws(()=>validateServiceLineMetadata({...input,...change},leaf,'monthly'),/exact catalogue/)
  assert.throws(()=>validateServiceLineMetadata(input,{...leaf,id:'unknown'},'monthly'),/exact catalogue/)
  assert.throws(()=>validateServiceLineMetadata(input,{...leaf,business_group_version:2,business_groups:['marketing']},'monthly'),/mapping changed/)
  const shared=SERVICE_CATALOGUE.find(row=>row.slug==='setup_content_audience_research')
  assert.equal(validateServiceLineMetadata({...input,service_group:'branding'},shared,'monthly').service_group,'branding')
})

test('finite cycle intent is explicit, while once and custom cadence never acquire automatic horizons', () => {
  for (const generation_horizon of [null,0,13,1.5,'1']) assert.throws(()=>validateServiceLineMetadata({...input,generation_horizon},leaf,'monthly'),/horizon/)
  assert.equal(validateServiceLineMetadata({...input,generation_horizon:12},leaf,'quarterly').generation_horizon,12)
  for (const cadence of ['once','per_batch','custom']) {
    assert.throws(()=>validateServiceLineMetadata(input,leaf,cadence),/horizon/)
    assert.equal(validateServiceLineMetadata({...input,generation_horizon:null},leaf,cadence).generation_horizon,null)
  }
})

test('missing essentials or hidden command fields cannot enter a reviewed service line', () => {
  assert.throws(()=>validateServiceLineMetadata(input,leaf,'unknown'),/supported service cadence/)
  const missing={...input};delete missing.start_date
  for (const value of [missing,{...input,scope_statement:''},{...input,exclusions:'x'.repeat(4001)},{...input,scheduler:{enabled:true}},{...input,quantity:12}]) assert.throws(()=>validateServiceLineMetadata(value,leaf,'monthly'))
})
