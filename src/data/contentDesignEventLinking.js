export function relatedRecord(value) {
  return Array.isArray(value) ? value[0] || null : value || null
}

export function blogLinksForMonth(links, month) {
  return (links || []).filter(link => relatedRecord(link.external_events)?.start_date?.startsWith(`${month}-`))
}

export function contentCalendarPath(brandId, linkId) {
  const params = new URLSearchParams({ brand: brandId, eventLink: linkId, tab: 'calendar' })
  return `/sphere/content/studio?${params}`
}

export function workshopSessionPath(session) {
  if (!session?.id || !session?.engagement_id) return null
  const params = new URLSearchParams({ engagement: session.engagement_id, session: session.id })
  return `/sphere/design/workshop?${params}`
}
