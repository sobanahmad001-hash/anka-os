export function createProjectContentJourneyRepository(client){
 const read=async q=>{const {data,error}=await q;if(error)throw Error(error.message);return data}
 const args=s=>({p_organization_id:s.organizationId,p_project_id:s.projectId,p_conversation_id:s.conversationId})
 return {
  list:s=>read(client.rpc('read_project_content_journeys',args(s))),
  bind:(s,messageId,workId)=>read(client.rpc('bind_project_content_journey',{...args(s),p_source_message_id:messageId,p_work_item_id:workId})),
  recoverHandoff:(s,requestId)=>read(client.from('content_n3_handoff_links').select('request_id,artifact_version_id,created_by').eq('organization_id',s.organizationId).eq('project_id',s.projectId).eq('created_by',s.actorId).eq('request_id',requestId).maybeSingle()),
  async handoffs(s,versionId){
   const links=await read(client.from('content_n3_handoff_links').select('*').eq('organization_id',s.organizationId).eq('project_id',s.projectId).eq('artifact_version_id',versionId).limit(100))||[]
   const results=[]
   for(const link of links){
    const recipient=await read(client.from('engagement_services').select('id,engagement_id,service_catalog!inner(department_id)').eq('organization_id',s.organizationId).eq('id',link.receiving_service_id).maybeSingle())
    const catalog=Array.isArray(recipient?.service_catalog)?recipient.service_catalog[0]:recipient?.service_catalog
    if(recipient?.engagement_id!==s.engagementId||catalog?.department_id!=='design')continue
    const request=await read(client.from('requests').select('id,status').eq('organization_id',s.organizationId).eq('project_id',s.projectId).eq('id',link.request_id).maybeSingle())
    const kind=link.work_kind,table=kind==='engagement_work_item'?'work_items':kind==='project_task'?'tasks':null
    const work=table?await read(client.from(table).select('*').eq('organization_id',s.organizationId).eq('project_id',s.projectId).eq('id',link.work_id).maybeSingle()):null
    let artifact=null,version=null
    if(kind==='engagement_work_item'&&work?.department_id==='design'&&!work.deleted_at&&work.engagement_id===s.engagementId&&work.linked_artifact_id&&work.linked_artifact_version_id){
     artifact=await read(client.from('artifacts').select('id,title,artifact_type').eq('organization_id',s.organizationId).eq('engagement_id',s.engagementId).eq('id',work.linked_artifact_id).maybeSingle())
     if(artifact)version=await read(client.from('artifact_versions').select('id,artifact_id,version_number,content,content_checksum').eq('organization_id',s.organizationId).eq('artifact_id',artifact.id).eq('id',work.linked_artifact_version_id).maybeSingle())
    }
    results.push({link,request,work,artifact,version})
   }
   return results
  },
 }
}
