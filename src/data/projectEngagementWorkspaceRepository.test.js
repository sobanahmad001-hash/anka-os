import assert from 'node:assert/strict'
import test from 'node:test'
import {readFileSync} from 'node:fs'
import {transform} from 'esbuild'
const org='org-a',project='project-a',engagement='engagement-a'
async function fixture({groups=[],error=null,hasEngagement=true}={}){
 const calls=[];const client={from(table){const call={table,steps:[]};calls.push(call);const q=new Proxy({}, {get:(_,key)=>key==='then'?resolve=>resolve({data:table==='projects'?{id:project,organization_id:org}:table==='engagements'?(hasEngagement?{id:engagement,organization_id:org,project_id:project}:null):table==='project_pipeline_groups'?groups:[],error:table==='project_pipeline_groups'?error:null}):(...args)=>{call.steps.push([key,...args]);return q}});return q}}
 const source=readFileSync(new URL('./projectEngagementWorkspaceRepository.js',import.meta.url),'utf8').replace("import { supabase } from '../lib/supabase'",'const supabase=globalThis.__workspaceReadTransport')
 globalThis.__workspaceReadTransport=client;const compiled=await transform(source,{format:'esm'});const module=await import('data:text/javascript;base64,'+Buffer.from(compiled.code+'\n//'+Math.random()).toString('base64'));delete globalThis.__workspaceReadTransport
 return {calls,read:()=>module.fetchProjectEngagementSnapshot(project,org,{signal:new AbortController().signal})}
}
test('pipeline metadata query is bounded and pinned to organization, Project and engagement',async()=>{
 const f=await fixture({groups:[{id:'website',organization_id:org,project_id:project,engagement_id:engagement,kind:'website'}]});const value=await f.read();assert.equal(value.pipelineGroupsState,'available');assert.equal(value.pipelineGroups.length,1)
 const q=f.calls.find(c=>c.table==='project_pipeline_groups');assert.deepEqual(q.steps.filter(s=>s[0]==='eq'),[['eq','organization_id',org],['eq','project_id',project],['eq','engagement_id',engagement]]);assert.deepEqual(q.steps.find(s=>s[0]==='limit'),['limit',101]);assert.equal(q.steps.find(s=>s[0]==='select')[1],'id, organization_id, project_id, engagement_id, kind, name, created_at');assert(f.calls.every(c=>c.steps.every(s=>!['insert','update','delete','upsert'].includes(s[0]))))
})
test('missing pipeline read access preserves canonical workspace with an explicit unavailable state',async()=>{const f=await fixture({error:{message:'denied',status:403}});const value=await f.read();assert.equal(value.project.id,project);assert.equal(value.pipelineGroupsState,'unavailable');assert.deepEqual(value.pipelineGroups,[])})
test('foreign organization metadata rejects the workspace rather than leaking a pipeline name',async()=>{const f=await fixture({groups:[{id:'foreign',organization_id:'org-b'}]});await assert.rejects(f.read(),{status:403,membershipMismatch:true})})
test('engagementless projects make no group query; oversized metadata requires explicit limited state',async()=>{const none=await fixture({hasEngagement:false});assert.equal((await none.read()).pipelineGroupsState,'not_applicable');assert(!none.calls.some(c=>c.table==='project_pipeline_groups'));const big=await fixture({groups:Array.from({length:101},(_,n)=>({id:String(n),organization_id:org}))});assert.equal((await big.read()).pipelineGroupsState,'limited')})
