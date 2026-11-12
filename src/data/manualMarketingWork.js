const slugs = new Set(['social_planning', 'setup_marketing_social_calendar', 'setup_marketing_social_scheduling_and_publishing'])
export const organicServices = workspace => (workspace.services || []).filter(service =>
  ['planned','active'].includes(service.status) && slugs.has(service.service_catalog?.slug))

const serviceSlugs = new Set(['seo_operations','setup_marketing_on_page_seo_audit','setup_marketing_page_seo_optimization',
  'setup_marketing_internal_linking','setup_marketing_technical_seo_audit','setup_marketing_seo_issue_prioritization',
  'setup_marketing_seo_implementation_verification','setup_marketing_local_page_optimization'])
export const seoServices = workspace => (workspace.services || []).filter(s =>
  ['planned','active'].includes(s.status) && serviceSlugs.has(s.service_catalog?.slug))


// PostgREST limits a single response. Read the whole month before counting deliveries.
export async function readMarketingWorkPages(buildQuery) {
  const pageSize = 250
  const rows = []
  let cursor = null
  for (;;) {
    let query = buildQuery().order('id').limit(pageSize)
    if (cursor) query = query.gt('id', cursor)
    const { data, error } = await query
    if (error) throw error
    rows.push(...data)
    if (data.length < pageSize) return rows
    cursor = data[data.length - 1].id
  }
}
