/** project.get_context v1. Pass ONLY the caller's authenticated RLS client.
 * This is a read adapter, not an endpoint or an authorization grant. The host
 * must validate its transport/delegation before constructing that client.
 * Mirrors Project Work's scoped project/engagement/artifact reads, without
 * importing its browser singleton or reading any conversation, message or file.
 */
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i
const HASH = /^[a-f0-9]{64}$/
const fail = (code, status = 409) => Object.assign(Error(code), {code, status})
const id = value => typeof value === 'string' && UUID.test(value)
const date = value => typeof value === 'string' && Number.isFinite(Date.parse(value))
const text = value => typeof value === 'string' && value.trim() ? value : null
const check = (condition, code = 'context_scope_mismatch') => { if (!condition) throw fail(code) }
const freeze = value => { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value) } return value }
export const projectGetContextContract = Object.freeze({
  operation: 'project.get_context', schema_version: 1, effects: 'read_only',
  provider_dependencies: [], private_chat_included: false,
})

export function createProjectGetContextAdapter(userClient, {now = () => new Date().toISOString()} = {}) {
  return async function getContext(input, {signal} = {}) {
    check(input && Object.keys(input).every(k => ['organization_id','project_id'].includes(k)) && id(input.organization_id) && id(input.project_id), 'invalid_context_request')
    const {organization_id: org, project_id: projectId} = input
    const abort = () => { if (signal?.aborted) throw Object.assign(Error('Context read cancelled'), {name:'AbortError'}) }
    const read = async query => {
      abort()
      const result = await (signal ? query.abortSignal(signal) : query)
      abort()
      if (result.error) throw fail('context_read_unavailable', result.error.code === '42501' ? 403 : 503)
      return result.data
    }
    abort()
    const auth = await userClient.auth.getUser()
    abort()
    if (auth.error || !id(auth.data?.user?.id)) throw fail('authentication_required', 401)
    const actor = auth.data.user.id
    const project = await read(userClient.from('projects')
      .select('id,organization_id,name,description,scope_statement,status,archived_at')
      .eq('organization_id',org).eq('id',projectId).is('archived_at',null).maybeSingle())
    if (!project) throw fail('project_unavailable',403)
    check(project.id === projectId && project.organization_id === org && project.archived_at === null && text(project.name))
    const engagements = await read(userClient.from('engagements')
      .select('id,organization_id,project_id,status').eq('organization_id',org).eq('project_id',projectId).order('id').limit(2))
    check(Array.isArray(engagements) && engagements.every(e => id(e.id) && e.organization_id === org && e.project_id === projectId))
    const gaps = []
    if (!text(project.description)) gaps.push({code:'business_description_missing',source:'projects.description'})
    if (!text(project.scope_statement)) gaps.push({code:'scope_missing',source:'projects.scope_statement'})
    let engagement = null, positioning = null
    const approved = []
    if (engagements.length !== 1) gaps.push({code:engagements.length ? 'engagement_ambiguous' : 'engagement_missing',source:'engagements'})
    else if (!['planning','active'].includes(engagements[0].status)) gaps.push({code:'engagement_inactive',source:'engagements'})
    else {
      engagement = engagements[0]
      const args = {p_organization_id:org,p_project_id:projectId,p_engagement_id:engagement.id,p_conversation_id:null,p_version_id:null}
      const output = await read(userClient.rpc('read_project_positioning_output',args))
      check(output?.organization_id === org && output.project_id === projectId && output.engagement_id === engagement.id && output.actor_id === actor && output.selected === null)
      check(output.binding_id === null || id(output.binding_id))
      if (output.current !== null) {
        const c = output.current
        check(id(c?.version_id) && Number.isSafeInteger(c.version_number) && c.version_number > 0 && id(c.binding_id) && HASH.test(c.wording_sha256))
        positioning = {version_id:c.version_id,version_number:c.version_number,wording_sha256:c.wording_sha256,binding_id:c.binding_id,current_binding_matches:c.binding_id === output.binding_id,wording_included:false}
        if (!positioning.current_binding_matches) gaps.push({code:'positioning_binding_stale',source:'read_project_positioning_output'})
        gaps.push({code:'positioning_shared_wording_unavailable',source:'read_project_positioning_output'})
      } else gaps.push({code:'positioning_missing',source:'read_project_positioning_output'})
      const artifacts = await read(userClient.from('artifacts')
        .select('id,organization_id,project_id,engagement_id,artifact_type,title')
        .eq('organization_id',org).eq('project_id',projectId).eq('engagement_id',engagement.id).order('id').limit(101))
      check(Array.isArray(artifacts) && artifacts.every(a => id(a.id) && a.organization_id === org && a.project_id === projectId && a.engagement_id === engagement.id))
      check(artifacts.length <= 100,'context_limit_exceeded')
      if (artifacts.length) {
        const byArtifact = new Map(artifacts.map(a => [a.id,a]))
        const approvals = await read(userClient.from('artifact_approvals')
          .select('id,organization_id,engagement_id,artifact_id,artifact_version_id,decision,approved_at')
          .eq('organization_id',org).eq('engagement_id',engagement.id).in('artifact_id',[...byArtifact.keys()])
          .order('approved_at',{ascending:false}).order('id').limit(201))
        check(Array.isArray(approvals) && approvals.length <= 200,'context_limit_exceeded')
        check(approvals.every(a => id(a.id) && a.organization_id === org && a.engagement_id === engagement.id && byArtifact.has(a.artifact_id) && id(a.artifact_version_id) && date(a.approved_at)))
        const accepted = approvals.filter(a => a.decision === 'approved')
        if (accepted.length) {
          const versions = await read(userClient.from('artifact_versions')
            .select('id,organization_id,artifact_id,version_number,content_checksum,ai_use_allowed,data_classification,created_at')
            .eq('organization_id',org).in('artifact_id',[...byArtifact.keys()]).in('id',[...new Set(accepted.map(a => a.artifact_version_id))]).order('id').limit(201))
          check(Array.isArray(versions) && versions.length <= 200 && versions.every(v => id(v.id) && v.organization_id === org && byArtifact.has(v.artifact_id)))
          const seen = new Set()
          for (const a of accepted) {
            const v = versions.find(v => v.id === a.artifact_version_id && v.artifact_id === a.artifact_id)
            if (!v) { gaps.push({code:'approved_version_unavailable',source:'artifact_versions',reference_id:a.artifact_version_id}); continue }
            check(Number.isSafeInteger(v.version_number) && v.version_number > 0 && HASH.test(v.content_checksum) && date(v.created_at))
            if (v.ai_use_allowed !== true || !['public','internal','confidential'].includes(v.data_classification)) {
              gaps.push({code:'approved_version_ai_use_unavailable',source:'artifact_versions',reference_id:v.id}); continue
            }
            check(!seen.has(v.id),'duplicate_approved_version'); seen.add(v.id)
            approved.push({artifact_id:v.artifact_id,artifact_type:byArtifact.get(v.artifact_id).artifact_type,artifact_version_id:v.id,version_number:v.version_number,content_checksum:v.content_checksum,approval_id:a.id,approved_at:a.approved_at,evidence_created_at:v.created_at,body_included:false})
          }
        }
      }
    }
    if (!approved.length) gaps.push({code:'approved_shared_sources_missing',source:'artifact_approvals'})
    abort()
    const observedAt = now(); check(date(observedAt),'invalid_observation_date')
    return freeze({schema_version:1,operation:'project.get_context',organization_id:org,project_id:projectId,actor_id:actor,observed_at:observedAt,
      project:{id:project.id,name:project.name,status:project.status,business_description:text(project.description),scope_statement:text(project.scope_statement),input_state:'recorded_not_approval',evidence_date:null},
      engagement:engagement ? {id:engagement.id,status:engagement.status} : null,
      positioning,approved_versions:approved,gaps,private_chat_included:false,external_write_authorized:false})
  }
}
