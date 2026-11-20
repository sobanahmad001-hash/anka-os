import {siteOrigin,pinSite,readPinned} from '../website-discovery/publicSite.ts'
import {pageUrl} from '../website-discovery/discover.js'
import {observedPageSnapshot} from './websiteObservedChanges.js'
export async function observeTrackedPage(address:string,transport={pin:pinSite,read:readPinned}){
 try{
  const origin=siteOrigin(new URL(address).origin),ip=await transport.pin(new URL(origin).hostname)
  if(!pageUrl(address,origin,origin))throw Error('Unsupported URL')
  const rules=await transport.read(new URL(origin+'/robots.txt'),ip,6000)
  if(![200,404,410].includes(rules.status))throw Error('Rules unavailable')
  let applies=false,group=false;const blocked:string[]=[]
  if(rules.status===200)for(const line of rules.text.split(/\r?\n/)){
   const match=line.replace(/#.*/,'').match(/^\s*([\w-]+):\s*(.*?)\s*$/);if(!match)continue
   const key=match[1].toLowerCase(),value=match[2]
   if(key==='user-agent'){if(group)applies=false;group=false;applies=applies||value==='*'||value.toLowerCase()==='ankawebsiteinventory'}
   if(key==='allow'||key==='disallow')group=true
   if(key==='disallow'&&applies&&value)blocked.push(value.split(/[*$]/)[0])
  }
  let url=new URL(address);const redirects:object[]=[]
  for(let hop=0;hop<4;hop++){
   if(blocked.some(prefix=>decodeURIComponent(url.pathname).startsWith(prefix)))return {state:'robots_excluded',url:address}
   const response=await transport.read(url,ip,6000)
   if([301,302,303,307,308].includes(response.status)){
    const next=new URL(response.location,url)
    if(!response.location||!pageUrl(next.href,origin,origin))return {state:'http_error',status:response.status,url:address,reason:'Redirect outside allowed page scope'}
    redirects.push({from:url.href,to:next.href,status:response.status});url=next;continue
   }
   if(response.status===200&&!response.type.toLowerCase().includes('html'))return {state:'http_error',status:200,url:address,reason:'Non-HTML response'}
   return {...observedPageSnapshot({html:response.text,url:url.href,status:response.status,redirects,robotsHeader:response.robotsHeader??null}),url:address,finalUrl:url.href}
  }
  return {state:'http_error',url:address,reason:'Redirect limit'}
 }catch{return {state:'read_failed',url:address}}
}
