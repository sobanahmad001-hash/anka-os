import {htmlPage,pageUrl} from './discover.js'

const wpPath='/wp-json/wp/v2/pages'
function mapUrl(value,base,origin){
 try{const u=new URL(value,base);return u.origin===origin&&!u.username&&!u.password&&!u.search&&u.pathname.endsWith('.xml')&&!/(?:^|\/)(?:admin|wp-admin|api)(?:\/|$)/i.test(u.pathname)?u.href:''}catch{return ''}
}
function permitted(task,origin){
 const u=new URL(task.url)
 if(u.origin!==origin||u.username||u.password||u.hash)return false
 if(task.kind==='robots')return u.pathname==='/robots.txt'&&!u.search
 if(task.kind==='map')return !!mapUrl(u.href,origin,origin)
 if(task.kind==='wp')return u.pathname===wpPath&&/^\?per_page=50&page=[1-9][0-9]{0,2}&_fields=id,link$/.test(u.search)
 return task.kind==='page'&&!!pageUrl(u.href,origin,origin)
}
export async function scanChunk({origin,tasks,blocked},read,now=Date.now){
 const deadline=now()+32000,results=[]
 let bytes=0,requests=0
 for(const task of tasks.slice(0,20)){
  if(now()>=deadline||bytes>=4000000||requests>=24)break
  let url=new URL(task.url),r
  const out={id:task.id,added:[],state:'read'}
  try{
   if(!permitted(task,origin))throw Error('Unsupported URL')
   for(let n=0;n<4;n++){
    if(blocked.some(prefix=>decodeURIComponent(url.pathname).startsWith(prefix))){out.state='excluded';break}
    if(now()>=deadline||requests>=24)throw Error('Chunk deadline')
    requests++;r=await read(url,Math.min(8000,deadline-now()));bytes+=new TextEncoder().encode(r.text).length
    if(![301,302,303,307,308].includes(r.status))break
    const dest=new URL(r.location,url)
    if(!r.location||!permitted({...task,url:dest.href},origin)||n===3)throw Error('Restricted redirect')
    url=dest
   }
   if(out.state==='excluded'){results.push(out);continue}
   if(r.status>=500||r.status===429||r.status===401||r.status===403)throw Error('Unavailable response')
   const added=new Map()
   function add(kind,value,wpId=null){
    if(!value)return
    if(added.size>=2000){out.limited=true;return}
    added.set(kind+' '+value,{kind,url:value,wpId})
   }
   if(task.kind==='robots'){
    if(r.status!==404&&r.status!==410&&r.status!==200)throw Error('Crawling rules unavailable')
    out.blocked=[]
    let applies=false,rules=false
    for(const line of (r.status===200?r.text:'').split(/\r?\n/)){
     const m=line.replace(/#.*/,'').match(/^\s*([\w-]+):\s*(.*?)\s*$/);if(!m)continue
     const k=m[1].toLowerCase(),v=m[2]
     if(k==='user-agent'){if(rules)applies=false;rules=false;applies=applies||v==='*'||v.toLowerCase()==='ankawebsiteinventory'}
     if(k==='allow'||k==='disallow')rules=true
     if(k==='disallow'&&applies&&v)out.blocked.push(v.split(/[*$]/)[0])
     if(k==='sitemap')add('map',mapUrl(v,origin,origin))
    }
    add('wp',origin+wpPath+'?per_page=50&page=1&_fields=id,link')
    add('map',origin+'/sitemap.xml');add('map',origin+'/wp-sitemap.xml');add('page',origin+'/')
   }else if(task.kind==='wp'&&r.status===200&&r.type.includes('json')){
    const rows=JSON.parse(r.text);if(!Array.isArray(rows))throw Error('Invalid WordPress inventory')
    for(const row of rows)if(Number.isSafeInteger(row.id)&&row.id>0)add('page',pageUrl(row.link,origin,origin),row.id)
    if(rows.length===50){const next=Number(url.searchParams.get('page'))+1;if(next<=100)add('wp',origin+wpPath+'?per_page=50&page='+next+'&_fields=id,link');else out.limited=true}
   }else if(task.kind==='map'&&r.status===200){
    const index=/<(?:\w+:)?sitemapindex[\s>]/i.test(r.text)
    if(!index&&!/<(?:\w+:)?urlset[\s>]/i.test(r.text))out.state='unsupported'
    for(const m of r.text.matchAll(/<(?:\w+:)?loc\b[^<>]*>\s*(?:<!\[CDATA\[)?([^<]{1,2048}?)(?:\]\]>)?\s*<\/(?:\w+:)?loc>/gi)){
     const raw=m[1].trim().replaceAll('&amp;','&');add(index?'map':'page',index?mapUrl(raw,url,origin):pageUrl(raw,url,origin))
    }
   }else if(task.kind==='page'){
    if(!r.type.toLowerCase().includes('html'))out.state='unsupported'
    else{
     const {links,...meta}=htmlPage(r.text,url.href)
     out.meta={...meta,url:url.href,status:r.status,wpId:task.wp_id}
     if(r.status===200){for(const link of links)add('page',pageUrl(link,url,origin))}
     else out.state='unavailable'
    }
   }else if(task.kind==='wp'&&r.status!==404&&r.status!==410&&r.status!==400)out.state='unsupported'
   else if(task.kind==='map'&&r.status!==404&&r.status!==410)out.state='unsupported'
   out.added=[...added.values()]
  }catch{out.state='failed';out.added=[]}
  results.push(out)
 }
 return results
}
