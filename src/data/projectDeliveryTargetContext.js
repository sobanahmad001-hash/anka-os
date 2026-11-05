import {uuid, stagingOrigin} from '../../supabase/functions/_shared/websiteStagingContracts.js'

export function deliveryScope(scope) {
  if (!scope || ['organizationId', 'projectId', 'engagementId'].some(key => !uuid(scope[key]))) throw Error('Exact project delivery context required')
  return {organization_id: scope.organizationId, project_id: scope.projectId, engagement_id: scope.engagementId}
}
export function sameDeliveryScope(row, scope) {
  const expected = deliveryScope(scope)
  return Object.keys(expected).every(key => row?.[key] === expected[key])
}
export function freezeDelivery(value) {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freezeDelivery)
    Object.freeze(value)
  }
  return value
}

// Presentation contract only. Server-side project permissions and dispatch remain authoritative.
// An organization account alone is never a destination or a project binding.
export function projectDeliveryTargetContext(scope, workspace, {targetId = null} = {}) {
  if (!sameDeliveryScope(workspace, scope) || !Array.isArray(workspace.targets)) throw Error('Destination workspace belongs to another project')
  if (targetId !== null && !uuid(targetId)) throw Error('Exact selected target required')
  const choices = []
  for (const target of workspace.targets) {
    if (!sameDeliveryScope(target, scope)) throw Error('Destination binding belongs to another project')
    if (target.current !== true) continue
    if (!uuid(target.id) || !uuid(target.connection_id) || !uuid(target.site_id) || !Number.isInteger(target.version_number) || target.version_number < 1 || !Number.isFinite(Date.parse(target.connection_revision))) throw Error('Verified exact destination binding required')
    if (stagingOrigin(target.base_url) !== target.base_url) throw Error('Canonical staging destination required')
    choices.push({...deliveryScope(scope), provider: 'wordpress', environment: 'staging', published: false,
      target_id: target.id, connection_id: target.connection_id, connection_revision: target.connection_revision,
      site_id: target.site_id, base_url: target.base_url, binding_version: target.version_number})
  }
  if (new Set(choices.map(choice => choice.target_id)).size !== choices.length) throw Error('Duplicate destination identity')
  const destination = choices.find(choice => choice.target_id === targetId)
  return freezeDelivery({state: destination ? 'ready' : targetId ? 'destination_unavailable' : choices.length ? 'needs_destination' : 'needs_project_binding',
    destination: destination || null, choices, has_more: workspace.has_more === true,
    next_action: destination ? 'review_exact_package' : targetId ? 'select_current_project_destination' : choices.length ? 'select_exact_destination' : 'review_project_connection_binding'})
}
