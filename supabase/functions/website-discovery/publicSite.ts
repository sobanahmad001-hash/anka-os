import {request} from 'node:https'
import {isIP} from 'node:net'
import {stagingOrigin} from '../_shared/websiteStagingContracts.js'

export function siteOrigin(input:string) {
  const raw=input.trim()
  return stagingOrigin(raw.includes('://')?raw:'https://'+raw)
}
// Dial only a validated IPv4 address. TLS still authenticates the original site name.
export function publicAddress(ip:string) {
  if(isIP(ip)!==4)return false
  const [a,b,c]=ip.split('.').map(Number)
  return a>0&&a<224&&a!==10&&a!==127&&!(a===100&&b>=64&&b<=127)&&!(a===169&&b===254)
    &&!(a===172&&b>=16&&b<=31)&&!(a===192&&(b===168||b===0||b===2||(b===88&&c===99)))
    &&!(a===198&&(b===18||b===19||(b===51&&c===100)))&&!(a===203&&b===0&&c===113)
}
export type Reply={status:number,text:string,type:string,location:string}
export async function pinSite(host:string) {
  const addresses=await Deno.resolveDns(host,'A')
  if(!addresses.length||addresses.some(ip=>!publicAddress(ip)))throw Error('A public IPv4 HTTPS site is required.')
  return addresses[0]
}
export function readPinned(url:URL,ip:string,timeout:number):Promise<Reply>{
  if(!publicAddress(ip)||siteOrigin(url.origin)!==url.origin)throw Error('Public site unavailable.')
  return new Promise((resolve,reject)=>{
    const fail=()=>reject(Error('Public page could not be read.'))
    const req=request({protocol:'https:',hostname:ip,port:443,servername:url.hostname,rejectUnauthorized:true,agent:false,
      path:url.pathname+url.search,method:'GET',maxHeaderSize:16384,
      headers:{Host:url.hostname,Accept:'text/html,application/xml,text/xml,application/json,text/plain','Accept-Encoding':'identity','User-Agent':'AnkaWebsiteInventory/1.0'}},res=>{
      const chunks:Uint8Array[]=[];let size=0
      res.on('data',(chunk:Uint8Array)=>{size+=chunk.length;if(size>384000){req.destroy();fail()}else chunks.push(chunk)})
      res.on('error',fail)
      res.on('end',()=>{
        if(size>384000)return fail()
        const bytes=new Uint8Array(size);let at=0
        for(const part of chunks){bytes.set(part,at);at+=part.length}
        resolve({status:res.statusCode||0,location:String(res.headers.location||''),type:String(res.headers['content-type']||''),text:new TextDecoder().decode(bytes)})
      })
    })
    const timer=setTimeout(()=>{req.destroy();fail()},timeout)
    req.on('error',fail);req.on('close',()=>clearTimeout(timer));req.end()
  })
}
