const stop=new Set(['the','and','for','with','from','that','this','your','our','are','was','how','what','where','can','you','near','best','com','www'])
const words=text=>new Set(String(text||'').toLowerCase().match(/[\p{L}\p{N}]+/gu)?.filter(w=>w.length>2&&!stop.has(w))||[])
const normalized=text=>String(text||'').normalize('NFKC').toLowerCase().match(/[\p{L}\p{N}]+/gu)?.join(' ')||''

export function assessQuery(row,page,source={},projectName=''){
 const home=page.path==='/'
 const title=home&&['home','homepage','home page'].includes(normalized(page.title))?'':page.title
 const context=words([title,home?'':page.path,page.brief,source?.title,source?.h1,source?.description].join(' '))
 const query=words(row.query)
 const matched=[...query].filter(w=>context.has(w)),coverage=query.size?matched.length/query.size:0
 const brandCandidate=home&&words(projectName).size>=2&&normalized(row.query)===normalized(projectName)
 const strong=coverage>=0.6&&matched.length>0
 const flags=[]
 if(context.size===0)flags.push('Missing page context — add or verify the page title, brief or imported metadata to assess service, location and intent.')
 else if(!strong&&!brandCandidate)flags.push('Weak relevance — confirm the service, location and intent against the page.')
 if(row.impressions<20)flags.push('Insufficient evidence — fewer than 20 impressions in this window.')
 if(row.overlap_count>0)flags.push(brandCandidate
  ?'Brand candidate appears on '+row.overlap_count+' other URLs. Review whether each destination serves the query intent.'
  :'Overlapping URLs — this query also appears on '+row.overlap_count+' other URLs.')
 const opportunity=row.position>=4&&row.position<=20
 const explanation=brandCandidate
  ?'Full query matches the project name “'+projectName+'”. Review this Home page navigational brand candidate.'
  :matched.length?'Page wording matches '+matched.join(', ')+'.'
  :context.size?'No meaningful query words match the saved page context.':'Saved page context is insufficient for a relevance assessment.'
 return {role:strong&&row.impressions>=20?'primary':'supporting',matched,flags,opportunity,brandCandidate,explanation,
  intent:brandCandidate?'Navigational — confirm the official brand destination'
   :/\b(price|cost|book|booking|hire|quote|buy)\b/i.test(row.query)?'Commercial / transactional'
   :/\b(how|what|why|guide)\b/i.test(row.query)?'Informational':'Review intent'}
}
