export const normalizeUrl=value=>{try{const u=new URL(value);if(!['https:','http:'].includes(u.protocol)||u.username||u.password||u.search)return '';u.hash='';return u.href}catch{return ''}}
const key=t=>t.query.trim().toLowerCase()+'|'+t.locale.trim().toLowerCase()
export function sheetKeywords(sheet){
 if(!sheet||sheet.hidden||!sheet.rows.length)throw Error('Choose a visible worksheet with a header row.')
 const columns=sheet.rows[0].cells.map(c=>c.trim().toLowerCase())
 const fields=['url','keyword','role','intent','locale']
 if(fields.some(f=>columns.filter(c=>c===f).length!==1))throw Error('Use one column each for URL, keyword, role, intent and locale.')
 return sheet.rows.slice(1).map(({row,cells})=>{
  const [input,query,rawRole,intent,locale]=fields.map(f=>String(cells[columns.indexOf(f)]||'').trim())
  const url=normalizeUrl(input),role=rawRole.toLowerCase()
  const valid=!!url&&query.length>0&&query.length<=240&&intent.length>0&&intent.length<=250&&locale.length>0&&locale.length<=60&&['primary','supporting'].includes(role)&&!sheet.formulas?.some(c=>c.row===row)
  return {row,url,query,role,intent,locale,valid}
 })
}
export function importPreview(discovery,inventory,sources,keywords){
 const byId=new Map(inventory.map(p=>[p.id,p])), warnings=[]
 const candidates=discovery.pages.map(meta=>{
  const path=new URL(meta.url).pathname,source=sources.find(s=>s.origin===discovery.origin&&meta.wpId&&s.wp_id===meta.wpId)
  const matchSources=sources.filter(s=>s.origin===discovery.origin&&s.meta.url===meta.url)
  const matches=new Map()
  if(source&&byId.has(source.page_id))matches.set(source.page_id,byId.get(source.page_id))
  for(const s of matchSources)if(byId.has(s.page_id))matches.set(s.page_id,byId.get(s.page_id))
  for(const p of inventory)if(p.url===meta.url||p.path===path)matches.set(p.id,p)
  const page=[...matches.values()][0],old=sources.find(s=>s.page_id===page?.id)
  let reason=''
  if(matches.size>1||old&&old.origin!==discovery.origin||old?.wp_id&&meta.wpId&&old.wp_id!==meta.wpId)reason='Conflicting page identities.'
  if(page?.url&&!old&&page.url!==meta.url)reason='Path matches a different intended URL.'
  if(meta.status!==200)reason='HTTP '+meta.status+'; skipped.'
  if(page?.sourceId&&page.path!==path)reason='Registered path differs; review the architecture first.'
  const draftTitle=meta.title.slice(0,240)||path.slice(0,240)
  const title=page&&(!old?.manage_title||page.title!==old.meta.title.slice(0,240))?page.title:draftTitle
  const url=page&&(!old&&page.url||old&&(!old.manage_url||page.url!==old.meta.url))?page.url:meta.url
  const proposedPath=page&&old&&(!old.manage_path||page.path!==new URL(old.meta.url).pathname)?page.path:path
  const rows=keywords.filter(k=>k.url===meta.url)
  const existing=page?.mode==='undecided'?page.sourceTargets.map(t=>({query:t.source.term,intent:t.source.intent||'',locale:t.source.locale||'',role:t.role})):(page?.targets||[])
  const additions=[]
  for(const k of rows){
   const oldTarget=existing.find(t=>key(t)===key(k))
   let state='new'
   if(!k.valid||rows.filter(other=>key(other)===key(k)).length>1)state='ambiguous'
   else if(oldTarget)state=oldTarget.intent===k.intent&&oldTarget.role===k.role?'skipped':'ambiguous'
   else if(page?.mode==='none'||existing.some(t=>!t.intent||!t.locale))state='ambiguous'
   additions.push({...k,state,selected:state==='new'})
  }
  const metadataChanged=!old||['url','title','h1','description','canonical','status'].some(k=>meta[k]!==old.meta[k])||!!meta.wpId&&meta.wpId!==old.wp_id
  const state=reason?(meta.status===200?'ambiguous':'skipped'):!page?'new':metadataChanged||additions.some(k=>k.selected)?'changed':'skipped'
  return {id:page?.id||crypto.randomUUID(),revision:page?.revision||0,sourceId:page?.sourceId||null,wpId:meta.wpId||old?.wp_id||null,origin:discovery.origin,meta,path:proposedPath,url,title,reason,state,selected:['new','changed'].includes(state),additions,metadataChanged}
 })
 for(const c of candidates){
  if(candidates.some(o=>o!==c&&(o.id===c.id||o.path===c.path||o.wpId&&o.wpId===c.wpId))){c.state='ambiguous';c.selected=false;c.reason='Multiple discovered URLs match one identity.'}
 }
 for(const k of keywords)if(!candidates.some(c=>c.meta.url===k.url))warnings.push('Row '+k.row+': no exact discovered URL match for '+(k.url||'invalid URL'))
 return {candidates,warnings}
}
export function approvedRows(candidates){
 return candidates.filter(c=>c.selected&&['new','changed'].includes(c.state)).map(c=>({id:c.id,revision:c.revision,sourceId:c.sourceId,origin:c.origin,meta:c.meta,wpId:c.wpId,path:c.path,url:c.url,title:c.title,additions:c.additions.filter(t=>t.selected&&t.state==='new').map(({query,role,intent,locale})=>({query,role,intent,locale}))}))
}
