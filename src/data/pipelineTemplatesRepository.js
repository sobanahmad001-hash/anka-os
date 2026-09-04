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

function uuid(value, label) {
  const normalized = required(value, label)
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(normalized)) {
    throw new TypeError(`${label} must be a UUID`)
  }
  return normalized
}

function sha256(value, label) {
  const normalized = required(value, label).toLowerCase()
  if (!/^[0-9a-f]{64}$/.test(normalized)) {
    throw new TypeError(`${label} must be a SHA-256 hash`)
  }
  return normalized
}

export function pipelineCustomization(originalValues, finalValues) {
  const original = serviceIds(originalValues)
  const final = serviceIds(finalValues)
  const finalSet = new Set(final)
  const originalSet = new Set(original)
  const sameServiceSet = original.length === final.length
    && original.every(serviceId => finalSet.has(serviceId))
  return Object.freeze([
    ...original.flatMap((serviceId, position) => finalSet.has(serviceId)
      ? []
      : [Object.freeze({ action: 'removed', service_id: serviceId, original_position: position })]),
    ...final.flatMap((serviceId, position) => originalSet.has(serviceId)
      ? []
      : [Object.freeze({ action: 'added', service_id: serviceId, final_position: position })]),
    ...final.flatMap((serviceId, position) => {
      if (!sameServiceSet) return []
      const originalPosition = original.indexOf(serviceId)
      return originalPosition >= 0 && originalPosition !== position
        ? [Object.freeze({
          action: 'moved', service_id: serviceId,
          original_position: originalPosition, final_position: position,
        })]
        : []
    }),
  ])
}

export function normalizePipelinePreviewInput(input = {}) {
  const originalServiceIds = serviceIds(input.originalServiceIds)
  const finalServiceIds = serviceIds(input.serviceIds)
  return Object.freeze({
    pipelineTemplateVersionId: uuid(input.pipelineTemplateVersionId, 'Pipeline template version'),
    originalServiceIds,
    serviceIds: finalServiceIds,
    existingAssets: (input.existingAssets || [])
      .filter(asset => asset?.asset_kind && asset?.name)
      .map(asset => Object.freeze({
        asset_kind: required(asset.asset_kind, 'Asset kind'),
        name: required(asset.name, 'Asset name'),
        source_url: asset.source_url?.trim() || null,
        notes: asset.notes?.trim() || '',
      })),
    customizationProvenance: pipelineCustomization(originalServiceIds, finalServiceIds),
  })
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

    async preview(input, organizationId, { signal } = {}) {
      const organization = required(organizationId, 'Organization')
      const preview = normalizePipelinePreviewInput(input)
      return dataOrThrow(supabase.rpc('preview_pipeline_engagement', {
        p_organization_id: organization,
        p_pipeline_template_version_id: preview.pipelineTemplateVersionId,
        p_service_ids: preview.serviceIds,
        p_existing_assets: preview.existingAssets,
      }), signal)
    },

    async compose(input, organizationId, { signal } = {}) {
      const organization = required(organizationId, 'Organization')
      const preview = normalizePipelinePreviewInput(input)
      return dataOrThrow(supabase.rpc('compose_engagement_from_pipeline_template', {
        p_organization_id: organization,
        p_request_id: uuid(input.requestId, 'Request'),
        p_pipeline_template_version_id: preview.pipelineTemplateVersionId,
        p_preview_rule_sha256: sha256(input.previewRuleSha256, 'Preview rule hash'),
        p_client_id: uuid(input.clientId, 'Client'),
        p_brand_id: uuid(input.brandId, 'Brand'),
        p_name: required(input.name, 'Engagement name'),
        p_engagement_type: input.engagementType || 'project',
        p_service_ids: preview.serviceIds,
        p_lead_owner_id: input.leadOwnerId || null,
        p_service_owners: input.serviceOwners || {},
        p_start_date: input.startDate || null,
        p_target_date: input.targetDate || null,
        p_objective: input.objective?.trim() || '',
        p_existing_assets: preview.existingAssets,
      }), signal)
    },
  })
}
