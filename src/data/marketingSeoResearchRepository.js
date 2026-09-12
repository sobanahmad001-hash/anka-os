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
    async loadAvailability(brandId, engagementId) {
      const [pages, keywords, versions, contentServices] = await Promise.all([
        dataOrThrow(client.from('tracked_pages').select('id', { count: 'exact', head: true }).eq('organization_id', organizationId).eq('brand_id', brandId), options),
        dataOrThrow(client.from('tracked_keywords').select('id', { count: 'exact', head: true }).eq('organization_id', organizationId).eq('brand_id', brandId), options),
        dataOrThrow(client.from('artifact_versions').select('id, version_number, created_at, artifacts!inner(id, title, artifact_type, brand_id)')
          .eq('organization_id', organizationId).eq('artifacts.brand_id', brandId).eq('artifacts.artifact_type', 'keyword_strategy')
          .order('created_at', { ascending: false }), options),
        dataOrThrow(client.from('engagement_services').select('id, service_catalog!inner(department_id, is_active)')
          .eq('organization_id', organizationId).eq('engagement_id', engagementId).eq('status', 'active')
          .eq('service_catalog.department_id', 'content').eq('service_catalog.is_active', true), options),
      ])
      return {
        technicalSeoPages: pages.count,
        trackedKeywords: keywords.count,
        contentStrategies: versions.data.map(version => ({
          id: version.id, versionNumber: version.version_number, createdAt: version.created_at,
          artifactId: version.artifacts?.id, title: version.artifacts?.title || 'Keyword strategy',
        })),
        activeContentService: contentServices.data.length > 0,
      }
    },
    preview: input => invoke(client, organizationId, 'preview_seo_research', input, options),
    save: input => invoke(client, organizationId, 'save_seo_research', input, options),
  })
}
