import { createProjectStagePlanRepository } from './projectStagePlanRepository.js'
import { projectStagePlan } from './projectStagePlan.js'
import { validateProjectFoundation } from './projectFoundation.js'

const uuid = v => typeof v === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(v)
const need = (v, message) => { if (!v) throw Error(message) }
const freeze = v => { if (v && typeof v === 'object') { Object.values(v).forEach(freeze); Object.freeze(v) } return v }
const exact = (v, keys) => need(v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).sort().join(',') === [...keys].sort().join(','), 'Exact shared project scope required')
async function connection(client, scope, signal) {
  need(typeof client.from === 'function', 'Authenticated project readers required')
  const read = async query => {
    signal?.throwIfAborted()
    if (signal && query.abortSignal) query = query.abortSignal(signal)
    const { data, error } = await query
    signal?.throwIfAborted()
    if (error) throw Object.assign(Error('Authorized project connection is unavailable'), { code: error.code, status: error.code === '42501' ? 403 : undefined })
    return data
  }
  const project = await read(client.from('projects').select('id,organization_id,name,status,archived_at').eq('organization_id', scope.organization_id).eq('id', scope.project_id).is('archived_at', null).maybeSingle())
  need(project?.id === scope.project_id && project.organization_id === scope.organization_id && project.archived_at === null && typeof project.name === 'string' && project.name.trim().length > 0 && project.name.length <= 500, 'Authorized project display context is unavailable')
  const rows = await read(client.from('engagements').select('id,organization_id,project_id,name,status').eq('organization_id', scope.organization_id).eq('project_id', scope.project_id).order('id').limit(101))
  need(Array.isArray(rows) && rows.length <= 100 && rows.every(r => uuid(r.id) && r.organization_id === scope.organization_id && r.project_id === scope.project_id && typeof r.status === 'string' && typeof r.name === 'string' && r.name.length <= 500) && new Set(rows.map(r => r.id)).size === rows.length, 'Authorized project engagement connections are unavailable')
  const resolved = scope.engagement_id === null ? rows.length === 1 ? rows[0].id : null : scope.engagement_id
  need(resolved === null || rows.some(r => r.id === resolved), 'Selected engagement is unavailable in the exact project')
  const eligible = r => ['planning', 'active'].includes(r.status)
  return { project: { id: project.id, name: project.name, status: project.status }, engagement_connection: { state: resolved ? 'connected' : rows.length ? 'selection_required' : 'not_connected', resolved_engagement_id: resolved, stage_read_eligible: resolved !== null && eligible(rows.find(r => r.id === resolved)), choices: rows.map(r => ({ id: r.id, name: r.name, status: r.status, stage_read_eligible: eligible(r) })), provenance: { reader: 'authenticated_projects_and_engagements', project_id: scope.project_id } } }
}
function setup(d, s) {
  need(d?.organization_id === s.organization_id && d.project_id === s.project_id && /^[a-f0-9]{32}$/.test(d.token || '') && Array.isArray(d.scopes) && d.scopes.length <= 1000 && Array.isArray(d.leaves) && Array.isArray(d.catalog) && typeof d.can_manage === 'boolean', 'Canonical project setup is unavailable or differs from selection')
  need(d.state === null || d.state && Number.isSafeInteger(d.state.revision) && d.state.revision > 0 && d.state.plan && typeof d.state.plan === 'object', 'Canonical saved setup state required')
  const plan = d.state?.plan
  need(!plan || Array.isArray(plan.pipelines) && new Set(plan.pipelines).size === plan.pipelines.length && plan.pipelines.every(v => ['branding', 'website', 'marketing'].includes(v)), 'Canonical saved pipeline choices required')
  const services = d.scopes.map(row => {
    need(uuid(row.id) && uuid(row.service_id) && Number.isSafeInteger(row.revision) && row.revision > 0 && ['proposed', 'active', 'on_hold', 'completed', 'cancelled'].includes(row.status) && Number.isSafeInteger(row.quantity) && row.quantity > 0, 'Exact saved service scope required')
    // Service lifecycle (even completed) is not proof of completed required Work.
    return { scope_id: row.id, service_id: row.service_id, revision: row.revision, status: row.status, quantity: row.quantity }
  })
  need(new Set(services.map(v => v.scope_id)).size === services.length, 'Duplicate canonical service scope')
  const intent = plan?.foundation?.intent
  const foundation = intent === undefined ? null : validateProjectFoundation(intent)
  return {
    state: plan ? 'saved_decisions' : services.length ? 'existing_service_scope' : 'not_configured',
    revision: d.state?.revision ?? null, review_token: d.token, can_manage: d.can_manage,
    pipelines: plan ? [...plan.pipelines] : [], services,
    foundation: foundation ? { status: 'recorded_intent', intent: foundation, current_approval_verified: false } : { status: 'not_recorded', intent: null, current_approval_verified: false },
    provenance: { reader: 'get_project_setup', scope: 'authorized_canonical_project', execution_completion_inferred: false },
  }
}

