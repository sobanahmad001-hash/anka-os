import test from 'node:test'
import assert from 'node:assert/strict'
import {requireMediaQuote,requireMediaGenerationAcceptance} from '../../supabase/functions/_shared/designMediaCost.js'
const now=Date.parse('2026-10-15T12:00:00Z')
const request={organization_id:'org',context:{kind:'private',id:'chat'},creative_brief_version_id:'brief',connector_connection_id:'connector',provider:'higgsfield',model_id:'higgsfield-ai/soul/v2/standard',settings:{resolution:'720p'},output_count:4,input_versions:[],prompt_checksum:'a'.repeat(64)}
function quote(unit=500000){return {id:'quote',currency:'USD',request,request_checksum:'b'.repeat(64),unit_max_charge_microusd:unit,total_max_charge_microusd:unit*4,verified_at:'2026-10-15T11:00:00Z',valid_until:'2026-10-15T13:00:00Z'}}
function acceptance(q){return {generate:true,quote_id:q.id,request_checksum:q.request_checksum,total_max_charge_microusd:q.total_max_charge_microusd}}
test('exact $2 total needs Generate only, no second confirmation',()=>assert.equal(requireMediaGenerationAcceptance(request,quote(),acceptance(quote()),now).requiresConfirmation,false))
test('total across multiple outputs above $2 blocks before charge until confirmed',()=>{const q=quote(500001);assert.throws(()=>requireMediaGenerationAcceptance(request,q,acceptance(q),now));assert.equal(requireMediaGenerationAcceptance(request,q,{...acceptance(q),confirm_above_threshold:true},now).requiresConfirmation,true)})
test('changed count/model/settings/brief/source or scope cannot reuse quote',()=>{for(const patch of [{output_count:1},{model_id:'other'},{settings:{resolution:'1080p'}},{creative_brief_version_id:'other'},{input_versions:['new']},{context:{kind:'project',id:'other'}},{prompt_checksum:'c'.repeat(64)}])assert.throws(()=>requireMediaQuote({...request,...patch},quote(),now))})
test('unknown stale future noninteger or inconsistent totals fail closed',()=>{for(const patch of [{total_max_charge_microusd:null},{total_max_charge_microusd:1},{unit_max_charge_microusd:0.1},{valid_until:'2026-10-15T11:59:59Z'},{verified_at:'2026-10-15T12:00:01Z'},{valid_until:'2026-10-17T12:00:00Z'}])assert.throws(()=>requireMediaQuote(request,{...quote(),...patch},now))})
test('acceptance binds quote checksum and total, never just a boolean',()=>{const q=quote(1000000);for(const patch of [{quote_id:'other'},{request_checksum:'c'.repeat(64)},{total_max_charge_microusd:1},{generate:false}])assert.throws(()=>requireMediaGenerationAcceptance(request,q,{...acceptance(q),confirm_above_threshold:true,...patch},now))})


test('reference quote is explicitly estimated and needs per-request risk consent',()=>{const q={...quote(),price_basis:'estimated',reviewed_at:'2026-10-15T11:00:00Z',verified_at:null};assert.equal(requireMediaQuote(request,q,now).estimated,true);assert.throws(()=>requireMediaGenerationAcceptance(request,q,acceptance(q),now));assert.equal(requireMediaGenerationAcceptance(request,q,{...acceptance(q),accept_estimated_price_risk:true},now).estimated,true)})
test('estimated above USD2 still requires exact confirmation and rejects stale reference',()=>{const q={...quote(600000),price_basis:'estimated',reviewed_at:'2026-10-15T11:00:00Z',verified_at:null};assert.throws(()=>requireMediaGenerationAcceptance(request,q,{...acceptance(q),accept_estimated_price_risk:true},now));assert.equal(requireMediaGenerationAcceptance(request,q,{...acceptance(q),accept_estimated_price_risk:true,confirm_above_threshold:true},now).requiresConfirmation,true);assert.throws(()=>requireMediaQuote(request,{...q,reviewed_at:null},now));assert.throws(()=>requireMediaQuote(request,{...q,price_basis:'unknown'},now))})


test('seven-day estimated quotes retain exact acceptance and above-$2 confirmation',()=>{
 const reviewed_at='2026-10-15T11:00:00Z';const until=Date.parse(reviewed_at)+7*86400000;
 const q={...quote(600000),price_basis:'estimated',reviewed_at,verified_at:null,valid_until:new Date(until).toISOString()};
 assert.equal(requireMediaQuote(request,q,now).estimated,true);
 assert.throws(()=>requireMediaGenerationAcceptance(request,q,{...acceptance(q),accept_estimated_price_risk:true},now));
 assert.equal(requireMediaGenerationAcceptance(request,q,{...acceptance(q),accept_estimated_price_risk:true,confirm_above_threshold:true},now).requiresConfirmation,true);
 assert.throws(()=>requireMediaQuote(request,{...q,valid_until:new Date(until+1).toISOString()},now));
 assert.throws(()=>requireMediaQuote(request,q,until));
 assert.throws(()=>requireMediaGenerationAcceptance(request,q,{...acceptance(q),confirm_above_threshold:true},now));
});
test('verified and legacy quotes remain limited to exactly 24 hours',()=>{
 for(const basis of [undefined,'verified']){
 const q={...quote(),price_basis:basis,valid_until:'2026-10-16T11:00:00Z'};
 assert.equal(requireMediaQuote(request,q,now).estimated,false);
 assert.throws(()=>requireMediaQuote(request,{...q,valid_until:'2026-10-16T11:00:00.001Z'},now));
 }
});
