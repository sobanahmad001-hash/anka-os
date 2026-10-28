export function createProjectWorkCommandRepository(client) {
 const read=async(name,args)=>{const {data,error}=await client.rpc(name,args);if(error)throw Object.assign(new Error(error.message||'Project work action failed'),{code:error.code});return data}
 return Object.freeze({
  actor:async()=>{const {data,error}=await client.auth.getUser();if(error||!data?.user?.id)throw Error('Sign in to review project work');return data.user.id},
  apply:async(scope,requestId,command)=>{const {data,error}=await client.functions.invoke('work-items',{body:{action:'project_work_command',organizationId:scope.organizationId,projectId:scope.projectId,engagementId:scope.engagementId,activeServiceId:scope.activeServiceId,requestId,command,expectedActorId:scope.actorId}});if(error||data?.error)throw new Error(error?.message||data.error?.message||data.error||'Work action failed');return data?.data},
  recover:async(scope,requestId)=>{const {data,error}=await client.auth.getUser();if(error||data?.user?.id!==scope.actorId)throw Error('Sign-in context changed. Return to the original account before recovery.');return read('recover_project_work_command',{p_organization_id:scope.organizationId,p_project_id:scope.projectId,p_request_id:requestId})},
 })
}
