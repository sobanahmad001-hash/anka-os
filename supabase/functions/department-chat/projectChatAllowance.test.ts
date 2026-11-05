import { assertEquals, assertRejects, assertThrows } from 'jsr:@std/assert@1.0.14'
import { projectChatAllowanceReadiness } from './index.ts'
import { conservativePipelineCeiling, measuredPipelineTokenCost } from '../_shared/n6PipelineCost.ts'

Deno.test('New Project Chat uses exact project authority without a saved conversation and retains all exposure checks', async () => {
 for(const status of ['inactive','exhausted','scope_changed','source_changed','available']){
  const {admin,calls,env}=setup('openai',{status});
  const result=await projectChatAllowanceReadiness(admin,'org','owner','','model',prior,'configured',env,'project');
  assertEquals(calls[0].name,'read_new_project_chat_allowance');
  assertEquals(calls[0].args,{p_org:'org',p_actor:'owner',p_project:'project',p_model:'model',p_cost:Math.ceil(28096*3+1024*8)});
  assertEquals(result.spend_readiness_status,status==='available'?'ready':'prior_cycle_reconciliation_required');
 }
});
Deno.test('Saved Project Chat always retains exact conversation authority even if a project hint is supplied',async()=>{
 const {admin,calls,env}=setup();
 await projectChatAllowanceReadiness(admin,'org','owner','conversation','model',prior,'configured',env,'different-project');
 assertEquals(calls[0].name,'read_project_chat_allowance');
 assertEquals(calls[0].args.p_conversation,'conversation');
 assertEquals('p_project' in calls[0].args,false);
});


const prior = { spend_guard_mode: 'provider_managed', spend_tracking_configured: true,
  spend_readiness_status: 'prior_cycle_reconciliation_required', reconciliation_sources: ['design_media'] }
