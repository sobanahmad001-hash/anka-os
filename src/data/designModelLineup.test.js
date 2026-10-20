import test from 'node:test';import assert from 'node:assert/strict';
import {LINEUP_CONTRACTS,buildLineupInput} from '../../supabase/functions/_shared/designModelLineup.js';
for(const [model,spec] of Object.entries(LINEUP_CONTRACTS))test('closed pending lineup contract '+model,()=>{
 const image=spec.input?'https://synthetic.invalid/exact-original.png':undefined;
 const value=buildLineupInput(model,'Synthetic brief',spec.defaults,1,image);assert.equal(value.prompt,'Synthetic brief');assert.equal(value.image_url,image);
 for(const settings of [{...spec.defaults,webhook:'https://outside.invalid'},Object.fromEntries(Object.entries(spec.defaults).slice(1))])assert.throws(()=>buildLineupInput(model,'Synthetic brief',settings,1,image));
 assert.throws(()=>buildLineupInput(model,'Synthetic brief',spec.defaults,4,image));assert.throws(()=>buildLineupInput(model,'x'.repeat(spec.maxPrompt+1),spec.defaults,1,image));
 if(spec.input)for(const source of [undefined,'http://unsafe.invalid','https://user:pass@unsafe.invalid'])assert.throws(()=>buildLineupInput(model,'Synthetic brief',spec.defaults,1,source));else assert.throws(()=>buildLineupInput(model,'Synthetic brief',spec.defaults,1,'https://unexpected.invalid'));
});
test('no unverified variant or fallback',()=>{assert.throws(()=>buildLineupInput('kling-video/v3.0/pro/text-to-video','Synthetic',{},1));assert.throws(()=>buildLineupInput('unknown','Synthetic',{},1))});
