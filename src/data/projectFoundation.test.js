import test from 'node:test'
import assert from 'node:assert/strict'
import {validateProjectFoundation,foundationForSetup} from './projectFoundation.js'
import {validateProjectSetup,setupRequest,setupPrompt} from './projectSetup.js'
const id=n=>`00000000-0000-0000-0000-${String(n).padStart(12,'0')}`
const intent=()=>({version:1,engagement_id:id(1),written:{mode:'approved_version',artifact_id:id(2),version_id:id(3),checksum:'a'.repeat(64),approval_id:id(4)},visual:{mode:'minimum',guidance:'  Use the existing typography.  ',reason:'  Scoped text preview, imagery pending.  '}})
const snapshot={token:'a'.repeat(32),leaves:[{id:id(10),name:'Page copy',unit:'page',recurrence:'once',department_id:'content'}],catalog:[],scopes:[],state:{plan:{foundation:{intent:intent()}}}}
const plan=()=>({items:[{service_id:id(10),quantity:1,cadence:'once',custom_cadence:'',pipeline:'website',channels:[],audience:'standard',delivery_method:'human',deliverable_key:'',evidence:'Reviewed homepage'}],pipelines:['website'],questions:[],explanation:'One page'})
test('approved exact source and reviewed minimum guidance normalize without an approval or readiness claim',()=>{
 const value=validateProjectFoundation(intent());assert.equal(value.written.approval_id,id(4));assert.equal(value.visual.guidance,'Use the existing typography.');assert.equal(value.visual.reason,'Scoped text preview, imagery pending.');assert.equal(Object.hasOwn(value,'ready_for_preparation'),false)
})
test('missing roles are explicit null gaps, not invented sources or forced Branding',()=>{
 const value=validateProjectFoundation({version:1,engagement_id:id(1)});assert.equal(value.written,null);assert.equal(value.visual,null)
 const p=validateProjectSetup({...plan(),foundation:value},snapshot);assert.deepEqual(p.pipelines,['website']);assert.equal(p.ready,true);assert.equal(p.foundation.written,null)
})
test('old callers preserve the saved exact intent and do not mutate historical snapshot',()=>{
 const before=structuredClone(snapshot);const valid=validateProjectSetup(plan(),snapshot);assert.deepEqual(valid.foundation,validateProjectFoundation(intent()));assert.deepEqual(snapshot,before)
 assert.deepEqual(validateProjectSetup(valid,snapshot),valid);assert.equal(foundationForSetup({},{}),undefined)
})
test('explicit replacement is reviewed, while null reset and unknown authority fields deny',()=>{
 assert.throws(()=>validateProjectFoundation(null));assert.throws(()=>validateProjectSetup({...plan(),foundation:null},snapshot))
 for(const extra of [{approved:true},{brand_id:id(9)},{ready_for_preparation:true},{created_by:id(9)}])assert.throws(()=>validateProjectFoundation({...intent(),...extra}))
 const next=intent();next.written=null;assert.equal(validateProjectSetup({...plan(),foundation:next},snapshot).foundation.written,null)
})
test('source identity, checksum, approval and supported mode are required independently',()=>{
 for(const field of ['artifact_id','version_id','approval_id','checksum']){const value=intent();value.written[field]='invalid';assert.throws(()=>validateProjectFoundation(value))}
 for(const patch of [{content:'private body'},{mode:'latest'},{approved_by:id(7)}]){const value=intent();Object.assign(value.written,patch);assert.throws(()=>validateProjectFoundation(value))}
})
test('minimum guidance and reason are bounded, explicit and cannot carry arbitrary source fields',()=>{
 for(const patch of [{guidance:''},{reason:' '},{guidance:'x'.repeat(4001)},{reason:'x'.repeat(1001)},{artifact_id:id(2)}]){const value=intent();Object.assign(value.visual,patch);assert.throws(()=>validateProjectFoundation(value))}
})
test('setup provider disclosure never silently includes saved guideline text or approval metadata',()=>{
 const d=setupRequest(snapshot,'One page',validateProjectSetup(plan(),snapshot),['content']);const prompt=setupPrompt(d)
 assert.equal(prompt.includes('Use the existing typography.'),false);assert.equal(prompt.includes(id(4)),false)
})
test('ECMAScript whitespace and raw UTF16 limits agree with direct-RPC normalization',()=>{
 const spaces=[9,10,11,12,13,32,160,5760,...Array.from({length:11},(_,i)=>8192+i),8232,8233,8239,8287,12288,65279].map(cp=>String.fromCodePoint(cp))
 for(const value of spaces)for(const field of ['guidance','reason']){const v=intent();v.visual[field]=value+value;assert.throws(()=>validateProjectFoundation(v))}
 const all=spaces.join(''),v=intent();v.visual={mode:'minimum',guidance:all+'guidance'+all,reason:all+'reason'+all};assert.equal(validateProjectFoundation(v).visual.guidance,'guidance');assert.equal(validateProjectFoundation(v).visual.reason,'reason')
 for(const [guidance,reason] of [['x'.repeat(4000),'r'.repeat(1000)],['漢'.repeat(4000),'r'],['🙂'.repeat(2000),'🙂'.repeat(500)],['\u0085','\u200b']])assert.equal(validateProjectFoundation({...intent(),visual:{mode:'minimum',guidance,reason}}).visual.guidance,guidance)
 for(const [guidance,reason] of [['x'.repeat(4001),'r'],[' '+'x'.repeat(4000),'r'],['g','r'.repeat(1001)],['g',' '+'r'.repeat(1000)],['🙂'.repeat(2001),'r'],['g','🙂'.repeat(501)],[' '+'🙂'.repeat(2000),'r']])assert.throws(()=>validateProjectFoundation({...intent(),visual:{mode:'minimum',guidance,reason}}))
})