const prices: Record<string, any> = {
  openai: { model_id: 'gpt-4.1', source_url: 'https://developers.openai.com/api/docs/pricing' },
  anthropic: { model_id: 'claude-fixture', source_url: 'https://platform.claude.com/docs/en/about-claude/pricing' },
  google_gemini: { model_id: 'gemini-fixture', source_url: 'https://ai.google.dev/gemini-api/docs/pricing' },
}
function setup(provider = 'openai', result: Record<string, unknown> = {}, expired = false, approved = false) {
  const calls: any[] = []
  const row = { provider, ...prices[provider], verified_at: new Date(Date.now() - (expired ? 31 * 86400000 : 1000)).toISOString(),
    input_usd_per_million: 2, cached_input_usd_per_million: .5, cache_write_usd_per_million: 3, output_usd_per_million: 8 }
  if (approved) row.model_id = 'gpt-6.1-sol'
  const env = (name: string) => JSON.stringify(approved
    ? name === 'N6_OPENAI_APPROVED_MODELS_PRICING_JSON' ? [row] : [{ ...row, model_id: 'gpt-4.1' }]
    : [row])
  const admin: any = {
    from(table: string) {
      const chain: any = { select() { return chain }, eq() { return chain }, async maybeSingle() {
        return { data: table === 'context_chat_organization_models'
          ? { id: 'model', model_id: row.model_id, connector_connection_id: 'connection' } : { provider } }
      } }
      return chain
    },
    async rpc(name: string, args: any) {
      calls.push({ name, args })
      return { data: { status: 'available', cap_microusd: 1000000, remaining_microusd: 1000000,
        expires_at: new Date(Date.now() + 3600000).toISOString(), historical_costs_unresolved: true,
        private_hold_id: 'must-be-discarded', ...result } }
    },
  }
  return { admin, calls, env }
}
for (const provider of Object.keys(prices)) Deno.test(`Project Chat separate allowance uses current ${provider} maximum input/cache/write/output ceiling`, async () => {
  const { admin, calls, env } = setup(provider)
  const result = await projectChatAllowanceReadiness(admin, 'org', 'owner', 'conversation', 'model', prior, 'configured', env)
  assertEquals(calls, [{ name: 'read_project_chat_allowance', args: {
    p_org: 'org', p_actor: 'owner', p_conversation: 'conversation', p_model: 'model',
    p_cost: Math.ceil(28096 * 3 + 1024 * 8),
  } }])
  assertEquals(result.spend_readiness_status, 'ready')
  assertEquals(typeof result.prospective_allowance, 'object')
  const allowance = result.prospective_allowance as Record<string, unknown>
  assertEquals(allowance.historical_costs_unresolved, true)
  assertEquals('private_hold_id' in allowance, false)
  assertEquals('paid_execution_enabled' in result, false)
})
Deno.test('Project Chat allowance cannot override unknown current costs, missing project scope, unavailable model or ordinary paths', async () => {
  for (const [guard, model, conversation] of [[prior, 'price_unavailable', 'conversation'], [prior, 'configured', ''],
    [{ ...prior, spend_readiness_status: 'unmeasured_cost_reconciliation_required' }, 'configured', 'conversation'],
    [{ ...prior, spend_readiness_status: 'ready' }, 'configured', 'conversation']] as any[]) {
    const { admin, calls, env } = setup()
    assertEquals(await projectChatAllowanceReadiness(admin, 'org', 'owner', conversation, 'model', guard, model, env), guard)
    assertEquals(calls.length, 0)
  }
})
Deno.test('Project Chat separate allowance preserves expired pricing failure without a policy lookup', async () => {
  const { admin, calls, env } = setup('openai', {}, true)
  await assertRejects(() => projectChatAllowanceReadiness(admin, 'org', 'owner', 'conversation', 'model', prior, 'configured', env))
  assertEquals(calls.length, 0)
})
Deno.test('Project Chat exhausted/revoked/foreign-source alternatives remain blocked', async () => {
  for (const status of ['exhausted', 'inactive', 'scope_unavailable', 'source_changed', 'unrelated_current_hold']) {
    const { admin, env } = setup('openai', { status })
    const result = await projectChatAllowanceReadiness(admin, 'org', 'owner', 'conversation', 'model', prior, 'configured', env)
    assertEquals(result.spend_readiness_status, prior.spend_readiness_status)
    assertEquals(result.prospective_allowance_status, status)
  }
})
Deno.test('Project Chat malformed allowance evidence never makes Send available', async () => {
  for (const invalid of [{ remaining_microusd: 1 }, { cap_microusd: 1000001 }, { remaining_microusd: 1000001 },
    { historical_costs_unresolved: false }, { expires_at: '2020-01-01' }, { status: 'invented' }]) {
    const { admin, env } = setup('openai', invalid)
    await assertRejects(() => projectChatAllowanceReadiness(admin, 'org', 'owner', 'conversation', 'model', prior, 'configured', env))
  }
})
Deno.test('Project Chat exposure rounds all text price components upward and rejects unknown usage', () => {
  const price = { model_id: 'fixture', verified_at: new Date().toISOString(), source_url: 'fixture',
    input_usd_per_million: .125, cached_input_usd_per_million: .01, cache_write_usd_per_million: .15, output_usd_per_million: .5 }
  assertEquals(conservativePipelineCeiling('a', price, 1), Math.ceil(4097 * .15 + .5))
  assertEquals(measuredPipelineTokenCost({ input_tokens: 10, output_tokens: 1,
    input_tokens_details: { cached_tokens: 3, cache_write_tokens: 2 } }, price), Math.ceil(5 * .125 + 3 * .01 + 2 * .15 + .5))
  assertThrows(() => measuredPipelineTokenCost({ input_tokens: NaN, output_tokens: 1 }, price))
  assertThrows(() => measuredPipelineTokenCost({ input_tokens: 10, output_tokens: 1,
    input_tokens_details: { cache_write_tokens: 2 } }, { ...price, cache_write_usd_per_million: null }))
})
Deno.test('Project Chat allowance requires the fresh approved-model supplement through the existing exact pricing validator', async () => {
  const { admin, calls, env } = setup('openai', {}, false, true)
  const result = await projectChatAllowanceReadiness(admin, 'org', 'owner', 'conversation', 'model', prior, 'configured', env)
  assertEquals(result.spend_readiness_status, 'ready')
  assertEquals(calls[0].args.p_cost, Math.ceil(28096 * 3 + 1024 * 8))
})
Deno.test('blocked policy readiness reports the public maximum hold, and a changed no-longer-required snapshot waits for fresh org readiness', async () => {
  for (const status of ['inactive','exhausted','not_required']) {
    const { admin, env } = setup('openai', { status })
    const result = await projectChatAllowanceReadiness(admin,'org','owner','conversation','model',prior,'configured',env)
    assertEquals(result.spend_readiness_status, prior.spend_readiness_status)
    assertEquals(result.prospective_maximum_hold_microusd, Math.ceil(28096*3+1024*8))
    assertEquals('prospective_allowance' in result,false)
  }
})
