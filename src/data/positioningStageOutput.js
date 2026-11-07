const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function readPositioningStageOutput(client,scope,signal){
  const {organizationId,projectId,engagementId,actorId}=scope
  if(![organizationId,projectId,engagementId,actorId].every(id=>uuid.test(id)))throw Error('Exact project and actor required.')
  const request=client.rpc('read_project_positioning_output',{p_organization_id:organizationId,p_project_id:projectId,p_engagement_id:engagementId,p_conversation_id:null,p_version_id:null})
  const {data,error}=await request.abortSignal(signal)
  if(error)throw Error(error.message)
  if(data?.organization_id!==organizationId||data.project_id!==projectId||data.engagement_id!==engagementId||data.actor_id!==actorId||data.selected!==null||
    !(data.binding_id===null||uuid.test(data.binding_id)))throw Error('Positioning output scope changed.')
  let current=null
  if(data.current!==null){
    const {version_id,version_number,wording_sha256,binding_id,conversation_id}=data.current||{}
    if(!uuid.test(version_id)||!Number.isSafeInteger(version_number)||version_number<1||!/^[0-9a-f]{64}$/.test(wording_sha256)||!uuid.test(binding_id)||!(conversation_id===null||uuid.test(conversation_id)))throw Error('Positioning version metadata is unavailable.')
    current={version_id,version_number,wording_sha256,binding_id,conversation_id}
  }
  return {current,bindingId:data.binding_id}
}
