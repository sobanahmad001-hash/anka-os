// Both RPCs use POST. Private text is carried only in the JSON body.

export function createProjectBriefRepository(client) {
  async function request(scope, original, description) {
    const { organizationId, projectId, actorId, signal } = scope
    if (!organizationId || !projectId || !actorId || signal?.aborted) throw Error('Current project access required')
    const auth = await client.auth.getUser()
    if (auth.error || auth.data?.user?.id !== actorId || signal?.aborted) throw Error('Project access changed')
    const args = { p_organization_id: organizationId, p_project_id: projectId }
    if (original) {
      if (original.id !== projectId || original.organization_id !== organizationId || !original.updated_at || !original.revision || typeof original.description !== 'string' || typeof description !== 'string') throw Error('Review the original project brief again')
      Object.assign(args, { p_actor_id: actorId, p_original_revision: original.revision, p_original_updated_at: original.updated_at,
        p_original_description: original.description, p_description: description })
    }
    let query = client.rpc(original ? 'save_project_business_brief' : 'read_project_business_brief', args)
    const timeout = AbortSignal.timeout(15000)
    query = query.abortSignal(signal ? AbortSignal.any([signal, timeout]) : timeout)
    const { data, error } = await query
    if (error) throw Error(error.message)
    if (data?.id !== projectId || data.organization_id !== organizationId || !data.revision || !data.updated_at || typeof data.description !== 'string' || (original && data.description !== description)) throw Error('Project brief changed or access is unavailable')
    return data
  }
  return { read: scope => request(scope), save: (scope, original, description) => request(scope, original, description) }
}
