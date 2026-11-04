import { assertEquals, assertRejects } from 'jsr:@std/assert@1.0.14'
import { contextChatReservationCeiling } from './index.ts'
import { conservativePipelineCeiling, measuredPipelineTokenCost } from '../_shared/n6PipelineCost.ts'
const price={provider:'openai' as const,model_id:'gpt-6.1-sol',verified_at:new Date().toISOString(),source_url:'https://developers.openai.com/api/docs/models/gpt-6.1-sol',
 input_usd_per_million:2,cached_input_usd_per_million:.1,cache_write_usd_per_million:2.5,output_usd_per_million:10}
const scope={id:'conversation',context_kind:'project_team'}
function fixture(status='available',remaining=1000000){const calls:any[]=[];const admin:any={async rpc(name:string,args:any){calls.push({name,args});return{data:{status,cap_microusd:1000000,remaining_microusd:remaining,historical_costs_unresolved:true,expires_at:new Date(Date.now()+3600000).toISOString()}}}};return{admin,calls}}
Deno.test('Sol prospective short draft holds the same 0.08048 maximum used by readiness; measured fee is separate',async()=>{
 const{admin,calls}=fixture()
 assertEquals(conservativePipelineCeiling('help',price),20490)
 assertEquals(await contextChatReservationCeiling(admin,'org','owner',scope,'model','help',price),80480)
 assertEquals(calls[0].args.p_cost,80480)
 assertEquals(measuredPipelineTokenCost({input_tokens:100,output_tokens:20,input_tokens_details:{cached_tokens:20,cache_write_tokens:10}},price),367)
})
Deno.test('prospective full-turn hold threshold rejects just below and admits exact or above remaining',async()=>{
 for(const amount of[80479,80480,80481]){
  const{admin}=fixture(amount<80480?'exhausted':'available',amount)
  if(amount<80480)await assertRejects(()=>contextChatReservationCeiling(admin,'org','owner',scope,'model','help',price))
  else assertEquals(await contextChatReservationCeiling(admin,'org','owner',scope,'model','help',price),80480)
 }
})
Deno.test('ordinary project without old holds and non-project text retain exact existing ceiling',async()=>{
 const{admin,calls}=fixture('not_required')
 assertEquals(await contextChatReservationCeiling(admin,'org','owner',scope,'model','help',price),20490)
 calls.length=0
 for(const context_kind of['organization','department_private'])assertEquals(await contextChatReservationCeiling(admin,'org','owner',{id:'conversation',context_kind},'model','help',price),20490)
 assertEquals(calls.length,0)
})
Deno.test('inactive or changed prospective policy cannot fall back to a cheaper short draft',async()=>{
 for(const status of['inactive','source_changed','unrelated_current_hold','unmeasured_current_cost','invented']){
  const{admin}=fixture(status)
  await assertRejects(()=>contextChatReservationCeiling(admin,'org','owner',scope,'model','help',price))
 }
})
