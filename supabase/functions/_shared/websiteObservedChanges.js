import {htmlPage} from '../website-discovery/discover.js'
const decode=value=>value.replace(/&(nbsp|amp|lt|gt|quot|#39);/gi,(_,key)=>({nbsp:' ',amp:'&',lt:'<',gt:'>',quot:'"','#39':"'"})[key.toLowerCase()])
const plain=value=>decode(value.replace(/<[^>]*>/g,' ')).replace(/\s+/g,' ').trim()
function attributes(tag){const values={};for(const m of tag.matchAll(/\s+([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g))values[m[1].toLowerCase()]=decode(m[2]??m[3]??m[4]);return values}
/** @param {{html:string,url:string,status:number,redirects?:object[],robotsHeader?:string|null}} input */
export function observedPageSnapshot({html,url,status,redirects=[],robotsHeader=null}){
 if(status!==200)return {state:status===404||status===410?'missing':'http_error',status,url,redirects}
 const clean=html.replace(/<!--[\s\S]*?(?:-->|$)|<(script|style|noscript|svg)\b[^>]*>[\s\S]*?(?:<\/\1\s*>|$)/gi,'')
 const body=clean.match(/<main\b[^>]*>([\s\S]*?)<\/main\s*>/i)?.[1]||clean.match(/<article\b[^>]*>([\s\S]*?)<\/article\s*>/i)?.[1]||clean.match(/<body\b[^>]*>([\s\S]*?)<\/body\s*>/i)?.[1]||clean
 const content=body.replace(/<(nav|header|footer|aside|time)\b[^>]*>[\s\S]*?<\/\1\s*>/gi,'')
 const meta=htmlPage(clean,url),robots=[...clean.matchAll(/<meta\b[^>]*>/gi)].map(m=>attributes(m[0])).filter(a=>['robots','googlebot'].includes(a.name?.toLowerCase())).map(a=>({agent:a.name.toLowerCase(),value:(a.content||'').toLowerCase().split(/[,\s]+/).filter(Boolean).sort().join(',')}))
 const headings=[...content.matchAll(/<(h[1-6])\b[^>]*>([\s\S]*?)<\/\1\s*>/gi)].map(m=>({level:m[1].toLowerCase(),text:plain(m[2])})).slice(0,200)
 const text=plain(content)
 const snapshot={state:'observed',status,url,redirects,title:meta.title,description:meta.description,h1:meta.h1,canonical:meta.canonical,headings,robots,robotsHeader,
  content:text.slice(0,60000),contentTruncated:text.length>60000}
 // Keep the entire UTF-8 JSON snapshot under the native commit envelope, including
 // unusually large headings/directives and multibyte text. Never imply full coverage.
 while(new TextEncoder().encode(JSON.stringify(snapshot)).length>140000){
  snapshot.contentTruncated=true
  if(snapshot.content.length>1000)snapshot.content=snapshot.content.slice(0,Math.floor(snapshot.content.length/2))
  else if(snapshot.headings.length)snapshot.headings.pop()
  else if(snapshot.robots.length)snapshot.robots.pop()
  else snapshot.robotsHeader=snapshot.robotsHeader?.slice(0,1000)||null
 }
 return snapshot
}
export function pageSnapshotDiff(previous,current){
 if(!previous)return {changed:false,baseline:true,fields:[]}
 if(current.state!=='observed')return {changed:JSON.stringify(previous)!==JSON.stringify(current),baseline:false,fields:['availability'],retainPreviousContent:true}
 const keys=['state','status','url','finalUrl','redirects','title','description','h1','canonical','headings','robots','robotsHeader','content','contentTruncated']
 const fields=keys.filter(key=>JSON.stringify(previous[key])!==JSON.stringify(current[key]))
 return {changed:fields.length>0,baseline:false,fields,recheckRequired:fields.length>0}
}
