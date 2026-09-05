export const PIPELINE_TEMPLATE_DRAFT_ROLES = Object.freeze([
  'system_owner',
  'operations_admin',
  'department_manager',
])

export const PIPELINE_TEMPLATE_PUBLISH_ROLES = Object.freeze([
  'system_owner',
  'operations_admin',
])

function required(value, label) {
  if (!value || typeof value !== 'string' || !value.trim()) {
    throw new TypeError(`${label} is required`)
  }
  return value.trim()
}

function serviceIds(values) {
  if (!Array.isArray(values) || values.length === 0) {
    throw new TypeError('At least one service is required')
  }
  const normalized = values.map(value => required(value, 'Service'))
  if (new Set(normalized).size !== normalized.length) {
    throw new TypeError('Pipeline template services must be unique')
  }
  return normalized
}

export function normalizePipelineTemplateVersion(input = {}) {
  const slug = required(input.slug, 'Template slug').toLowerCase()
  if (!/^[a-z0-9]+(?:_[a-z0-9]+)*$/.test(slug)) {
    throw new TypeError('Template slug must be snake_case')
  }
  const name = required(input.name, 'Template name')
  if (name.length > 160) throw new TypeError('Template name must be at most 160 characters')
  const description = String(input.description || '').trim()
  const changeSummary = String(input.changeSummary || '').trim()
  if (description.length > 4000) throw new TypeError('Template description must be at most 4000 characters')
  if (changeSummary.length > 1000) throw new TypeError('Change summary must be at most 1000 characters')
  return Object.freeze({
    pipelineTemplateId: input.pipelineTemplateId || null,
    slug,
    name,
    description,
    serviceIds: serviceIds(input.serviceIds),
    sourceVersionId: input.sourceVersionId || null,
    changeSummary,
  })
}

async function dataOrThrow(query, signal) {
  if (signal && typeof query.abortSignal === 'function') query = query.abortSignal(signal)
  const response = await query
  const { data, error } = response
  if (error) {
    throw Object.assign(new Error(error.message || 'Pipeline template query failed'), {
      status: response.status ?? error.status,
      code: error.code,
    })
  }
  return data
}

export function createPipelineTemplatesRepository(supabase) {
  if (!supabase?.from || !supabase?.rpc) {
    throw new TypeError('A Supabase-compatible client is required')
  }

  return Object.freeze({
    async list(organizationId, { signal } = {}) {
      const organization = required(organizationId, 'Organization')
      const [templates, versions, selections, publications] = await Promise.all([
        dataOrThrow(supabase.from('pipeline_templates').select('*')
          .eq('organization_id', organization).order('slug'), signal),
        dataOrThrow(supabase.from('pipeline_template_versions').select('*')
          .eq('organization_id', organization)
          .order('version_number', { ascending: false }), signal),
        dataOrThrow(supabase.from('pipeline_template_version_services')
          .select('organization_id, pipeline_template_id, pipeline_template_version_id, service_id, position, service_catalog(id, slug, name, department_id, is_active, display_order)')
          .eq('organization_id', organization).order('position'), signal),
        dataOrThrow(supabase.from('pipeline_template_publications').select('*')
          .eq('organization_id', organization)
          .order('publication_number', { ascending: false }), signal),
      ])
      return { templates, versions, selections, publications }
    },

    async createVersion(input, organizationId, { signal } = {}) {
      const organization = required(organizationId, 'Organization')
      const version = normalizePipelineTemplateVersion(input)
      return dataOrThrow(supabase.rpc('create_pipeline_template_version', {
        p_organization_id: organization,
        p_pipeline_template_id: version.pipelineTemplateId,
        p_slug: version.slug,
        p_name: version.name,
        p_description: version.description,
        p_service_ids: version.serviceIds,
        p_source_version_id: version.sourceVersionId,
        p_change_summary: version.changeSummary,
      }), signal)
    },

    async publishVersion(versionId, { signal } = {}) {
      return dataOrThrow(supabase.rpc('publish_pipeline_template_version', {
        p_pipeline_template_version_id: required(versionId, 'Pipeline template version'),
      }), signal)
    },
  })
}
