const stop=new Set(['the','and','for','with','from','that','this','your','our','are','was','how','what','where','can','you','near','best','com','www'])
const words=text=>new Set(String(text||'').toLowerCase().match(/[\p{L}\p{N}]+/gu)?.filter(w=>w.length>2&&!stop.has(w))||[])
export function assessQuery(row,page,source={}){
 const query=words(row.query),context=words([page.title,page.path,page.brief,source?.title,source?.h1,source?.description].join(' '))
 const matched=[...query].filter(w=>context.has(w)),coverage=query.size?matched.length/query.size:0
 const strong=coverage>=0.6&&matched.length>0
 const flags=[]
 if(!strong)flags.push('Weak relevance — confirm the service, location and intent against the page.')
 if(row.impressions<20)flags.push('Insufficient evidence — fewer than 20 impressions in this window.')
 if(row.overlap_count>0)flags.push('Overlapping URLs — this query also appears on '+row.overlap_count+' other URLs.')
 const opportunity=row.position>=4&&row.position<=20
 return {role:strong&&row.impressions>=20?'primary':'supporting',matched,flags,opportunity,
  explanation:matched.length?'Page wording matches '+matched.join(', ')+'.':'No meaningful query words match the saved page context.',
  intent:/\b(price|cost|book|booking|hire|quote|buy)\b/i.test(row.query)?'Commercial / transactional':/\b(how|what|why|guide)\b/i.test(row.query)?'Informational':'Review intent'}
}
