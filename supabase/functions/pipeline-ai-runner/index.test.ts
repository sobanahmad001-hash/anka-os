import { buildPrompt, outputText, handleRequest } from './index.ts'

function assert(condition: unknown, message: string) {
  if (!condition) throw new Error(message)
}
function rejects(action: () => unknown, expected: RegExp) {
  try { action() } catch (error) {
    if (expected.test(String(error))) return
    throw error
  }
  throw new Error('Expected rejection')
}
const intent = {
  input_manifest: {
    engagement: { id: 'engagement-1', name: 'Allowed engagement', objective: 'Create a draft' },
    services: [{ id: 'scope-1', service_id: 'service-1', status: 'active' }],
    assets: [],
  },
}
const plan = { work_manifest: [
  { id: 'work-1', department_id: 'content', title: 'Allowed item' },
  { id: 'work-2', department_id: 'marketing', title: 'Unrelated item' },
] }
const step = {
  step_key: 'draft',
  definition_step: { kind: 'ai_assisted', department_id: 'content',
    service_id: 'service-1', label: 'Draft content' },
}
const job = { input_sha256: 'a'.repeat(64) }

Deno.test('N6 prompt includes only current step department and pinned service', () => {
  const prompt = buildPrompt(intent, plan, step, job)
  assert(prompt.includes('Allowed item'), 'Scoped work is missing')
  assert(!prompt.includes('Unrelated item'), 'Another department leaked into prompt')
  assert(prompt.includes('service-1'), 'Pinned service is missing')
  assert(prompt.includes(job.input_sha256), 'Job digest is missing')
})

Deno.test('N6 prompt refuses assets and unrelated service scope', () => {
  rejects(() => buildPrompt({
    input_manifest: { ...intent.input_manifest, assets: [{ id: 'asset-1' }] },
  }, plan, step, job), /scope is unavailable/)
  rejects(() => buildPrompt(intent, plan, {
    ...step, definition_step: { ...step.definition_step, service_id: 'another-service' },
  }, job), /service scope is unavailable/)
})

Deno.test('N6 output parser uses provider output text', () => {
  assert(outputText({ output: [{ content: [{ type: 'output_text', text: '  Draft  ' }] }] })
    === 'Draft', 'Provider output extraction failed')
  assert(outputText({ output: [{ content: [{ type: 'refusal', text: 'No' }] }] }) === '',
    'Refusal must not become draft text')
})

const ref = {artifact_version_id:'exact-v1',content_checksum:'c'.repeat(64),approval_id:'original-approval',ai_use_allowed:true,artifact_type:'content',output_type:'blog_article'}
const declaredStep = {...step, definition_step:{...step.definition_step,stage_contract:{required_inputs:[{key:'audience',label:'Audience',kind:'manual'},{key:'source',label:'Approved article',kind:'approved_artifact',artifact_type:'content',output_type:'blog_article'}]}}}
const reviewedIntent = {input_manifest:{...intent.input_manifest,stage_review:{id:'review-1',review_sha256:'d'.repeat(64),decisions:[{key:'draft',action:'run',quantity:1,inputs:[{key:'audience',value:'Startup owners'},{key:'source',artifact_version_id:'exact-v1'}]}],resolved_artifacts:[{step_key:'draft',input_key:'source',reference:ref},{step_key:'unrelated',input_key:'source',reference:{...ref,artifact_version_id:'other-version'}}]}}}
const reviewedInputs = {step_key:'draft',stage_review_id:'review-1',stage_review_sha256:'d'.repeat(64),manual_values:[{key:'audience',label:'Audience',value:'Startup owners'}],approved_sources:[{key:'source',label:'Approved article',reference:ref,content:{output_type:'blog_article',body:'Canonical approved article'}}]}
Deno.test('reviewed prompt uses only exact current-stage manual and approved canonical content',()=>{
 const prompt=buildPrompt(reviewedIntent,plan,declaredStep,job,reviewedInputs)
 assert(prompt.includes('Startup owners') && prompt.includes('Canonical approved article'),'Reviewed canonical inputs are missing')
 assert(prompt.includes('original-approval') && prompt.includes('exact-v1'),'Original approval/version provenance is missing')
 assert(!prompt.includes('other-version') && !prompt.includes('Unrelated item'),'Another step or department source leaked')
 assert(!buildPrompt(intent,plan,step,job).includes('stage_inputs'),'Legacy prompt changed')
})
Deno.test('declared prompt rejects missing, changed, foreign or forbidden reviewed inputs',()=>{
 rejects(()=>buildPrompt(reviewedIntent,plan,declaredStep,job),/reviewed generating/)
 for(const bad of [{...reviewedInputs,step_key:'other-step'},{...reviewedInputs,stage_review_sha256:'e'.repeat(64)},{...reviewedInputs,manual_values:[{key:'audience',value:'Unreviewed audience'}]},{...reviewedInputs,approved_sources:[{...reviewedInputs.approved_sources[0],reference:{...ref,artifact_version_id:'latest-v2'}}]},{...reviewedInputs,approved_sources:[{...reviewedInputs.approved_sources[0],reference:{...ref,ai_use_allowed:false}}]},{...reviewedInputs,approved_sources:[...reviewedInputs.approved_sources,{...reviewedInputs.approved_sources[0],key:'unrelated'}]}])rejects(()=>buildPrompt(reviewedIntent,plan,declaredStep,job,bad),/reviewed|approved AI-use|published step/)
 const satisfied={input_manifest:{...reviewedIntent.input_manifest,stage_review:{...reviewedIntent.input_manifest.stage_review,decisions:[{key:'draft',action:'reuse',artifact_version_id:'exact-v1'}]}}}
 rejects(()=>buildPrompt(satisfied,plan,declaredStep,job,reviewedInputs),/reviewed generating/)
})
Deno.test('oversized exact approved input fails the prompt bound without truncation',()=>{
 const large={...reviewedInputs,approved_sources:[{...reviewedInputs.approved_sources[0],content:{output_type:'blog_article',body:'x'.repeat(24000)}}]}
 rejects(()=>buildPrompt(reviewedIntent,plan,declaredStep,job,large),/exceeds its bound/)
})

