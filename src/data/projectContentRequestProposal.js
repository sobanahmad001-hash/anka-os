export function projectContentRequestProposal(message,{conversationId,actorId}){
 if(message?.role!=='user'||message.author_id!==actorId||message.conversation_id!==conversationId||typeof message.body!=='string'||!message.body.trim()||message.body.length>8000)throw Error('Choose your saved human request in this exact conversation')
 const title=message.body.trim().split('\n')[0]
 return Object.freeze({sourceMessageId:message.id,action:'create',title:title.length<=240?title:'',description:message.body,department:'content'})
}
