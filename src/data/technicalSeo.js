export const TRACKED_PAGE_TYPES = Object.freeze(['homepage', 'service', 'location', 'event', 'blog', 'other'])
export const INDEX_STATUSES = Object.freeze(['indexed', 'discovered_not_indexed', 'requested', 'excluded'])

export function labelize(value) {
  return String(value || '').replaceAll('_', ' ').replace(/\b\w/g, letter => letter.toUpperCase())
}

export function healthSummary(rows) {
  const pages = rows || []
  return {
    total: pages.length,
    attention: pages.filter(page => page.needs_attention).length,
    notIndexed: pages.filter(page => page.index_status === 'discovered_not_indexed').length,
    unaudited: pages.filter(page => !page.latest_audit_id).length,
  }
}

export function filterHealth(rows, filters) {
  return (rows || []).filter(page => {
    if (filters.pageType && page.page_type !== filters.pageType) return false
    if (filters.indexStatus && page.index_status !== filters.indexStatus) return false
    if (filters.attention === 'yes' && !page.needs_attention) return false
    if (filters.attention === 'no' && page.needs_attention) return false
    return true
  })
}

export function pageDepth(page, pages) {
  const byId = new Map((pages || []).map(item => [item.tracked_page_id || item.id, item]))
  const seen = new Set()
  let depth = 0
  let parentId = page?.parent_page_id
  while (parentId && !seen.has(parentId) && depth < 8) {
    seen.add(parentId); depth += 1; parentId = byId.get(parentId)?.parent_page_id
  }
  return depth
}
