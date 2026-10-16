import {stableJson} from './approvedArtifactContext.ts'
import {parseDesignBriefReply, type BriefJson} from './designChatBriefContract.ts'
import {validateIdentityReferenceRows} from '../design-workshop/creativeBriefs.ts'
import {normalizeMediaReferences,validateMediaReferences} from '../design-workshop/mediaReferences.ts'
type Client=any
export type DesignBriefTurnIdentity={organization_id:string,actor_id:string,conversation_id:string,message_id:string,request_id?:string}
async function rpc(admin:Client,name:string,args:BriefJson){const {data,error}=await admin.rpc(name,args);if(error)throw error;return data}
function args(i:DesignBriefTurnIdentity){return {p_org:i.organization_id,p_actor:i.actor_id,p_conversation:i.conversation_id,p_message:i.message_id,p_request:i.request_id||null}}
async function sources(userClient:Client,org:string,b:BriefJson){
 await validateMediaReferences(userClient,normalizeMediaReferences(b.content?.media_references),org,b.engagement_id,b.brand_id)
 const ids=b.source_version_ids;if(!Array.isArray(ids)||ids.length>50||new Set(ids).size!==ids.length)throw Error('Exact source versions required')
 if(!ids.length)return
 const rows=await userClient.from('artifact_versions').select('id,organization_id,artifact_id,artifacts!inner(artifact_type,brand_id,organization_id)').in('id',ids)
 if(rows.error||rows.data?.length!==ids.length||rows.data.some((r:BriefJson)=>r.organization_id!==org))throw Error('Pinned source unavailable')
 const identityIds=rows.data.filter((r:BriefJson)=>(Array.isArray(r.artifacts)?r.artifacts[0]:r.artifacts)?.artifact_type==='design_system').map((r:BriefJson)=>r.id)
 const approvals=identityIds.length?await userClient.from('artifact_approvals').select('artifact_version_id,organization_id').eq('organization_id',org).in('artifact_version_id',identityIds):{data:[],error:null}
 if(approvals.error)throw Error('Approved identity references unavailable')
 validateIdentityReferenceRows(rows.data,approvals.data||[],org,b.brand_id)
}
export async function beginDesignChatBriefTurn(admin:Client,userClient:Client,input:DesignBriefTurnIdentity&{binding:BriefJson}){
 await sources(userClient,input.organization_id,input.binding)
 return rpc(admin,'begin_design_chat_brief_turn',{...args(input),p_binding:input.binding})
}
export async function recoverDesignChatBriefTurn(admin:Client,identity:DesignBriefTurnIdentity){try{return await rpc(admin,'recover_design_chat_brief_turn',args(identity))}catch(error){if((error as {code?:string})?.code==='P0002')return null;throw error}}
export async function finalizeDesignChatBriefTurn(admin:Client,userClient:Client,identity:DesignBriefTurnIdentity,rawReply:string){
 const receipt=await recoverDesignChatBriefTurn(admin,identity)
 if(!receipt)throw Error('Original brief turn not found')
 await sources(userClient,identity.organization_id,receipt.binding)
 if(!identity.request_id)identity={...identity,request_id:receipt.request_id}
 let parsed;try{parsed=parseDesignBriefReply(rawReply,receipt.binding.content)}catch{return rpc(admin,'finalize_design_chat_brief_turn',{...args(identity),p_result:{invalid:true}})}
 const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(stableJson(parsed.content)))
 const content_checksum=[...new Uint8Array(digest)].map(x=>x.toString(16).padStart(2,'0')).join('')
 return rpc(admin,'finalize_design_chat_brief_turn',{...args(identity),p_result:{...parsed,content_checksum}})
}
