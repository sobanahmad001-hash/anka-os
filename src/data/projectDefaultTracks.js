// Draft compiler only. The authenticated server must resolve the canonical source
// packet and save/materialize through existing plan/work writers before execution.
export const DEFAULT_TRACK_VERSION = 1
const groups = new Set(['branding', 'website', 'marketing'])
const roles = ['written', 'visual']
const text = (value, max) => typeof value === 'string' && value.trim().length > 0 && value.length <= max
const exact = (left, right) => left.organization_id === right.organization_id && left.project_id === right.project_id && left.brand_id === right.brand_id

export function reviewFoundationSources(scope, selections = {}, approvedSources = []) {
  if (!scope?.organization_id || !scope.project_id || !scope.brand_id) throw Error('Exact project and brand context required')
  if (Object.keys(selections).some(role => !roles.includes(role))) throw Error('Unsupported foundation role')
  const pins = {}, gaps = []
  for (const role of roles) {
    const chosen = selections[role]
    if (!chosen) { gaps.push({role, reason: 'No reviewed guidance selected'}); continue }
    if (chosen.mode === 'minimum') {
      if (!text(chosen.guidance, 4000) || !text(chosen.reason, 1000)) throw Error('Review the minimum guidance and limited-scope reason')
      pins[role] = {mode: 'minimum', guidance: chosen.guidance.trim(), reason: chosen.reason.trim(), requires_explicit_review: true}
      continue
    }
    if (chosen.mode !== 'approved_version' || !chosen.artifact_id || !chosen.version_id || !/^[a-f0-9]{64}$/.test(chosen.checksum || '')) throw Error('Select an exact approved guideline version')
    const source = approvedSources.find(row => row.artifact_id === chosen.artifact_id && row.version_id === chosen.version_id)
    if (!source || !exact(source, scope) || source.checksum !== chosen.checksum || !source.approval_id || !source.approved_by || !source.approved_at || source.revoked || !(source.eligible_roles || [source.role]).includes(role)) throw Error('Exact approved guideline source is unavailable or changed')
    pins[role] = {mode: 'approved_version', artifact_id: source.artifact_id, version_id: source.version_id, checksum: source.checksum, approval_id: source.approval_id}
  }
  return {pins, gaps, sources_available: gaps.length === 0, requires_review: true, ready_for_preparation: false, ready_for_traffic: false}
}

export function validateDefaultTrackDag(stages) {
  if (!Array.isArray(stages) || stages.length > 100) throw Error('Bounded stage graph required')
  const byKey = new Map(stages.map(stage => [stage.key, stage]))
  if (byKey.size !== stages.length || stages.some(stage => !text(stage.key, 100) || !Array.isArray(stage.depends_on))) throw Error('Unique stage keys and explicit dependencies required')
  const seen = new Set(), active = new Set()
  function visit(key) {
    if (!byKey.has(key)) throw Error('Dependency references an unavailable stage')
    if (active.has(key)) throw Error('Stage dependency cycle')
    if (seen.has(key)) return
    active.add(key)
    for (const dependency of byKey.get(key).depends_on) visit(dependency)
    active.delete(key); seen.add(key)
  }
  for (const key of byKey.keys()) visit(key)
  return stages
}

