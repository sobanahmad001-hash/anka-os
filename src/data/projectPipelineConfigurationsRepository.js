const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const id = (value, label) => { if (!UUID.test(value || '')) throw new TypeError(label + ' must be a UUID'); return value }
async function result(query, signal) { if (signal && query.abortSignal) query = query.abortSignal(signal); const { data, error } = await query; if (error) throw new Error(error.message); return data }
export function parseMicrousd(value) {
  const amount = String(value).trim()
  if (!/^\d+(?:\.\d{1,6})?$/.test(amount)) throw new TypeError('Enter a USD limit with at most six decimal places')
  const [whole, fraction = ''] = amount.split('.')
  const micro = BigInt(whole) * 1000000n + BigInt(fraction.padEnd(6, '0'))
  if (micro > BigInt(Number.MAX_SAFE_INTEGER)) throw new TypeError('USD limit is too large')
  return Number(micro)
}
export function normalizeSelectedSteps(steps, quantities) {
  if (!Array.isArray(steps) || !quantities) throw new TypeError('A published execution definition is required')
  const selected = [], seen = new Set()
  let total = 0
  for (const step of steps) {
    const raw = quantities[step.key]
    if (raw === undefined || raw === '') continue
    const quantity = Number(raw)
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 50) throw new TypeError(step.key + ' quantity must be 1–50')
    if ((step.depends_on || []).some(key => !seen.has(key))) throw new TypeError(step.key + ' requires its earlier steps')
    seen.add(step.key); selected.push({ key: step.key, quantity }); total += quantity
  }
  if (!selected.length || total > 50) throw new TypeError('Choose steps with a total quantity of 1–50')
  return selected
}
export function createProjectPipelineConfigurationsRepository(supabase) {
  if (!supabase?.from || !supabase?.rpc) throw new TypeError('A Supabase-compatible client is required')
  return Object.freeze({
    async list(organizationId, engagementId, { signal } = {}) {
      const org = id(organizationId, 'Organization'), engagement = id(engagementId, 'Engagement')
      const [origin, presets, definitions, publications, configurations, activations] = await Promise.all([
        result(supabase.from('engagement_pipeline_origins').select('pipeline_template_version_id').eq('organization_id', org).eq('engagement_id', engagement).maybeSingle(), signal),
        result(supabase.from('pipeline_template_publications').select('id,pipeline_template_version_id').eq('organization_id', org), signal),
        result(supabase.from('pipeline_execution_definitions').select('id,name,version_number,preset_publication_id,steps').eq('organization_id', org), signal),
        result(supabase.from('pipeline_execution_publications').select('id,definition_id').eq('organization_id', org), signal),
        result(supabase.from('project_pipeline_configurations').select('*').eq('organization_id', org).eq('engagement_id', engagement).order('revision', { ascending: false }), signal),
        result(supabase.from('project_pipeline_activations').select('*').eq('organization_id', org).eq('engagement_id', engagement).order('activation_number', { ascending: false }), signal),
      ])
      const valid = new Set(presets.filter(row => row.pipeline_template_version_id === origin?.pipeline_template_version_id).map(row => row.id))
      const byId = new Map(definitions.filter(row => valid.has(row.preset_publication_id)).map(row => [row.id, row]))
      return { available: publications.filter(row => byId.has(row.definition_id)).map(row => ({ ...row, definition: byId.get(row.definition_id) })), configurations, activations }
    },
    create({ organizationId, engagementId, definitionPublicationId, requestId, selectedSteps, maxAiCostMicrousd }, { signal } = {}) {
      if (!Array.isArray(selectedSteps) || !selectedSteps.length || selectedSteps.length > 50) throw new TypeError('Choose 1–50 steps')
      if (!Number.isSafeInteger(maxAiCostMicrousd) || maxAiCostMicrousd < 0) throw new TypeError('Invalid local AI limit')
      return result(supabase.rpc('create_project_pipeline_configuration', { p_organization_id: id(organizationId, 'Organization'), p_engagement_id: id(engagementId, 'Engagement'), p_definition_publication_id: id(definitionPublicationId, 'Published definition'), p_request_id: id(requestId, 'Request'), p_selected_steps: selectedSteps, p_max_ai_cost_microusd: maxAiCostMicrousd }), signal)
    },
    preview(organizationId, configurationId, { signal } = {}) {
      return result(supabase.rpc('preview_project_pipeline_activation', { p_organization_id: id(organizationId, 'Organization'), p_configuration_id: id(configurationId, 'Configuration') }), signal)
    },
    activate({ organizationId, configurationId, requestId, impactToken, acknowledged }, { signal } = {}) {
      if (!acknowledged || !/^[0-9a-f]{64}$/.test(impactToken || '')) throw new TypeError('Review and acknowledge exact impact')
      return result(supabase.rpc('activate_project_pipeline_configuration', { p_organization_id: id(organizationId, 'Organization'), p_configuration_id: id(configurationId, 'Configuration'), p_request_id: id(requestId, 'Request'), p_impact_token_sha256: impactToken, p_impact_acknowledged: true }), signal)
    },
  })
}
