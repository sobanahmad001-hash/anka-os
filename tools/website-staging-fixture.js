import {id,organizationId,projectId,engagementId} from './website-block-fixture.js'
export function createStagingFixture(connected=true){
 const row={organization_id:organizationId,project_id:projectId,engagement_id:engagementId},origin='https://staging.example.test',targets=[],runs=[],issues=[],counts={inspect:0,bind:0,dryRun:0,deploy:0,recover:0,issue:0},flags={lost:true}
 const jobs=[{id:id(50),page_id:id(5),page_key:'home',title:'Home reviewed package',stale_sources:[],requested_at:'2026-10-28 01:00'},{id:id(51),page_id:id(5),page_key:'home',title:'Home revised package',stale_sources:[],requested_at:'2026-10-28 01:10'}]
 const repository={
  workspace:async()=>({...row,targets:structuredClone(targets),jobs:structuredClone(jobs),runs:structuredClone(runs),issues:structuredClone(issues),connections:connected?[{id:id(52),display_name:'Isolated staging',base_url:origin}]:[],has_more:false}),
  inspect:async()=>{counts.inspect++;return {connection_id:id(52),base_url:origin,site_id:id(53),environment:'staging',published:false,connection_revision:'synthetic',inspection_sha256:'a'.repeat(64)}},
  bind:async(_s,_inspection,requestId)=>{counts.bind++;const rowTarget={...row,id:id(54),connection_id:id(52),display_name:'Isolated staging',base_url:origin,site_id:id(53),request_id:requestId,version_number:1,current:true};targets.unshift(rowTarget);return structuredClone(rowTarget)},
  dryRun:async(_s,targetId,jobId)=>{counts.dryRun++;const job=jobs.find(j=>j.id===jobId);if(job.stale_sources.length)throw Error('Source changed; review a current native build');return {...row,target_id:targetId,job_id:jobId,page_id:job.page_id,page_key:job.page_key,title:job.title,site_id:id(53),base_url:origin,remote_head:runs[0]?.request_id||null,review_sha256:'b'.repeat(64),package_sha256:'c'.repeat(64),environment:'staging',published:false}},
  deploy:async(_s,review,previous,requestId)=>{counts.deploy++;const run={...row,id:id(60+runs.length),target_id:review.target_id,job_id:review.job_id,page_id:id(5),page_key:'home',title:review.title,previous_run_id:previous||null,request_id:requestId,status:'staged',created_at:'2026-10-28 01:'+counts.deploy+'0',evidence:{base_url:origin,environment:'staging',published:false,preview_url:origin+'/?anka_staging_preview='+requestId,unresolved_paths:[]}};runs.unshift(run);if(flags.lost){flags.lost=false;throw Error('Synthetic staging response lost; recover original request')}return structuredClone(run)},
  recover:async(_s,requestId)=>{counts.recover++;return structuredClone(runs.find(r=>r.request_id===requestId))},
  issue:async(_s,input)=>{counts.issue++;const event={id:id(80+issues.length),issue_id:input.issueId||id(80+issues.length),run_id:input.runId,previous_event_id:input.expectedEventId||null,kind:input.kind,note:input.note,request_id:input.requestId,created_at:'2026-10-28 01:15'};issues.unshift(event);return structuredClone(event)}
 }
 return {repository,targets,jobs,runs,issues,counts,flags}
}
