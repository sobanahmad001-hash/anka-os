import {ReportingProviderFailure} from './reportingRefreshWorker.js'
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const graphId=value=>typeof value==='string'&&/^[0-9]{4,40}$/.test(value)
const FIELDS='integration_connection_id,organization_id,brand_id,facebook_page_id,instagram_account_id,connected_at,token_expires_at,access_token_ciphertext,access_token_iv'
// Database UTC timestamps retain all six fractional digits. Millisecond Date equality
// must never accept a different credential revision within the same millisecond.
function exactStamp(value){
 if(typeof value!=='string')return null
 const match=/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.([0-9]{1,6}))?(?:Z|\+00:00)$/.exec(value)
 if(!match||match[1].startsWith('0000')||!Number.isFinite(Date.parse(match[1]+'Z'))||new Date(match[1]+'Z').toISOString().slice(0,19)!==match[1])return null
 return match[1]+'.'+(match[2]||'').padEnd(6,'0')+'Z'
}
const disconnected=()=>new ReportingProviderFailure('disconnected')
/** Local credential identity only, never observed Graph permission or metric capability.
 * The reviewed Facebook adapter verifies exact resource access separately.
 * Linked Instagram identity is local metadata, never Instagram capability.
 */
export function createReportingMetaCredentialReader({admin,decrypt,encryptionMaterial,now=()=>Date.now()}){
 return async(context,signal)=>{
  if(signal?.aborted)throw new Error('Original request aborted')
  if(context?.provider!=='meta'||!['meta_facebook_page','meta_instagram_account'].includes(context.resource_kind)||!['organization_id','project_id','brand_id','connection_id','binding_id'].every(k=>typeof context[k]==='string'&&UUID.test(context[k]))||!/^[a-f0-9]{64}$/.test(context.context_checksum||'')||!Number.isSafeInteger(context.binding_revision_number)||context.binding_revision_number<1||!graphId(context.resource_key)||context.credential_state!=='available'||context.connection_status!=='verified'||context.connection_archived!==false||context.project_archived!==false||context.engagement_active!==true||context.selected_resource_matches!==true||context.external_write_authorized!==false||JSON.stringify(context.permitted_operations)!=='["reporting_read"]')throw disconnected()
  const revision=exactStamp(context.credential_revision),material=encryptionMaterial()
  if(!revision||typeof material!=='string'||material.length<32||material.length>4096)throw disconnected()
  const resourceColumn=context.resource_kind==='meta_facebook_page'?'facebook_page_id':'instagram_account_id'
  let query=admin().from('meta_connections').select(FIELDS).eq('integration_connection_id',context.connection_id).eq('organization_id',context.organization_id).eq('brand_id',context.brand_id).eq(resourceColumn,context.resource_key).maybeSingle()
  if(signal&&query.abortSignal)query=query.abortSignal(signal)
  const {data:c,error}=await query
  if(signal?.aborted)throw new Error('Original request aborted')
  const expires=exactStamp(c?.token_expires_at),clock=now()
  if(error||!c||c.integration_connection_id!==context.connection_id||c.organization_id!==context.organization_id||c.brand_id!==context.brand_id||c[resourceColumn]!==context.resource_key||!graphId(c.facebook_page_id)||(c.instagram_account_id!==null&&!graphId(c.instagram_account_id))||exactStamp(c.connected_at)!==revision||!expires||!Number.isFinite(clock)||Date.parse(expires)<=clock||typeof c.access_token_ciphertext!=='string'||!c.access_token_ciphertext||c.access_token_ciphertext.length>131072||typeof c.access_token_iv!=='string'||!c.access_token_iv||c.access_token_iv.length>1024)throw disconnected()
  let token;try{token=await decrypt(c.access_token_ciphertext,c.access_token_iv,material)}catch{throw disconnected()}
  const after=now()
  if(signal?.aborted||!Number.isFinite(after)||Date.parse(expires)<=after||typeof token!=='string'||!token||token.length>16384||/[\s\u0000-\u001f\u007f]/.test(token))throw disconnected()
  // Page and linked-account identifiers are server-only inputs for subsequent exact
  // relationship verification. No requested scopes or authorization boolean is returned.
  return Object.freeze({token,facebookPageId:c.facebook_page_id,instagramAccountId:c.instagram_account_id,credentialRevision:revision,expiresAt:expires})
 }
}
