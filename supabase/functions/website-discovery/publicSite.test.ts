import {publicAddress,siteOrigin} from './publicSite.ts'
import {discover} from './discover.js'
Deno.test('discovery requires a public HTTPS origin and routable IPv4 transport',()=>{
 for(const ip of ['127.0.0.1','10.0.0.1','169.254.1.1','192.168.1.1','198.18.0.1','100.64.1.1','224.0.0.1','::1','192.0.2.1']){
  if(publicAddress(ip))throw Error('Unexpected address eligibility')
 }
 if(!publicAddress('93.184.216.34'))throw Error('Public endpoint unavailable')
 for(const site of ['http://site.example','https://site.example:8443','https://user@site.example','https://a.internal','https://site.example/admin']){
  let allowed=true;try{siteOrigin(site)}catch{allowed=false}if(allowed)throw Error('Unexpected origin eligibility')
 }
})
Deno.test('discovery follows only same-origin allowed redirects within its cap',async()=>{
 const origin='https://fixture.example',seen:string[]=[]
 await discover(origin,async(u:URL)=>{
  seen.push(u.href)
  if(u.origin!==origin)throw Error('Unexpected origin')
  if(u.pathname==='/robots.txt')return {status:200,type:'text/plain',text:'User-agent: *\nDisallow: /admin'}
  return {status:302,location:u.pathname==='/'?'https://other.example/':'/admin',text:'',type:'text/html'}
 })
 if(seen.some(v=>!v.startsWith(origin+'/')||v.endsWith('/admin'))||seen.length>48)throw Error('Unexpected fetch')
})
