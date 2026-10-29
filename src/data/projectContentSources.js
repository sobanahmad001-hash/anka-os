// Explicit saved-message selection only. No semantic approval, parsing or write.
const fields=['organizationId','projectId','engagementId','conversationId','actorId']
const compare=(a,b)=>Number.isFinite(a.sequence)&&Number.isFinite(b.sequence)?b.sequence-a.sequence||a.id.localeCompare(b.id):Number.isFinite(Date.parse(a.created_at))&&Number.isFinite(Date.parse(b.created_at))?Date.parse(b.created_at)-Date.parse(a.created_at)||a.id.localeCompare(b.id):a.id.localeCompare(b.id)
export function projectContentSourceOptions(messages,scope){
 const counts=new Map();for(const m of messages||[])counts.set(m.id,(counts.get(m.id)||0)+1)
 return (messages||[]).filter(m=>typeof m.id==='string'&&counts.get(m.id)===1&&m.conversation_id===scope.conversationId&&typeof m.body==='string'&&m.body.trim()&&(m.role==='assistant'||m.role==='user'&&m.author_id===scope.actorId)).sort(compare)
}
export function reviewProjectContentSources(messages,selection,scope){
 if(fields.some(k=>typeof scope[k]!=='string'||!scope[k]))throw Error('Exact project conversation and actor required')
 const options=projectContentSourceOptions(messages,scope),request=options.find(m=>m.id===selection.requestId),brief=options.find(m=>m.id===selection.briefId),draft=options.find(m=>m.id===selection.draftId)
 if(request?.role!=='user'||request.author_id!==scope.actorId||!brief||draft?.role!=='assistant'||brief.id===draft.id)throw Error('Choose your saved request, the reviewed brief and a separate exact draft response')
 if(brief.body.length>20000||draft.body.length>128000)throw Error('Selected text exceeds the handoff bound; it was not truncated or copied')
 const message=m=>Object.freeze({id:m.id,role:m.role,author_id:m.author_id||null,conversation_id:m.conversation_id,body:m.body,sequence:m.sequence??null,created_at:m.created_at??null})
 const result={scope:Object.freeze(Object.fromEntries(fields.map(k=>[k,scope[k]]))),request:message(request),brief:message(brief),draft:message(draft)}
 return Object.freeze({...result,key:JSON.stringify(result)})
}
export function projectContentSourcesCurrent(review,messages,scope){
 try{return Boolean(review)&&reviewProjectContentSources(messages,{requestId:review.request.id,briefId:review.brief.id,draftId:review.draft.id},scope).key===review.key}catch{return false}
}
export function projectContentSourcesProposal(review){
 const title=review.brief.body.trim().split('\n')[0]
 return Object.freeze({sourceMessageId:review.request.id,sourceKey:review.key,action:'create',title:title.length<=240?title:'',description:review.brief.body,department:'content'})
}
