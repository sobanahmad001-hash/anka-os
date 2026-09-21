const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const KINDS = new Set(['human', 'ai_assisted', 'automatic', 'approval_gate'])

function id(value, label) {
  if (typeof value !== 'string' || !UUID.test(value)) throw new TypeError(`${label} must be a UUID`)
  return value
}

async function dataOrThrow(query, signal) {
  if (signal && typeof query.abortSignal === 'function') query = query.abortSignal(signal)
  const { data, error } = await query
  if (error) throw new Error(error.message || 'Execution definition request failed')
  return data
}

export function normalizeExecutionSteps(steps) {
  if (!Array.isArray(steps) || steps.length < 1 || steps.length > 50) {
    throw new TypeError('Choose 1–50 ordered steps')
  }
  const previous = new Set()
  return steps.map((step, index) => {
    const key = String(step.key || '').trim()
    const label = String(step.label || '').trim()
    const kind = step.kind
    const department = String(step.department_id || '').trim()
    const dependencies = step.depends_on || []
    if (!/^[a-z][a-z0-9_]{0,63}$/.test(key) || previous.has(key)
      || !label || label.length > 160 || !KINDS.has(kind) || !department
      || !Array.isArray(dependencies) || dependencies.length > 10
      || new Set(dependencies).size !== dependencies.length
      || dependencies.some(dependency => !previous.has(dependency))) {
      throw new TypeError(`Step ${index + 1} has an invalid key, label, kind, department or dependency`)
    }
    const service = id(step.service_id, `Step ${index + 1} service`)
    previous.add(key)
    return { key, label, kind, department_id: department, service_id: service, depends_on: dependencies }
  })
}

export function createPipelineExecutionDefinitionsRepository(supabase) {
  if (!supabase?.from || !supabase?.rpc) throw new TypeError('A Supabase-compatible client is required')
  return Object.freeze({
    async list(organizationId, { signal } = {}) {
      const organization = id(organizationId, 'Organization')
      const [definitions, approvals, publications] = await Promise.all([
        dataOrThrow(supabase.from('pipeline_execution_definitions').select('*')
          .eq('organization_id', organization).order('created_at', { ascending: false }), signal),
        dataOrThrow(supabase.from('pipeline_execution_definition_approvals').select('*')
          .eq('organization_id', organization), signal),
        dataOrThrow(supabase.from('pipeline_execution_publications').select('*')
          .eq('organization_id', organization), signal),
      ])
      return { definitions, approvals, publications }
    },
    create({ organizationId, presetPublicationId, requestId, name, steps }, { signal } = {}) {
      const trimmedName = String(name || '').trim()
      if (!trimmedName || trimmedName.length > 160) throw new TypeError('Definition name must be 1–160 characters')
      return dataOrThrow(supabase.rpc('create_pipeline_execution_definition', {
        p_organization_id: id(organizationId, 'Organization'),
        p_preset_publication_id: id(presetPublicationId, 'Published preset'),
        p_request_id: id(requestId, 'Request'),
        p_name: trimmedName,
        p_steps: normalizeExecutionSteps(steps),
      }), signal)
    },
    approve({ definitionId, departmentId }, { signal } = {}) {
      if (!departmentId) throw new TypeError('Department is required')
      return dataOrThrow(supabase.rpc('approve_pipeline_execution_definition', {
        p_definition_id: id(definitionId, 'Definition'), p_department_id: departmentId,
      }), signal)
    },
    publish(definitionId, { signal } = {}) {
      return dataOrThrow(supabase.rpc('publish_pipeline_execution_definition', {
        p_definition_id: id(definitionId, 'Definition'),
      }), signal)
    },
  })
}