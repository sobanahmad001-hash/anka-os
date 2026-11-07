const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const digest = /^[a-f0-9]{64}$/
const validOption = value => uuid.test(value?.checkpoint_id) && Number.isSafeInteger(value.source_version) && value.source_version > 0
const validBinding = value => validOption(value) && uuid.test(value.request_id) && digest.test(value.brief_sha256)
export const sameCheckpoint = (a,b) => Boolean(a && b && a.checkpoint_id === b.checkpoint_id && a.source_version === b.source_version && a.brief_sha256 === b.brief_sha256)
export const sameBinding = (a,b) => sameCheckpoint(a,b) && a.request_id === b.request_id

export function createFoundationCheckpointRepository(client) {
  async function call(scope, name, args, signal) {
    if (![scope.actorId,scope.organizationId,scope.projectId,scope.engagementId].every(id=>uuid.test(id)) || signal?.aborted) throw Error('Current foundation access required.')
    const auth = await client.auth.getUser()
    if (auth.error || auth.data?.user?.id !== scope.actorId || signal?.aborted) throw Error('Foundation access changed.')
    const deadline = AbortSignal.timeout(15000)
    const {data,error} = await client.rpc(name,{p_organization_id:scope.organizationId,p_project_id:scope.projectId,p_engagement_id:scope.engagementId,...args}).abortSignal(signal ? AbortSignal.any([signal,deadline]) : deadline)
    if (error) throw Object.assign(Error(error.message),{code:error.code})
    return data
  }
  return {
    async read(scope, checkpointId=null, offset=0, signal) {
      if ((checkpointId !== null && !uuid.test(checkpointId)) || !Number.isSafeInteger(offset) || offset<0) throw Error('Invalid checkpoint selection.')
      const row = await call(scope,'read_project_foundation_brief',{p_checkpoint_id:checkpointId,p_offset:offset},signal)
      if (row?.organization_id!==scope.organizationId || row.project_id!==scope.projectId || row.engagement_id!==scope.engagementId || row.actor_id!==scope.actorId ||
        !(row.current_binding===null || validBinding(row.current_binding)) || !Array.isArray(row.options) || !row.options.every(validOption) || typeof row.has_more!=='boolean' || (row.has_more&&!row.options.length)) throw Error('Foundation checkpoint scope changed.')
      const selected=row.selected
      if (checkpointId===null ? selected!==null : !validOption(selected)||selected.checkpoint_id!==checkpointId||!digest.test(selected.brief_sha256)||typeof selected.brief_text!=='string'||typeof selected.matches_current_brief!=='boolean') throw Error('Selected checkpoint is unavailable.')
      return row
    },
    async recover(scope,attempt,signal) {
      if (!validBinding(attempt)) throw Error('Original checkpoint request identity is unavailable.')
      const dto=await call(scope,'recover_project_foundation_brief',{p_request_id:attempt.request_id},signal)
      if (dto!==null && !sameBinding(dto,attempt)) throw Error('Original checkpoint receipt differs from the reviewed request.')
      return dto
    },
    async bind(scope,attempt,signal) {
      if (!validBinding(attempt) || !(attempt.expected===null || uuid.test(attempt.expected))) throw Error('Review the selected checkpoint again.')
      const dto=await call(scope,'bind_project_foundation_brief',{p_checkpoint_id:attempt.checkpoint_id,p_source_version:attempt.source_version,p_brief_sha256:attempt.brief_sha256,p_expected_binding_id:attempt.expected,p_request_id:attempt.request_id},signal)
      if (!sameBinding(dto,attempt)) throw Error('Binding response differs from the original request.')
      return dto
    }
  }
}
