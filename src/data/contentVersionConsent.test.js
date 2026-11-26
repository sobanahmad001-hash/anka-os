import test from 'node:test'
import assert from 'node:assert/strict'
import {consentSuccessor} from './contentVersionConsent.js'
const artifact={id:'a',engagement_id:'e',artifact_type:'content',title:'Published positioning'}
const version={id:'v',artifact_id:'a',content_checksum:'checksum',data_classification:'internal',ai_use_allowed:false,content:{schema_version:2,output_type:'custom_text',body:'Exact public wording.',source_citations:['https://ankasphere.com/']}}
test('consent successor preserves exact wording and provenance without changing original approval or metadata',()=>{
 const before=structuredClone(version),input=consentSuccessor(artifact,version,'v',true)
 assert.deepEqual(input.content,version.content);assert.notEqual(input.content,version.content)
 assert.equal(input.expected_parent_version_id,'v');assert.equal(input.ai_use_allowed,true)
 assert.equal(input.data_classification,'internal');assert.match(input.change_summary,/v \(checksum\)/)
 assert.deepEqual(version,before);assert.equal('approval_id' in input,false)
})
test('consent rejects stale, foreign, restricted, implicit or already consented sources',()=>{
 for(const [a,v,latest,allow] of [[artifact,version,'other',true],[artifact,{...version,artifact_id:'foreign'},'v',true],[artifact,{...version,data_classification:'restricted'},'v',true],[artifact,version,'v',false],[artifact,{...version,ai_use_allowed:true},'v',true]])assert.throws(()=>consentSuccessor(a,v,latest,allow))
})
