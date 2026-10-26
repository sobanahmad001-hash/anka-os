import {inspectDesignPdf} from './designPdfInspection.mjs'
import {inspectDepartmentChatAttachment} from './departmentChatAttachments.ts'
import {DOCUMENT_MIMES,parseDocumentRequest,validateDocumentProposal,documentProposalSheet} from './projectDocumentProposal.js'
export async function inspectProjectDocument(bytes:Uint8Array,mime:string){
 if(!DOCUMENT_MIMES.includes(mime)||bytes.length>2097152)throw Error('Document proposal originals are limited to 2 MiB; PDF/DOCX only')
 const result=mime==='application/pdf'?await inspectDesignPdf(bytes):inspectDepartmentChatAttachment(bytes,mime)
 if(!result.extractedText)throw Error('Readable complete document extraction required')
 const rawSegments='segments' in result?result.segments:result.extractedText.split(/\n+/).filter(Boolean).map((text:string,i:number)=>({id:'extracted-paragraph:'+(i+1),text}))
 const segments=rawSegments.flatMap((segment:any)=>{if(segment.text.length<=2000)return [segment];const parts=[];for(let start=0;start<segment.text.length;){let end=Math.min(start+1800,segment.text.length);if(/[\uD800-\uDBFF]/.test(segment.text[end-1]))end--;parts.push({id:segment.id+':chars:'+start+'-'+end,text:segment.text.slice(start,end)});start=end}return parts})
 if(segments.length>200)throw Object.assign(Error('Document has too many separate passages for bounded proposal review; no text truncated'),{status:422,code:'DOCUMENT_PASSAGES_LIMIT'})
 return {revision:'project-document-proposal-v1',segments,notice:result.extractionNotice,characters:result.extractedText.length}
}
export async function reconstructDocumentProposal(admin:any,scope:any,attachment:any,inspection:any,messageId:string,requireReady=true){
 const {data:reply,error}=await admin.from('department_chat_messages').select('*').eq('id',messageId).eq('conversation_id',scope.conversation.id).eq('organization_id',scope.organizationId).eq('role','assistant').eq('status','completed').maybeSingle()
 if(error||!reply||!reply.in_reply_to_message_id)throw Error('Exact completed document proposal reply required')
 const {data:human,error:humanError}=await admin.from('department_chat_messages').select('*').eq('id',reply.in_reply_to_message_id).eq('conversation_id',scope.conversation.id).eq('organization_id',scope.organizationId).eq('author_id',scope.actorId).eq('role','user').maybeSingle()
 const d=parseDocumentRequest(human?.body)
 if(humanError||!d||d.source.attachmentId!==attachment.id||d.source.sha256!==attachment.sha256_hex||d.source.name!==attachment.original_name||d.source.mime!==attachment.verified_mime||d.source.classification!==attachment.data_classification||d.source.revision!==inspection.revision||d.segments.some((s:any)=>!inspection.segments.some((original:any)=>s.id===original.id&&s.text===original.text)))throw Error('Document proposal source/version/disclosure changed')
 const proposal=validateDocumentProposal(reply.body,d),prepared=requireReady||proposal.ready?documentProposalSheet(proposal,reply.id):{mapping:{},sheet:null}
 return {...prepared,type:proposal.type,proposal,disclosure:d,document:{message_id:reply.id,human_message_id:human.id,revision:inspection.revision,disclosed_segments:d.segments.map((s:any)=>s.id),rows:proposal.rows.map((r:any,i:number)=>({row:i+2,citations:r.citations})),notice:inspection.notice}}
}
