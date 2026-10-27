import {websiteNativeFixture} from './website-native-fixture.js'
export const id=n=>'c0000000-0000-4000-8000-'+String(n).padStart(12,'0')
export const organizationId=id(1),projectId=id(2),engagementId=id(3),actor=id(4)
export async function createBlockFixture(){
 const manifest=await websiteNativeFixture('home');Object.assign(manifest.scope,{organization_id:organizationId,project_id:projectId,engagement_id:engagementId,page_id:id(5),page_key:'home'})
 const rows=[{design_id:id(6),page_id:id(5),page_key:'home',version_number:2,title:'Home Website design',created_at:'2026-10-28T00:00:00Z'},{design_id:id(7),page_id:id(5),page_key:'home',version_number:1,title:'Earlier Website design',created_at:'2026-10-27T00:00:00Z'}],jobs=[],counts={build:0,review:0,recover:0,download:0,provider:0,activation:0},flags={lost:true,stale:false}
 const row={organization_id:organizationId,project_id:projectId,engagement_id:engagementId}
 const canonical={design:{id:id(6),status:'draft',version:2},work:{id:id(8),status:'completed'},output:{id:id(9),version:1,decision:'approved'},group:{id:id(10)}}
 const repository={
 workspace:async(_scope,o={})=>{if(o.requestId)counts.recover++;return {...row,designs:structuredClone(rows),jobs:structuredClone(jobs.filter(j=>!o.requestId||j.request_id===o.requestId)),design_total:2,job_total:jobs.length}},
 review:async(_scope,designId)=>{counts.review++;return {...row,design_id:designId,page_id:id(5),design_version:rows.find(r=>r.design_id===designId).version_number,stale_sources:flags.stale?['Content']:[],manifest:structuredClone(manifest),review_sha256:'a'.repeat(64)}},
 build:async(_scope,input)=>{counts.build++;const job={...row,id:id(100+jobs.length),page_id:id(5),website_page_design_id:input.designId,request_id:input.requestId,status:'complete',requested_at:'2026-10-28T00:00:00Z',artifact_sha256:'b'.repeat(64),stale_sources:[]};jobs.unshift(job);if(flags.lost){flags.lost=false;throw Error('Synthetic response lost; recover original request')}return structuredClone(job)},
 download:async(_scope,job,kind)=>{counts.download++;return {...job,checksum_verified:true,download_url:'https://fhoxaogfjszftoqtnbav.supabase.co/storage/v1/object/sign/wordpress-theme-exports/'+organizationId+'/'+job.website_page_design_id+'/'+job.id+'/'+(kind==='source'?'source.zip':'native-block.zip')+'?token=synthetic',download_expires_in:300}}
 }
 return {repository,rows,jobs,counts,flags,canonical}
}