Deno.test('actual handler resolves only the authenticated current step and stops before routes, reservation or provider when unconfigured',async()=>{
 const org='11111111-1111-4111-8111-111111111111',actor='22222222-2222-4222-8222-222222222222',jobId='33333333-3333-4333-8333-333333333333',stepId='44444444-4444-4444-8444-444444444444',id='55555555-5555-4555-8555-555555555555'
 const originalFetch=globalThis.fetch,originalGet=Deno.env.get,calls: string[]=[],rpcCalls: unknown[]=[];let providerCalls=0
 const configuration:Record<string,string>={SUPABASE_URL:'http://127.0.0.1:54321',SUPABASE_ANON_KEY:'offline-public-key',SUPABASE_SERVICE_ROLE_KEY:'offline-service-key',N6_PAID_EXECUTION_ENABLED:'true'}
 try{
  Deno.env.get=(key:string)=>configuration[key]
  globalThis.fetch=async(input:RequestInfo | URL,init?:RequestInit)=>{
   const url=new URL(input instanceof Request ? input.url : String(input));if(url.origin!=='http://127.0.0.1:54321')throw new Error('Remote requests forbidden in this fixture')
   calls.push(url.pathname)
   let data:unknown
   if(url.pathname==='/auth/v1/user')data={id:actor,email:'synthetic@example.invalid'}
   else if(url.pathname==='/rest/v1/organization_memberships')data={role:'operations_admin',member_kind:'team',status:'active'}
   else if(url.pathname==='/rest/v1/ai_execution_jobs')data={id:jobId,organization_id:org,run_intent_id:id,run_plan_id:id,requested_by:actor,input_sha256:job.input_sha256,status:'blocked_configuration'}
   else if(url.pathname==='/rest/v1/ai_execution_configured_steps')data={...declaredStep,id:stepId,job_id:jobId,organization_id:org}
   else if(url.pathname==='/rest/v1/pipeline_run_intents')data={...reviewedIntent,id,engagement_id:id,organization_id:org}
   else if(url.pathname==='/rest/v1/pipeline_run_plans')data={...plan,id,run_intent_id:id,organization_id:org}
   else if(url.pathname==='/rest/v1/engagements')data={id,organization_id:org,project_id:id,status:'active'}
   else if(url.pathname==='/rest/v1/rpc/get_pipeline_ai_step_input_context'){rpcCalls.push(JSON.parse(String(init?.body)));data={...reviewedInputs,readiness:{configuration_ready:false}}}
   else throw new Error('Unexpected data/reservation/dispatch path: '+url.pathname)
   return new Response(JSON.stringify(data),{status:200,headers:{'content-type':'application/json'}})
  }
  const response=await handleRequest(new Request('http://127.0.0.1:54321/functions/v1/pipeline-ai-runner',{method:'POST',headers:{Authorization:'Bearer offline-test-token','Content-Type':'application/json'},body:JSON.stringify({organization_id:org,job_id:jobId,configured_step_id:stepId,request_id:id,dispatch_request_id:id,max_cost_microusd:1000})}),()=>{providerCalls++;throw new Error('Provider forbidden')})
  const body=await response.json();assert(String(body.error).includes('configuration is not ready'),'Actual handler did not reach exact source readiness gate: '+String(body.error))
  assert(JSON.stringify(rpcCalls)===JSON.stringify([{p_organization_id:org,p_job_id:jobId,p_step_id:stepId,p_actor_id:actor}]),'Input resolver payload did not bind authenticated actor and exact job/step')
  assert(calls.filter(path=>path.startsWith('/rest/v1/rpc/')).length===1 && providerCalls===0,'Unconfigured inputs reached another RPC/provider')
 }finally{globalThis.fetch=originalFetch;Deno.env.get=originalGet}
})
