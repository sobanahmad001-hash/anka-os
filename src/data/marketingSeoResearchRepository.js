import { supabase } from '../lib/supabase.js'

async function dataOrThrow(query, { signal } = {}) {
  if (signal && typeof query.abortSignal === 'function') query = query.abortSignal(signal)
  const { data, error, count } = await query
  if (error) throw Object.assign(new Error(error.message || 'SEO Research query failed'), { status: error.status || error.statusCode })
  return { data: data || [], count: count ?? data?.length ?? 0 }
}

async function invoke(client, organizationId, action, input, { signal } = {}) {
  const { data, error } = await client.functions.invoke('marketing-studio', {
    body: { action, organization_id: organizationId, ...input }, signal,
  })
  if (error) throw Object.assign(new Error(error.message || 'SEO Research request failed'), { status: error.status || error.context?.status })
  if (data?.error) throw new Error(data.error)
  return data?.data
}

export function createMarketingSeoResearchRepository(organizationId, { signal, client = supabase } = {}) {
  if (!organizationId) throw new TypeError('Active organization is required')
  const options = { signal }
  return Object.freeze({
    async loadAvailability(brandId, engagementId, projectId) {
      const [pages, keywords, versions, contentServices, contentWorkstreams] = await Promise.all([
        dataOrThrow(client.from('tracked_pages').select('id', { count: 'exact', head: true }).eq('organization_id', organizationId).eq('brand_id', brandId), options),
        dataOrThrow(client.from('tracked_keywords').select('id', { count: 'exact', head: true }).eq('organization_id', organizationId).eq('brand_id', brandId), options),
        dataOrThrow(client.from('artifact_versions').select('id, version_number, created_at, artifacts!inner(id, title, artifact_type, brand_id)')
          .eq('organization_id', organizationId).eq('artifacts.brand_id', brandId).eq('artifacts.artifact_type', 'keyword_strategy')
          .order('created_at', { ascending: false }), options),
        dataOrThrow(client.from('engagement_services').select('id, service_catalog!inner(name, department_id, is_active)')
          .eq('organization_id', organizationId).eq('engagement_id', engagementId).eq('status', 'active')
          .eq('service_catalog.department_id', 'content').eq('service_catalog.is_active', true), options),
        projectId ? dataOrThrow(client.from('workstreams').select('id, name, department_id, status')
          .eq('organization_id', organizationId).eq('project_id', projectId)
          .eq('department_id', 'content').eq('status', 'active'), options) : Promise.resolve({ data: [] }),
      ])
      return {
        technicalSeoPages: pages.count,
        trackedKeywords: keywords.count,
        contentStrategies: versions.data.map(version => ({
          id: version.id, versionNumber: version.version_number, createdAt: version.created_at,
          artifactId: version.artifacts?.id, title: version.artifacts?.title || 'Keyword strategy',
        })),
        activeContentService: contentServices.data.length > 0,
        contentServices: contentServices.data.map(item => ({ id: item.id, name: item.service_catalog?.name || 'Content service' })),
        contentWorkstreams: contentWorkstreams.data.map(item => ({ id: item.id, name: item.name })),
      }
    },
    preview: input => invoke(client, organizationId, 'preview_seo_research', input, options),
    save: input => invoke(client, organizationId, 'save_seo_research', input, options),
    async getConfirmedContentRequest(requestId) {
      const { data, error } = await client.from('marketing_seo_content_requests')
        .select('request_id, organization_id, project_id, engagement_id, research_version_id, research_checksum, receiving_service_id, receiving_workstream_id, title, requested_output, confirmed_at')
        .eq('organization_id', organizationId).eq('request_id', requestId).maybeSingle()
      if (error) throw new Error(error.message || 'Content request status could not be loaded')
      return data
    },
    async confirmContentRequest(input) {
      const { data, error } = await client.rpc('confirm_marketing_seo_content_request', {
        p_organization_id: organizationId, p_project_id: input.projectId,
        p_engagement_id: input.engagementId, p_request_id: input.requestId,
        p_research_version_id: input.researchVersionId, p_research_checksum: input.researchChecksum,
        p_receiving_service_id: input.receivingServiceId,
        p_receiving_workstream_id: input.receivingWorkstreamId,
        p_title: input.title, p_requested_output: input.requestedOutput,
      })
      if (error) throw Object.assign(new Error(error.message || 'Content request confirmation failed'), { status: error.code === '42501' ? 403 : undefined })
      if (data?.request_id !== input.requestId || data?.research_version_id !== input.researchVersionId) throw new Error('Confirmed Content request identity changed')
      return data
    },
  })
}