/** Read-only canonical context shared by authorized chats; never reads a conversation. */
export function createProjectChatSharedContextRepository(client) {
  need(typeof client?.rpc === 'function', 'Authenticated canonical reader required')
  const stages = createProjectStagePlanRepository(client)
  return Object.freeze({
    async load(scope, { stageSelection = null, signal, timeoutMs } = {}) {
      exact(scope, ['organization_id', 'project_id', 'engagement_id'])
      need(uuid(scope.organization_id) && uuid(scope.project_id) && (scope.engagement_id === null || uuid(scope.engagement_id)), 'Exact project and optional engagement required')
      scope = structuredClone(scope); stageSelection = structuredClone(stageSelection)
      signal?.throwIfAborted()
      const linked = await connection(client, scope, signal)
      let query = client.rpc('get_project_setup', { p_organization_id: scope.organization_id, p_project_id: scope.project_id })
      if (signal && query.abortSignal) query = query.abortSignal(signal)
      const { data, error } = await query
      signal?.throwIfAborted()
      if (error) throw Object.assign(Error('Authorized shared project setup is unavailable'), { code: error.code, status: error.code === '42501' ? 403 : undefined })
      const decisions = setup(data, scope)
      let execution = { state: linked.engagement_connection.state, plan_id: null, stages: [], coverage: 'not_loaded', whole_project_completion_known: false }
      if (linked.engagement_connection.stage_read_eligible) {
        const s = { organizationId: scope.organization_id, projectId: scope.project_id, engagementId: linked.engagement_connection.resolved_engagement_id }
        const header = await stages.read(s, { signal, timeoutMs })
        const partitions = []
        if (stageSelection !== null) {
          exact(stageSelection, ['planId', 'groupId', 'partition'])
          need(header.state === 'available' && stageSelection.planId === header.plan_id, 'Review the current exact saved stage plan')
          partitions.push(await stages.readPartition(s, { ...stageSelection, signal, timeoutMs }))
        }
        const model = projectStagePlan(header, partitions)
        execution = { state: header.state, plan_id: header.plan_id, coverage: partitions.length ? 'selected_partition_only' : 'configuration_only', whole_project_completion_known: false,
          stages: model.tracks.flatMap(track => track.stages.map(stage => {
            const bindings = header.bindings.filter(b => b.phase === stage.id)
            const current = bindings.every(b => header.groups.some(g => g.id === b.group_id && g.publication_id === b.publication_id && g.configuration_current === true))
            return { phase: stage.id, configuration_current: current, configured: current && stage.configured, status: current ? stage.status : 'blocked', progress: current ? stage.progress : null, needs_update: !current || stage.needsUpdate, blocked_reason: current ? stage.blockedReason : 'Saved stage configuration is not verified current.', outputs: current ? stage.outputs : [], scope_label: stage.scopeLabel }
          })) }
      } else { need(stageSelection === null, 'Select an eligible exact engagement before loading stage evidence'); if (linked.engagement_connection.state === 'connected') execution.state = 'stage_read_unavailable' }
      signal?.throwIfAborted()
      return freeze({ version: 1, scope, ...linked, decisions, execution, changes_require_explicit_review: true, private_conversation_history_included: false, read_only: true })
    },
  })
}
