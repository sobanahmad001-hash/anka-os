import './project-content-journey-preview.jsx'
import {actor,organizationId} from './direct-chat-fixture.js'
const p=globalThis.__directChatPreview,w=p.projectWorkspace,j=globalThis.__journey
const brief='Reviewed synthetic homepage brief\nAudience: local service teams.\nSix sections: introduction, services, process, benefits, proof and contact.'
const draft='  Synthetic exact homepage copy\n\nIntroduction\nHelp your team move forward.\n\nServices\nClear practical support.\n\nProcess\nReview together.\n\nBenefits\nClarity for your next step.\n\nProof\nOnly approved evidence.\n\nContact\nStart a conversation.\n  '
const run=p.fixture.runner.run;let turns=0
p.fixture.runner.run=async input=>{const result=await run(input);turns++;Object.assign(result.message,{id:turns===1?'qa-brief':'qa-draft',body:turns===1?brief:draft});return result}
w.engagementWorkItems=w.engagementWorkItems.filter(row=>row.department_id!=='content')
const original=structuredClone(w.workshopArtifacts),saved=[]
j.studio.saveArtifact=async input=>{saved.push(structuredClone(input));const a={id:crypto.randomUUID(),organization_id:organizationId,engagement_id:w.engagement.id,project_id:w.project.id,artifact_type:'content',title:input.title,created_by:actor,versions:[]};const v={id:crypto.randomUUID(),artifact_id:a.id,organization_id:organizationId,version_number:1,content:input.content,data_classification:'internal',content_checksum:'d'.repeat(64)};a.versions.push(v);w.workshopArtifacts.push(a);return {artifact_id:a.id,version:structuredClone(v)}}
globalThis.__sourceQA={brief,draft,original,saved}
