import { PIPELINE_TEMPLATE_DRAFT_ROLES } from './pipelineTemplatesRepository.js'

const EMPTY = Object.freeze({ slug: '', name: '', description: '', changeSummary: '', serviceIds: [], sourceVersionId: null })

export function seedPipelineDraft(catalog, templateId) {
  const template = (catalog.templates || []).find(row => row.id === templateId)
  if (!template) return { ...EMPTY, serviceIds: [] }
  const latest = (catalog.versions || [])
    .filter(row => row.pipeline_template_id === template.id)
    .sort((left, right) => right.version_number - left.version_number)[0]
  return {
    slug: template.slug,
    name: latest?.name || '',
    description: latest?.description || '',
    changeSummary: '',
    sourceVersionId: latest?.id || null,
    serviceIds: latest
      ? (catalog.selections || [])
        .filter(row => row.pipeline_template_version_id === latest.id)
        .sort((left, right) => left.position - right.position)
        .map(row => row.service_id)
      : [],
  }
}

export function canDraftPipelineTemplate(membership) {
  return Boolean(membership?.organizationId && membership?.organization?.status === 'active'
    && PIPELINE_TEMPLATE_DRAFT_ROLES.includes(membership?.role))
}
