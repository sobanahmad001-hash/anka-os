import test from 'node:test'
import assert from 'node:assert/strict'
import {draftProjectDefaultTracks,reviewFoundationSources,validateDefaultTrackDag} from './projectDefaultTracks.js'
const scope={organization_id:'org',project_id:'project',brand_id:'brand'}
const source=(role,n)=>({...scope,role,artifact_id:'artifact'+n,version_id:'version'+n,checksum:String(n).repeat(64),approval_id:'approval'+n,approved_by:'human',approved_at:'2026-11-02T00:00:00Z'})
const sources=[source('written',1),source('visual',2)]
const foundation=Object.fromEntries(sources.map(s=>[s.role,{mode:'approved_version',artifact_id:s.artifact_id,version_id:s.version_id,checksum:s.checksum}]))
const item=(id,group)=>({service_id:id,quantity:12,unit:'post',service_line:{service_group:group}})

test('exact approved sources pin both roles without upgrading proposal to readiness or publication',()=>{
 const value=reviewFoundationSources(scope,foundation,sources)
 assert.equal(value.sources_available,true);assert.equal(value.ready_for_preparation,false);assert.equal(value.ready_for_traffic,false)
 assert.equal(value.pins.written.version_id,'version1');assert.equal(value.pins.visual.approval_id,'approval2')
 assert.equal(Object.hasOwn(value.pins.written,'content'),false)
})
test('foreign project, brand, revoked approval, checksum change and newest draft cannot substitute exact evidence',()=>{
 for(const patch of [{project_id:'other'},{brand_id:'other'},{organization_id:'other'},{revoked:true},{checksum:'a'.repeat(64)},{approval_id:null},{role:'visual'}])assert.throws(()=>reviewFoundationSources(scope,foundation,[{...sources[0],...patch},sources[1]]),/unavailable or changed/)
 assert.throws(()=>reviewFoundationSources(scope,foundation,[{...sources[0],version_id:'newer',approval_id:null},sources[1]]),/unavailable or changed/)
})
test('missing guidance remains an explicit gap; minimum guidance requires review and a bounded reason',()=>{
 assert.deepEqual(reviewFoundationSources(scope,{},sources).gaps.map(g=>g.role),['written','visual'])
 assert.throws(()=>reviewFoundationSources(scope,{written:{mode:'minimum',guidance:'tone',reason:''}}),/limited-scope reason/)
 const v=reviewFoundationSources(scope,{written:{mode:'minimum',guidance:'  tone  ',reason:'Small internal update'}})
 assert.equal(v.pins.written.guidance,'tone');assert.equal(v.requires_review,true);assert.equal(v.ready_for_preparation,false);assert.equal(v.gaps[0].role,'visual')
})
test('group labels alone never invent a full track or Branding purchase',()=>{
 const items=[item('marketing-service','marketing')],before=structuredClone(items)
 const v=draftProjectDefaultTracks({scope,items})
 assert.deepEqual(v.tracks,['marketing']);assert.deepEqual(v.stages,[]);assert.equal(v.unmapped_services[0].service_id,'marketing-service');assert.deepEqual(items,before)
 assert.equal(v.creates_work,false);assert.equal(v.schedules_cycles,false);assert.equal(v.authorizes_paid_calls,false)
})
test('explicit track mapping closes dependencies and preserves selected canonical quantity without summing departments',()=>{
 const items=[item('copy','marketing'),item('design','marketing')]
 const v=draftProjectDefaultTracks({scope,items,foundation,approvedSources:sources,stageAssignments:[{service_id:'copy',stage_keys:['marketing.content']},{service_id:'design',stage_keys:['marketing.design']}]})
 assert.deepEqual(v.stages.map(s=>s.key),['shared.brand_context','marketing.research','marketing.cycle_plan','marketing.content','marketing.design'])
 assert.deepEqual(v.stages.find(s=>s.key==='marketing.content').service_ids,['copy']);assert.equal(v.contributions[0].quantity,12);assert.equal(v.contributions[1].quantity,12)
 assert.ok(v.stages.every(s=>s.kind!=='publication_gate'));assert.deepEqual(v.unmapped_services,[])
})
test('Branding written and visual work can be independently mapped and converge at exact review gates',()=>{
 const v=draftProjectDefaultTracks({scope,items:[item('guidelines','branding')],stageAssignments:[{service_id:'guidelines',stage_keys:['branding.release']}]})
 assert.deepEqual(v.tracks,['branding']);assert.deepEqual(v.stages.find(s=>s.key==='branding.reconcile').depends_on,['branding.written','branding.visual'])
 assert.equal(v.stages.find(s=>s.key==='branding.review').kind,'approval_gate');assert.equal(v.stages.find(s=>s.key==='branding.release').kind,'release_gate');assert.equal(v.authorizes_publication,false)
})
test('unknown, duplicate, foreign-track and foreign-service mappings fail closed',()=>{
 const base={scope,items:[item('copy','marketing')]}
 for(const mapping of [[{service_id:'copy',stage_keys:['unknown']}],[{service_id:'copy',stage_keys:['website.build']}],[{service_id:'foreign',stage_keys:['marketing.content']}],[{service_id:'copy',stage_keys:['marketing.content','marketing.content']}],[{service_id:'copy',stage_keys:[]}]])assert.throws(()=>draftProjectDefaultTracks({...base,stageAssignments:mapping}))
 assert.throws(()=>draftProjectDefaultTracks({...base,items:[item('copy','marketing'),item('copy','website')]}))
})
test('dependency cycles, duplicate stage identities and missing predecessors are rejected',()=>{
 assert.throws(()=>validateDefaultTrackDag([{key:'a',depends_on:['b']},{key:'b',depends_on:['a']}]),/cycle/)
 assert.throws(()=>validateDefaultTrackDag([{key:'a',depends_on:[]},{key:'a',depends_on:[]}]),/Unique/)
 assert.throws(()=>validateDefaultTrackDag([{key:'a',depends_on:['missing']}]),/unavailable/)
})
