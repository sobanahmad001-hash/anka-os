const decode=s=>String(s||'').replace(/&(amp|lt|gt|quot|apos|#39|nbsp);/gi,(_,v)=>({amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",'#39':"'",nbsp:' '})[v.toLowerCase()])
const plain=s=>decode(String(s||'').replace(/<[^<>]*>/g,' ')).replace(/\s+/g,' ').trim().slice(0,1000)
function attrs(tag){
 const out=Object.create(null)
 for(const m of tag.matchAll(/\s+([:\w-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g))out[m[1].toLowerCase()]=decode(m[2]??m[3]??m[4])
 return out
}
function pageUrl(raw,base,origin){
 try{
  const u=new URL(raw,base)
  if(u.origin!==origin||u.username||u.password||u.search||u.pathname.length>1200||/%2f|%5c|%00/i.test(u.pathname))return ''
  const path=decodeURIComponent(u.pathname)
  if(/(?:^|\/)(?:wp-admin|wp-login|wp-json|wp-cron|logout|log-out|cart|checkout|delete|remove|admin|api|\.well-known)(?:[./-]|$)/i.test(path)||/\.(?!html?$|php$)[a-z0-9]{1,8}$/i.test(path))return ''
  u.hash='';return u.href
 }catch{return ''}
}
export function htmlPage(html,url){
 const source=html.replace(/<!--[\s\S]*?(?:-->|$)|<(script|style)\b[^<>]{0,8192}>[\s\S]*?(?:<\/\1\s*>|$)/gi,'')
 const tags=[...source.matchAll(/<(meta|link|a)\b[^>]{0,8192}>/gi)].map(m=>({name:m[1].toLowerCase(),...attrs(m[0])}))
 const canonical=tags.find(t=>t.name==='link'&&t.rel?.toLowerCase().split(/\s+/).includes('canonical'))?.href
 let canonicalUrl='';try{if(canonical){const u=new URL(canonical,url);if(['http:','https:'].includes(u.protocol)&&!u.username&&!u.password)canonicalUrl=u.href.slice(0,2048)}}catch{}
 const desc=[...source.matchAll(/<meta\b[^>]{0,8192}>/gi)].map(m=>attrs(m[0])).find(t=>t.name?.toLowerCase()==='description')
 return {title:plain(source.match(/<title\b[^<>]{0,8192}>([\s\S]*?)(?:<\/title\s*>|$)/i)?.[1]),h1:plain(source.match(/<h1\b[^<>]{0,8192}>([\s\S]*?)(?:<\/h1\s*>|$)/i)?.[1]),
 description:plain(desc?.content),canonical:canonicalUrl,links:tags.filter(t=>t.name==='a'&&t.href).map(t=>t.href)}
}
export async function discover(origin,read,now=Date.now){
 const deadline=now()+40000,problems=new Set(),pages=[],queue=new Set([origin+'/']),visited=new Set(),wp=new Map(),maps=new Set([origin+'/sitemap.xml',origin+'/wp-sitemap.xml'])
 let count=0,total=0,blocked=[]
 const allowed=u=>!blocked.some(prefix=>u.pathname.startsWith(prefix))
 async function load(raw){
  let u=new URL(raw)
  for(let i=0;i<4;i++){
   if(u.origin!==origin||u.username||u.password||!allowed(u)||count>=48||total>=6_000_000||now()>=deadline)throw Error('Request limit or restricted location')
   count++
   const r=await read(u,Math.min(8000,deadline-now()));total+=r.text.length
   if([301,302,303,307,308].includes(r.status)){
    if(!r.location)throw Error('Missing redirect')
    const dest=new URL(r.location,u);if(!pageUrl(dest.href,u,origin)&&!maps.has(dest.href))throw Error('Restricted redirect')
    u=dest;continue
   }
   return {...r,url:u.href}
  }
  throw Error('Redirect limit')
 }
 function add(raw,base){const url=pageUrl(raw,base,origin);if(url&&queue.size<150)queue.add(url)}
 try{
  const r=await load(origin+'/robots.txt')
  if([401,403,429].includes(r.status)||r.status>=500)throw Error('Robots unavailable')
  if(r.status===200){
   let applies=false,hasRules=false
   for(const line of r.text.split(/\r?\n/)){
    const m=line.replace(/#.*/,'').match(/^\s*([\w-]+):\s*(.*?)\s*$/);if(!m)continue
    const k=m[1].toLowerCase(),v=m[2]
    if(k==='user-agent'){if(hasRules)applies=false;hasRules=false;applies=applies||v==='*'||v.toLowerCase()==='ankawebsiteinventory'}else if(k==='allow'||k==='disallow')hasRules=true
    if(k==='disallow'&&applies&&v)blocked.push(v.split(/[\*$]/)[0])
    if(k==='sitemap'){try{const u=new URL(v);if(u.origin===origin&&!u.search&&/\.xml$/i.test(u.pathname)&&maps.size<8)maps.add(u.href)}catch{}}
   }
  }
 }catch{throw Error('Public crawling rules could not be checked.')}
 for(let n=1;n<=2;n++){
  try{const r=await load(origin+'/wp-json/wp/v2/pages?per_page=50&page='+n+'&_fields=id,link')
   if(r.status!==200||!r.type.includes('json'))break
   const items=JSON.parse(r.text);if(!Array.isArray(items))break
   for(const item of items){const u=pageUrl(item.link,origin,origin);if(u&&Number.isSafeInteger(item.id)&&item.id>0){wp.set(u,item.id);add(u,origin)}}
   if(items.length<50)break
  }catch{problems.add('WordPress inventory unavailable or partial.');break}
 }
 for(const path of maps){
  if(now()>=deadline||count>=48)break
  try{const r=await load(path);if(r.status!==200)continue
   const index=/<sitemapindex[\s>]/i.test(r.text)
   for(const m of r.text.matchAll(/<loc\b[^<>]{0,8192}>([^<]{1,2048})<\/loc>/gi)){
    const v=decode(m[1].trim())
    if(index){try{const u=new URL(v);if(u.origin===origin&&!u.username&&!u.password&&!u.search&&/\.xml$/i.test(u.pathname)&&maps.size<8)maps.add(u.href)}catch{}}
    else add(v,r.url)
   }
  }catch{problems.add('Some sitemap locations could not be read.')}
 }
 for(const path of queue){
  if(pages.length>=35||now()>=deadline||count>=48||total>=6_000_000){problems.add('Discovery limit reached; this inventory is partial.');break}
  if(visited.has(path))continue
  try{const r=await load(path);if(visited.has(r.url))continue;visited.add(r.url)
   if(!r.type.toLowerCase().includes('html')){if(path===origin+'/')problems.add('Homepage did not return HTML.');continue}
   const {links,...meta}=htmlPage(r.text,r.url)
   if(r.status===200)for(const link of links)add(link,r.url)
   pages.push({...meta,url:r.url,status:r.status,wpId:wp.get(r.url)??wp.get(path)??null})
  }catch{problems.add('Some public pages could not be read.')}
 }
 return {origin,pages,notices:[...problems],requests:count}
}
