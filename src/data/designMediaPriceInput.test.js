import test from 'node:test'
import assert from 'node:assert/strict'
import {usdBoundToMicrousd} from './designMediaPriceInput.js'
test('USD entry preserves exact six-place bounds without rounding or credit inference',()=>{
 for(const [input,result] of [['0.1758',175800],['0.003',3000],['2',2000000],['2.000001',2000001],['0.000001',1]])assert.equal(usdBoundToMicrousd(input),result);
 for(const input of ['0','-1','1e2','1,000','0.0000001','USD 2','10 credits','90071993','Infinity',''])assert.throws(()=>usdBoundToMicrousd(input));
})
