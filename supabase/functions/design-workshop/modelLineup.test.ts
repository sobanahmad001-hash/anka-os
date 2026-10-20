import {LINEUP_CONTRACTS,buildLineupInput,mediaKind} from '../_shared/designModelLineup.js'
import {createDesignMediaAdapter} from '../_shared/designMediaAdapter.ts'
import {generateMedia} from './mediaExecution.ts'
import {fetchDesignVideoOutput} from '../_shared/designVideoOutput.ts'
const equal=(a:unknown,b:unknown)=>{if(JSON.stringify(a)!==JSON.stringify(b))throw Error('Unexpected exact result')};
const denied=async(action:()=>unknown)=>{let rejected=false;try{await action()}catch{rejected=true}if(!rejected)throw Error('Unsafe request accepted')};
for(const [model,spec] of Object.entries(LINEUP_CONTRACTS)){
 Deno.test('exact adapter route and unchanged settings: '+model,async()=>{
  const calls:any[]=[];const client=createDesignMediaAdapter(()=>({subscribe:async(endpoint,options)=>{calls.push({endpoint,options});return {request_id:'one',status:'queued',status_url:'https://api.higgsfield.ai/requests/one/status'}}}),'synthetic:synthetic');
  const source=spec.input?'https://storage.example/original':undefined;
  await client.submitLineup(model,'Synthetic confirmed brief',spec.defaults,1,source);
  equal(calls,[{endpoint:model,options:{input:buildLineupInput(model,'Synthetic confirmed brief',spec.defaults,1,source),withPolling:false}}]);
  await denied(()=>client.submitLineup(model,'Synthetic confirmed brief',{...spec.defaults,webhook_url:'https://bad.example'},1,source));equal(calls.length,1);
 });
 Deno.test('claim replay and denial never resubmit '+model,async()=>{
  Deno.env.set('DESIGN_VIDEO_PAID_EXECUTION_ENABLED','true');
  const prompt='Synthetic confirmed brief',checksum=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(prompt))),x=>x.toString(16).padStart(2,'0')).join('');
  const source={kind:'media_output',id:'saved:0',checksum:'c'.repeat(64),provider_consent:{provider:'higgsfield',source_id:'saved:0',checksum:'c'.repeat(64),allow_transfer:true}};
  const request={organization_id:'org',context:{kind:'private',id:'chat'},creative_brief_version_id:'version',connector_connection_id:'connection',provider:'higgsfield',model_id:model,settings:{...spec.defaults},output_count:1,input_versions:spec.input?[source]:[],prompt_checksum:checksum};
  let submitted=0,claimed=false,deny=false;
  const job={id:'job',operation_key:'99999999-9999-4999-8999-999999999903',claim_id:'claim',status:'claimed',request};
  const admin:any={organizationId:'org',rpc:async(name:string)=>{
   if(name==='prepare_design_media_request')return {data:{creative_brief_id:'brief',request,prompt},error:null};
   if(name==='claim_design_media_generation'){if(deny)return {error:{code:'42501'},data:null};const repeat=claimed;claimed=true;return {data:{...job,must_not_submit:repeat},error:null}}
   if(name==='record_design_media_generation')return {data:{...job,status:'provider_pending'},error:null};throw Error('Unexpected RPC');
  }};
  const deps={credential:async()=> 'synthetic:synthetic',inputUrl:async()=> 'https://storage.example/original',adapter:{submitLineup:async(m:string,p:string,s:any,c:number,url?:string)=>{equal([m,p,s,c,url],[model,prompt,spec.defaults,1,spec.input?'https://storage.example/original':undefined]);submitted++;return {state:'pending',requestId:'one',statusUrl:'https://api.higgsfield.ai/requests/one/status'}}}};
  const body={creative_brief_id:'brief',selection:request,operation_key:job.operation_key,quote_id:'99999999-9999-4999-8999-999999999904',acceptance:{generate:true}};
  await Promise.all([generateMedia(admin,body,'actor',deps),generateMedia(admin,body,'actor',deps)]);equal(submitted,1);
  deny=true;await denied(()=>generateMedia(admin,body,'actor',deps));equal(submitted,1);
 });
}
Deno.test('unrecognized model cannot fall back to a different paid adapter',async()=>{
 let calls=0;const adapter=createDesignMediaAdapter(()=>({subscribe:async()=>{calls++;throw Error('No call allowed')}}),'synthetic:synthetic');
 await denied(()=>adapter.submitLineup('unapproved/model','Synthetic',{},1));equal(calls,0);equal(mediaKind('unapproved/model'),null);
});
Deno.test('original video MIME is retained without conversion and unsupported content blocked',async()=>{
 const bytes=new Uint8Array([0,0,0,24,102,116,121,112,105,115,111,109]);
 for(const mime of ['video/mp4','video/quicktime']){const result=await fetchDesignVideoOutput('https://cdn.example/result',['cdn.example'],'original',async()=>new Response(bytes,{headers:{'content-type':mime}}));equal(result.contentType,mime);equal(Array.from(result.bytes),Array.from(bytes))}
 await denied(()=>fetchDesignVideoOutput('https://cdn.example/result',['cdn.example'],'original',async()=>new Response(bytes,{headers:{'content-type':'text/html'}})));
 await denied(()=>fetchDesignVideoOutput('https://cdn.example/result',['cdn.example'],'mp4',async()=>new Response(bytes,{headers:{'content-type':'video/quicktime'}})));
});
