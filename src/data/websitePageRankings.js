const day = 86400000
function dayNumber(value) {
  const ms = Date.parse(value + 'T00:00:00Z')
  if (!Number.isFinite(ms) || new Date(ms).toISOString().slice(0,10) !== value) throw Error('Choose valid reporting dates.')
  return ms / day
}
const dateAt = n => new Date(n * day).toISOString().slice(0,10)
export function comparisonPeriod(start, end) {
  const first = dayNumber(start), last = dayNumber(end)
  if (first > last || last - first >= 93) throw Error('Choose a reporting period of 1–93 days.')
  return {start, end, previousStart: dateAt(first - (last-first+1)), previousEnd: dateAt(first-1)}
}
function summarize(rows) {
  if (!rows.length) return null
  let clicks=0, impressions=0, weighted=0
  for (const row of rows) {
    clicks += row.clicks
    impressions += row.impressions
    weighted += row.position * row.impressions
  }
  return {clicks, impressions, position:impressions ? weighted/impressions : null, ctr:impressions ? clicks/impressions : null}
}
export function pageRankingReport({rows,url,targets,period,country='',device=''}) {
  const filtered = rows.filter(row => (!country || row.country===country) && (!device || row.device===device)
    && row.date>=period.previousStart && row.date<=period.end)
  const assigned = new Set(targets.map(t=>t.query))
  function pair(page,query) {
    const exact=filtered.filter(row=>row.page===page && row.query===query)
    const current=summarize(exact.filter(row=>row.date>=period.start))
    const previous=summarize(exact.filter(row=>row.date<=period.previousEnd))
    const movement=current?.position!=null && previous?.position!=null ? previous.position-current.position : null
    return {page,query,current,previous,movement}
  }
  const queries = [...new Set(filtered.filter(row=>row.page===url).map(row=>row.query))]
  return {targets:targets.map(t=>({...t,...pair(url,t.query)})),
    discovered:queries.filter(q=>!assigned.has(q)).map(q=>pair(url,q)),
    otherUrls:targets.flatMap(t=>[...new Set(filtered.filter(row=>row.query===t.query && row.page!==url).map(row=>row.page))].map(page=>pair(page,t.query)))}
}