export function draftProjectDefaultTracks({scope, items, foundation = {}, approvedSources = [], stageAssignments = []}) {
  if (!Array.isArray(items) || items.length === 0 || items.length > 50) throw Error('Review selected canonical service lines')
  const ids = new Set()
  for (const item of items) {
    if (!item.service_id || ids.has(item.service_id) || !groups.has(item.service_line?.service_group) || !Number.isSafeInteger(item.quantity) || item.quantity < 1) throw Error('One explicit valid contribution per canonical service')
    ids.add(item.service_id)
  }
  const reviewed = reviewFoundationSources(scope, foundation, approvedSources)
  const selected = [...groups].filter(group => items.some(item => item.service_line.service_group === group))
  const stages = []
  const add = (track, key, department, dependencies, output, kind = 'human') => stages.push({
    key, track, department, depends_on: dependencies, expected_output: output, kind,
    service_ids: [],
    execution: 'manual', requires_current_source_review: true,
  })
  add('shared', 'shared.brand_context', 'content', [], 'Exact written and visual guideline versions or reviewed limited-scope guidance', 'source_gate')
  if (selected.includes('branding')) {
    add('branding', 'branding.discovery', 'content', [], 'Brand discovery and reviewed gaps')
    add('branding', 'branding.written', 'content', ['branding.discovery'], 'Positioning, messaging and tone of voice')
    add('branding', 'branding.visual', 'design', ['branding.discovery'], 'Visual brand identity')
    add('branding', 'branding.reconcile', 'design', ['branding.written', 'branding.visual'], 'Coherent written and visual guideline set')
    add('branding', 'branding.review', 'design', ['branding.reconcile'], 'Exact-version guideline review', 'approval_gate')
    add('branding', 'branding.release', 'design', ['branding.review'], 'Approved guideline versions for explicit reuse', 'release_gate')
  }
  if (selected.includes('website')) {
    add('website', 'website.architecture', 'content', ['shared.brand_context'], 'Architecture and page inventory')
    add('website', 'website.search_intent', 'content', ['website.architecture'], 'Reviewed search intent; scoped keyword strategy where selected')
    add('website', 'website.content', 'content', ['website.search_intent'], 'Exact per-page copy versions')
    add('website', 'website.content_review', 'content', ['website.content'], 'Exact-version content review', 'approval_gate')
    add('website', 'website.design', 'design', ['website.content_review'], 'Responsive per-page design')
    add('website', 'website.build', 'development', ['website.design'], 'Native private page package')
    add('website', 'website.qa', 'development', ['website.build'], 'Current package QA evidence', 'approval_gate')
    add('website', 'website.staging', 'development', ['website.qa'], 'Authorized private staging preview', 'delivery_gate')
    add('website', 'website.publication', 'development', ['website.staging'], 'Separate exact-target publication authorization and receipt', 'publication_gate')
    add('website', 'website.traffic', 'development', ['website.publication'], 'Verified destination traffic-readiness evidence', 'evidence_gate')
  }
  if (selected.includes('marketing')) {
    add('marketing', 'marketing.research', 'marketing', ['shared.brand_context'], 'Objectives, audience and channel research')
    add('marketing', 'marketing.cycle_plan', 'marketing', ['marketing.research'], 'Reviewed channel/cycle plan')
    add('marketing', 'marketing.content', 'content', ['marketing.cycle_plan'], 'Exact copy versions')
    add('marketing', 'marketing.design', 'design', ['marketing.cycle_plan'], 'Exact creative versions')
    add('marketing', 'marketing.review', 'marketing', ['marketing.content', 'marketing.design'], 'Exact-version delivery review', 'approval_gate')
    add('marketing', 'marketing.destination', 'marketing', ['marketing.review'], 'Current destination readiness where visitor-driving delivery is scoped', 'evidence_gate')
    add('marketing', 'marketing.distribution', 'marketing', ['marketing.destination'], 'Separate authorized distribution receipt or explicit handover evidence', 'delivery_gate')
    add('marketing', 'marketing.measure', 'marketing', ['marketing.distribution'], 'Sourced period-specific measurements')
    add('marketing', 'marketing.optimize', 'marketing', ['marketing.measure'], 'Reviewed next work')
  }
  // Only explicit server-resolved catalogue mappings attach service scope to a
  // stage. A business-group label alone must never create a full website/brand.
  const assigned = new Set(), needed = new Set(), byKey = new Map(stages.map(stage => [stage.key, stage]))
  const include = key => { if (needed.has(key)) return; needed.add(key); for (const dependency of byKey.get(key).depends_on) include(dependency) }
  if (!Array.isArray(stageAssignments) || stageAssignments.length > items.length) throw Error('Bounded canonical stage mapping required')
  for (const mapping of stageAssignments) {
    const item = items.find(row => row.service_id === mapping.service_id)
    if (!item || assigned.has(item.service_id) || !Array.isArray(mapping.stage_keys) || !mapping.stage_keys.length || new Set(mapping.stage_keys).size !== mapping.stage_keys.length) throw Error('One explicit stage mapping per selected service')
    assigned.add(item.service_id)
    for (const key of mapping.stage_keys) {
      const stage = byKey.get(key)
      if (!stage || stage.track !== item.service_line.service_group) throw Error('Stage mapping differs from the exact service track')
      stage.service_ids.push(item.service_id); include(key)
    }
  }
  const unmapped = items.filter(item => !assigned.has(item.service_id)).map(item => ({service_id: item.service_id, reason: 'No reviewed canonical default-stage mapping'}))
  return {schema_version: DEFAULT_TRACK_VERSION, organization_id: scope.organization_id, project_id: scope.project_id, brand_id: scope.brand_id,
    status: 'proposal', requires_review: true, tracks: selected, contributions: structuredClone(items), foundation: reviewed,
    stages: validateDefaultTrackDag(stages.filter(stage => needed.has(stage.key))), unmapped_services: unmapped,
    creates_work: false, schedules_cycles: false, authorizes_publication: false, authorizes_paid_calls: false}
}
