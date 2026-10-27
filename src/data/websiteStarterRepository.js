const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
export function canPublishWebsiteStarter(membership) {
  return Boolean(membership?.organizationId) && ['system_owner','operations_admin'].includes(membership?.role)
}
export function createWebsiteStarterRepository(client) {
  async function call(name,args,signal) {
    if(signal?.aborted) throw new Error('Organization context changed')
    let query=client.rpc(name,args)
    if(signal && query.abortSignal) query=query.abortSignal(signal)
    const {data,error}=await query
    if(error) throw Object.assign(new Error(error.message || 'Website plan request failed'),{code:error.code})
    if(signal?.aborted) throw new Error('Organization context changed')
    return data
  }
  function org(id){if(!UUID.test(id || ''))throw new Error('Select an organization');return id}
  return {
    review:(organizationId,signal)=>call('review_website_starter',{p_organization_id:org(organizationId)},signal),
    publish:(organizationId,command,signal)=>{
      if(!UUID.test(command?.requestId || '') || !/^[a-f0-9]{64}$/.test(command?.hash || '') || typeof command?.reason!=='string' || !command.reason.trim() || command.reason.trim().length>500)throw new Error('Review the exact Website plan first')
      return call('publish_website_starter',{p_organization_id:org(organizationId),p_request_id:command.requestId,p_review_sha256:command.hash,p_reason:command.reason.trim()},signal)
    },
  }
}
