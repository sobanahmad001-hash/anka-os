import {buildWebsiteBlockSource} from './websiteBlockBuild.js'
import {websiteNativeSnapshotChecksum} from './websiteNativeDesign.js'
import {createStoredZip} from '../wordpress-export/theme.ts'
export const STAGING_PROTOCOL='anka-stage-v1'
import {uuid,stagingOrigin} from './websiteStagingContracts.js'
export {uuid,stagingOrigin} from './websiteStagingContracts.js'
export const sha=async bytes=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',new Uint8Array(bytes).buffer))].map(x=>x.toString(16).padStart(2,'0')).join('')
export function verifyIdentity(identity,origin,siteId){
 if(identity?.protocol!==STAGING_PROTOCOL||!['7.1.3','7.1.4'].includes(identity.wordpress_version)||!/^8\.3\.[0-9]+$/.test(identity.php_version||'')||identity.compiler!=='anka-native-block-v1'||identity.environment!=='staging'||!uuid(identity.site_id)||identity.base_url!==origin||identity.published!==false||(siteId&&identity.site_id!==siteId))throw Error('Exact staging-only WordPress identity differs')
 return identity
}
export async function boundedResponse(response,limit=2097152){
 const stream=response.body?.getReader();if(!stream)throw Error('Staging response body unavailable');const parts=[];let size=0
 for(;;){const p=await stream.read();if(p.done)break;size+=p.value.byteLength;if(size>limit){await stream.cancel();throw Error('Staging response exceeds the bound')}parts.push(p.value)}
 const bytes=new Uint8Array(size);let offset=0;for(const p of parts){bytes.set(p,offset);offset+=p.byteLength}return new TextDecoder().decode(bytes)
}
// Return only fixed receiver diagnostics. Never reflect upstream messages, data,
// headers, HTML or unknown codes; a hosting denial may not be a WordPress error.
async function receiverFailure(response){
 const messages={
  anka_stage_environment:'The receiver requires staging environment and a valid staging site ID.',
  anka_stage_runtime:'The receiver requires reviewed WordPress 7.1.3 or 7.1.4 and PHP 8.3.',
  anka_stage_capability:'This receiver request lacks the dedicated staging capability.',
  anka_stage_origin:'The receiver requires its canonical HTTPS staging origin.',
  rest_not_logged_in:'WordPress did not authenticate this receiver request.',
  rest_forbidden:'WordPress denied access to this receiver route.',
 }
 let code
 try{
  if([401,403].includes(response.status)&&response.headers.get('content-type')?.split(';')[0].trim().toLowerCase()==='application/json'){
   const value=JSON.parse(await boundedResponse(response,4096))
   if(value&&typeof value==='object'&&!Array.isArray(value)&&typeof value.code==='string'&&Object.hasOwn(messages,value.code))code=value.code
  }else await response.body?.cancel()
 }catch{/* Malformed, oversized and unavailable bodies retain the safe HTTP diagnostic. */}
 return Error(code?'Staging receiver denied request ('+code+'): '+messages[code]:'Staging receiver request failed (HTTP '+response.status+'); no recognized receiver diagnostic was returned.')
}
export function publicAddress(ip){
 if(typeof ip!=='string')return false
 if(ip.includes(':')){
  if(!/^[a-f0-9:]+$/i.test(ip)||ip.split('::').length>2)return false
  const halves=ip.split('::'),left=halves[0]?halves[0].split(':'):[],right=halves[1]?halves[1].split(':'):[],missing=8-left.length-right.length
  if((halves.length===1&&left.length!==8)||(halves.length===2&&missing<1)||[...left,...right].some(x=>!x||x.length>4))return false
  const words=[...left,...Array(halves.length===2?missing:0).fill('0'),...right].map(x=>parseInt(x,16)),first=words[0],second=words[1]
  return first>=0x2000&&first<0x4000&&first!==0x2002&&first!==0x3fff&&!(first===0x2001&&(second<0x0200||second===0x0db8))
 }
 if(!/^\d{1,3}(?:\.\d{1,3}){3}$/.test(ip)||ip.split('.').some(x=>x.length>1&&x.startsWith('0')))return false
 const a=ip.split('.').map(Number);return a.every(x=>x<=255)&&![0,10,127].includes(a[0])&&a[0]<224&&!(a[0]===169&&a[1]===254)&&!(a[0]===172&&a[1]>=16&&a[1]<=31)&&!(a[0]===192&&[0,88,168].includes(a[1]))&&!(a[0]===100&&a[1]>=64&&a[1]<=127)&&!(a[0]===198&&[18,19,51].includes(a[1]))&&!(a[0]===203&&a[1]===0)
}
/** @param {any} connection @param {{env:(name:string)=>string|undefined,fetcher?:typeof fetch,resolver?:(host:string)=>Promise<string[]>}} dependencies */
export function createStagingTransport(connection,{env,fetcher=fetch,resolver}){
 const origin=stagingOrigin(connection.base_url),allowed=JSON.parse(env('WEBSITE_STAGING_ALLOWED_ORIGINS')||'[]')
 if(!Array.isArray(allowed)||!allowed.includes(origin))throw Error('This exact staging origin is not enabled by the server operator')
 if(!/^ANKA_WORDPRESS_[A-Z0-9_]+$/.test(connection.secret_name||''))throw Error('Scoped WordPress secret reference required')
 const secret=env(connection.secret_name)
 if(!secret||typeof connection.username!=='string'||!connection.username||connection.username.includes(':'))throw Error('Server-side WordPress application credential unavailable')
 const auth='Basic '+btoa(connection.username+':'+secret)
 /** @param {string} path @param {{method?:string,body?:any,html?:boolean}} options */
 async function request(path,{method='GET',body,html=false}={}){
  if(!/^\/wp-json\/anka-stage\/v1\/(?:identity|head(?:\?[^#]*)?|deploy|requests\/[0-9a-f-]+)$/.test(path)&&!/^\/\?anka_staging_preview=[0-9a-f-]+$/.test(path))throw Error('Unsupported staging-only route')
  if(resolver){const addresses=await resolver(new URL(origin).hostname);if(!addresses.length||addresses.some(x=>!publicAddress(x)))throw Error('Staging DNS target is not public')}
  const response=await fetcher(origin+path,{method,redirect:'error',signal:AbortSignal.timeout(12000),headers:{Authorization:auth,Accept:html?'text/html':'application/json',...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})})
  if(!response.ok)throw await receiverFailure(response)
  const text=await boundedResponse(response)
  if(html){if(!response.headers.get('content-type')?.startsWith('text/html')||!response.headers.get('cache-control')?.includes('no-store'))throw Error('Private staging HTML verification unavailable');return text}
  if(!response.headers.get('content-type')?.includes('application/json'))throw Error('Staging receiver returned a different format')
  return JSON.parse(text)
 }
 return Object.freeze({origin,request,async identity(siteId){return verifyIdentity(await request('/wp-json/anka-stage/v1/identity'),origin,siteId)}})
}
export async function stagingBundle(context){
 const source=await buildWebsiteBlockSource(context.source.manifest),j=context.job
 if(JSON.stringify(Object.entries(source.file_hashes).sort())!==JSON.stringify(Object.entries(j.seo_verification?.file_hashes||{}).sort()))throw Error('Original native package file hashes differ')
 const archive=createStoredZip(Object.entries(source.files).sort(([a],[b])=>a.localeCompare(b)).map(([name,text])=>({name:source.directory+'/'+name,bytes:new TextEncoder().encode(text)})))
 if(await sha(archive)!==j.artifact_sha256||archive.byteLength!==j.seo_verification.package_bytes)throw Error('Original native package bytes differ')
 return source
}
export async function stagingCommand(context,run,bundle){
 const pagePath=context.source?.context?.page?.path;if(typeof pagePath!=='string'||!pagePath||pagePath.length>1200||/[?#\u0000-\u001f\u007f]/.test(pagePath))throw Error('Exact approved page path required independently of its stable key')
 const command={page_path:pagePath,protocol:STAGING_PROTOCOL,request_id:run.request_id,site_id:context.target.site_id,scope:bundle.scope,expected_head:run.remote_head,package_sha256:context.job.artifact_sha256,files:bundle.files,file_hashes:bundle.file_hashes,created_at:run.created_at}
 return {...command,command_sha256:await websiteNativeSnapshotChecksum(command)}
}
export function verifyStagingReceipt(r,context,run){
 verifyIdentity(r,context.target.base_url,context.target.site_id)
 if(r.request_id!==run.request_id||r.page_id!==run.page_id||r.package_sha256!==context.job.artifact_sha256||!['staged','pending','conflict','missing'].includes(r.status))throw Error('Original staging receipt differs')
 if(r.status==='staged'&&r.preview_url!==context.target.base_url+'/?anka_staging_preview='+run.request_id)throw Error('Staging preview destination differs')
 return r
}
