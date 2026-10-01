const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const id = (value, label) => { if (!UUID.test(value || '')) throw new TypeError(label + ' must be a UUID'); return value }
async function result(query, signal) { if (signal && query.abortSignal) query = query.abortSignal(signal); const { data, error } = await query; if (error) throw Object.assign(new Error(error.message),{code:error.code,knownRollback:['22023','42501','40001','55000'].includes(error.code)}); return data }
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
// Exact selection: a missing/foreign group never falls back to Legacy or another group.
export function pipelineGroupView(records, pipelineGroupId = '') {
  const group = pipelineGroupId ? (records.groups || []).find(row => row.id === pipelineGroupId) : null
  if (pipelineGroupId && !group) throw new TypeError('Selected pipeline group is unavailable; refresh its exact scope')
  const same = row => (row.pipeline_group_id || '') === pipelineGroupId
  return { group,
    available: group ? (records.publishedDefinitions || []).filter(row => row.definition.preset_publication_id === group.preset_publication_id) : records.available,
    configurations: records.configurations.filter(same).sort((a,b) => (b.group_revision || b.revision) - (a.group_revision || a.revision)),
    activations: records.activations.filter(same).sort((a,b) => (b.group_activation_number || b.activation_number) - (a.group_activation_number || a.activation_number)),
  }
}
export function createProjectPipelineConfigurationsRepository(supabase) {
  if (!supabase?.from || !supabase?.rpc) throw new TypeError('A Supabase-compatible client is required')
  return Object.freeze({
    async list(organizationId, engagementId, { signal } = {}) {
      const org = id(organizationId, 'Organization'), engagement = id(engagementId, 'Engagement')
      const [origin, presets, definitions, publications, configurations, activations, groups, stageReviews] = await Promise.all([
        result(supabase.from('engagement_pipeline_origins').select('pipeline_template_version_id').eq('organization_id', org).eq('engagement_id', engagement).maybeSingle(), signal),
        result(supabase.from('pipeline_template_publications').select('id,pipeline_template_version_id').eq('organization_id', org), signal),
        result(supabase.from('pipeline_execution_definitions').select('id,name,version_number,preset_publication_id,steps').eq('organization_id', org), signal),
        result(supabase.from('pipeline_execution_publications').select('id,definition_id').eq('organization_id', org), signal),
        result(supabase.from('project_pipeline_configurations').select('*').eq('organization_id', org).eq('engagement_id', engagement).order('revision', { ascending: false }), signal),
        result(supabase.from('project_pipeline_activations').select('*').eq('organization_id', org).eq('engagement_id', engagement).order('activation_number', { ascending: false }), signal),
        result(supabase.from('project_pipeline_groups').select('*').eq('organization_id', org).eq('engagement_id', engagement).order('created_at', { ascending: true }), signal),
        result(supabase.from('project_pipeline_stage_reviews').select('id,configuration_id,decisions,resolved_artifacts,review_sha256').eq('organization_id',org).eq('engagement_id',engagement),signal),
      ])
      const valid = new Set(presets.filter(row => row.pipeline_template_version_id === origin?.pipeline_template_version_id).map(row => row.id))
      const byId = new Map(definitions.filter(row => valid.has(row.preset_publication_id)).map(row => [row.id, row]))
      const publishedPresets = new Set(presets.map(row => row.id))
      const publishedById = new Map(definitions.filter(row => publishedPresets.has(row.preset_publication_id)).map(row => [row.id,row]))
      return { available: publications.filter(row => byId.has(row.definition_id)).map(row => ({ ...row, definition: byId.get(row.definition_id) })),
        publishedDefinitions: publications.filter(row => publishedById.has(row.definition_id)).map(row => ({ ...row,definition:publishedById.get(row.definition_id) })), configurations:configurations.map(row=>({...row,stage_review:stageReviews.find(review=>review.configuration_id===row.id)||null})), activations, groups }

    },
    create({ organizationId, engagementId, definitionPublicationId, pipelineGroupId = null, requestId, selectedSteps, stageDecisions, maxAiCostMicrousd }, { signal } = {}) {
      if (!Array.isArray(selectedSteps) || !selectedSteps.length || selectedSteps.length > 50) throw new TypeError('Choose 1–50 steps')
      if (!Number.isSafeInteger(maxAiCostMicrousd) || maxAiCostMicrousd < 0) throw new TypeError('Invalid local AI limit')
      if(stageDecisions!==undefined){if(!Array.isArray(stageDecisions) || stageDecisions.length<1 || stageDecisions.length>50)throw new TypeError('Review every published stage');return result(supabase.rpc('create_reviewed_project_pipeline_configuration',{p_organization_id:id(organizationId,'Organization'),p_engagement_id:id(engagementId,'Engagement'),p_definition_publication_id:id(definitionPublicationId,'Published definition'),p_pipeline_group_id:pipelineGroupId ? id(pipelineGroupId,'Pipeline group') : null,p_request_id:id(requestId,'Request'),p_stage_decisions:stageDecisions,p_max_ai_cost_microusd:maxAiCostMicrousd}),signal)}
      return result(supabase.rpc(pipelineGroupId ? 'create_project_pipeline_group_configuration' : 'create_project_pipeline_configuration', { ...(pipelineGroupId ? {p_pipeline_group_id:id(pipelineGroupId,'Pipeline group')} : {}), p_organization_id: id(organizationId, 'Organization'), p_engagement_id: id(engagementId, 'Engagement'), p_definition_publication_id: id(definitionPublicationId, 'Published definition'), p_request_id: id(requestId, 'Request'), p_selected_steps: selectedSteps, p_max_ai_cost_microusd: maxAiCostMicrousd }), signal)
    },
    listStageArtifacts(organizationId,engagementId,{query='',offset=0,signal}={}) {if(typeof query!=='string' || query.length>120 || !Number.isSafeInteger(offset) || offset<0 || offset>10000)throw new TypeError('Bounded project artifact search required');return result(supabase.rpc('list_project_pipeline_stage_artifacts',{p_organization_id:id(organizationId,'Organization'),p_engagement_id:id(engagementId,'Engagement'),p_query:query,p_offset:offset,p_limit:25}),signal)},
    listGroups(organizationId,engagementId,{signal}={}) { return result(supabase.from('project_pipeline_groups').select('*').eq('organization_id',id(organizationId,'Organization')).eq('engagement_id',id(engagementId,'Engagement')).order('created_at',{ascending:true}),signal) },
    createGroup({ organizationId, engagementId, presetPublicationId, kind, name, requestId }, { signal } = {}) {
      const exactName = typeof name === 'string' ? name.trim() : ''
      if (!['website','marketing'].includes(kind) || !exactName || exactName.length > 80) throw new TypeError('Choose Website or Marketing and a group name of 1–80 characters')
      return result(supabase.rpc('create_project_pipeline_group', { p_organization_id:id(organizationId,'Organization'),p_engagement_id:id(engagementId,'Engagement'),p_preset_publication_id:id(presetPublicationId,'Published preset'),p_kind:kind,p_name:exactName,p_request_id:id(requestId,'Request') }),signal)
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
