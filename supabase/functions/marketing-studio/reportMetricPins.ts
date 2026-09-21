type Row = Record<string, unknown>
type QueryResult = { data: Row[] | null; error: { message?: string } | null }
type Admin = { from: (table: string) => { select: (columns: string) => {
  eq: (column: string, value: string) => { in: (column: string, values: string[]) => Promise<QueryResult> }
} } }
type MetricRef = { source: 'google_ads' | 'keyword_tracking' | 'meta'; snapshot_id: string }
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const SOURCES = {
  google_ads: { table: 'ad_campaign_performance_snapshots', parentTable: 'ad_campaigns', parentKey: 'ad_campaign_id',
    columns: 'id,organization_id,ad_campaign_id,snapshot_date,impressions,clicks,cost,conversions,provider_connection_id,external_campaign_id,created_at',
    parentColumns: 'id,organization_id,brand_id,campaign_name,external_account_id,provider_connection_id',
    collectedAt: 'created_at', metrics: ['impressions','clicks','cost','conversions'] },
  keyword_tracking: { table: 'keyword_rank_snapshots', parentTable: 'tracked_keywords', parentKey: 'tracked_keyword_id',
    columns: 'id,organization_id,tracked_keyword_id,snapshot_date,position,search_console_clicks,search_console_impressions,fetched_at',
    parentColumns: 'id,organization_id,brand_id,keyword',
    collectedAt: 'fetched_at', metrics: ['position','search_console_clicks','search_console_impressions'] },
  meta: { table: 'meta_performance_snapshots', parentTable: 'meta_connections', parentKey: 'meta_connection_id',
    columns: 'id,organization_id,meta_connection_id,snapshot_date,platform,reach,impressions,engagement,created_at',
    parentColumns: 'id,organization_id,brand_id,facebook_page_id,instagram_account_id,integration_connection_id',
    collectedAt: 'created_at', metrics: ['reach','impressions','engagement'] },
} as const

async function rows(admin: Admin, table: string, columns: string, organizationId: string, ids: string[]): Promise<Row[]> {
  const { data, error } = await admin.from(table).select(columns).eq('organization_id', organizationId).in('id', ids)
  if (error) throw new Error(error.message || 'Stored metric evidence could not be read')
  return data || []
}

export function validateMarketingReportMetricRefs(value: unknown): MetricRef[] {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value) || value.length > 30) throw new Error('Select at most 30 exact metric snapshots')
  const seen = new Set<string>()
  return value.map(raw => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Exact metric snapshot reference required')
    const item = raw as Record<string, unknown>
    const source = item.source
    const id = item.snapshot_id
    if (typeof source !== 'string' || !Object.hasOwn(SOURCES, source) || typeof id !== 'string' || !UUID.test(id)) {
      throw new Error('Metric source and exact snapshot ID are required')
    }
    const key = source + ':' + id.toLowerCase()
    if (seen.has(key)) throw new Error('Duplicate metric snapshot reference')
    seen.add(key)
    return { source: source as MetricRef['source'], snapshot_id: id.toLowerCase() }
  }).sort((a, b) => a.source.localeCompare(b.source) || a.snapshot_id.localeCompare(b.snapshot_id))
}

export async function pinMarketingReportMetrics(
  admin: Admin, organizationId: string, brandId: string,
  period: { start: string; end: string }, refs: MetricRef[], pinnedAt: string,
): Promise<Row[]> {
  const pins: Row[] = []
  for (const source of Object.keys(SOURCES) as MetricRef['source'][]) {
    const selected = refs.filter(ref => ref.source === source)
    if (!selected.length) continue
    const contract = SOURCES[source]
    const snapshots = await rows(admin, contract.table, contract.columns, organizationId, selected.map(ref => ref.snapshot_id))
    if (snapshots.length !== selected.length) throw new Error('Selected metric snapshot is unavailable')
    const parentIds = [...new Set(snapshots.map(row => String(row[contract.parentKey])))]
    const parents = await rows(admin, contract.parentTable, contract.parentColumns, organizationId, parentIds)
    const byParent = new Map(parents.map(parent => [String(parent.id), parent]))
    for (const ref of selected) {
      const row = snapshots.find(item => item.id === ref.snapshot_id)
      const parent = byParent.get(String(row?.[contract.parentKey]))
      if (!row || !parent || parent.brand_id !== brandId || row.organization_id !== organizationId ||
        typeof row.snapshot_date !== 'string' || row.snapshot_date < period.start || row.snapshot_date > period.end ||
        typeof row[contract.collectedAt] !== 'string') {
        throw new Error('Selected metric snapshot does not match this brand and report period')
      }
      const metrics = Object.fromEntries(contract.metrics.map(key => [key, row[key] ?? null]))
      pins.push({
        source, source_record_id: row.id, source_parent_id: parent.id, snapshot_date: row.snapshot_date,
        source_filter: { brand_id: brandId, parent_id: parent.id, period_start: period.start, period_end: period.end,
          ...(source === 'meta' ? { platform: row.platform } : {}) },
        retrieved_at: row[contract.collectedAt], pinned_at: pinnedAt,
        account_id: source === 'google_ads' ? parent.external_account_id
          : source === 'meta' ? parent.instagram_account_id || parent.facebook_page_id || null : null,
        connection_id: source === 'google_ads' ? row.provider_connection_id
          : source === 'meta' ? parent.integration_connection_id : null,
        label: source === 'google_ads' ? parent.campaign_name
          : source === 'keyword_tracking' ? parent.keyword : row.platform,
        metrics,
        definitions: source === 'google_ads'
          ? { metric_units: { impressions: 'count', clicks: 'count', cost: 'currency amount', conversions: 'count' },
            reporting_timezone: null, currency: null, provider_finality: null }
          : source === 'meta'
            ? { metric_units: { reach: 'count', impressions: 'count', engagement: 'count' },
              reporting_timezone: null, provider_finality: null }
            : { metric_units: { position: 'rank', search_console_clicks: 'count', search_console_impressions: 'count' },
              search_engine: null, device: null, reporting_timezone: null },
      })
    }
  }
  return pins.sort((a, b) => String(a.source).localeCompare(String(b.source)) ||
    String(a.source_record_id).localeCompare(String(b.source_record_id)))
}
