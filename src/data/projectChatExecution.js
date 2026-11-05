// Presentation/coordination only. Canonical repositories remain authoritative.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const HASH = /^[a-f0-9]{64}$/
const id = value => typeof value === 'string' && UUID.test(value)
const fields = ['organization_id', 'project_id', 'engagement_id', 'plan_id', 'group_id']
const phases = { 'website.content': 'content', 'website.design': 'design', 'website.build': 'development', 'website.qa': 'development' }
const sameScope = (a, b) => fields.slice(0, 3).every(key => a?.[key] === b?.[key])
const copy = value => structuredClone(value)

export function projectChatStageContext(context, scope) {
  if (context?.version !== 1 || !fields.every(key => id(context[key])) || !sameScope(context, scope)
    || !Object.hasOwn(phases, context.phase) || !HASH.test(context.context_sha256 || '')
    || !['website_page', 'engagement', 'campaign_asset', 'recurring_occurrence'].includes(context.partition?.kind)
    || !id(context.partition.id)) throw Error('Reload the exact selected project stage before proposing an action')
  return { version: 1, ...Object.fromEntries(fields.map(key => [key, context[key]])), phase: context.phase,
    partition: { kind: context.partition.kind, id: context.partition.id,
      ...(context.partition.architecture_version_id ? { architecture_version_id: context.partition.architecture_version_id } : {}) }, context_sha256: context.context_sha256 }
}

function exactOutput(output) {
  if (!id(output?.artifact_id) || !id(output?.artifact_version_id)
    || !Number.isSafeInteger(output.version_number) || output.version_number < 1
    || !HASH.test(output.content_checksum || '')) throw Error('An exact canonical output version and checksum are required')
  return { artifact_id: output.artifact_id, artifact_version_id: output.artifact_version_id,
    version_number: output.version_number, content_checksum: output.content_checksum }
}

// Attachments are references, never instructions to mutate project records.
export function proposeProjectChatAction({ context, scope, kind, work, output = null, attachments = [], stageEvidence }) {
  const stage = projectChatStageContext(context, scope)
  if (!stageEvidence || JSON.stringify(projectChatStageContext(stageEvidence.context, scope)) !== JSON.stringify(stage)
    || !stageEvidence.work?.some(item => item.work_item_id === work?.id)) throw Error('Refresh canonical Work evidence for the selected exact stage')
  if (!['prepare_content', 'review_output', 'handoff_design', 'handoff_build'].includes(kind)) throw Error('Unsupported project Chat action')
  if (!sameScope(work, stage) || !id(work.id) || !Number.isSafeInteger(work.row_version) || work.row_version < 1
    || work.archived_at || work.deleted_at) throw Error('Select current canonical Work in this project')
  const expectedPhase = { prepare_content: 'website.content', handoff_design: 'website.content', handoff_build: 'website.design' }[kind]
  if (expectedPhase && stage.phase !== expectedPhase) throw Error('Action does not match the selected stage')
  const source = output ? exactOutput(output) : null
  if (output && !sameScope(output, stage)) throw Error('Output belongs to another project context')
  const selectedOutput = source && stageEvidence.outputs?.find(item => item.artifact_id === source.artifact_id
    && item.artifact_version_id === source.artifact_version_id && item.content_checksum === source.content_checksum
    && item.version_number === source.version_number)
  if (source && !selectedOutput) throw Error('Output is not selected in the exact stage evidence')
  if (kind !== 'prepare_content' && !source) throw Error('Select the exact output version first')
  if (kind.startsWith('handoff_') && (!id(output.approval_id) || output.material_current !== true || output.needs_update !== false
    || selectedOutput.approved !== true || selectedOutput.material_current !== true || selectedOutput.needs_update !== false
    || selectedOutput.approval_id !== output.approval_id)) {
    throw Error('Review and approve the current exact output before handoff')
  }
  if (!Array.isArray(attachments) || attachments.length > 20 || attachments.some(a => !sameScope(a, stage) || !id(a.id) || a.ai_use_allowed !== true)) {
    throw Error('Use only eligible attachments explicitly selected in this project')
  }
  return { version: 1, status: 'proposed', kind, context: stage,
    department: kind === 'handoff_design' ? 'design' : kind === 'handoff_build' ? 'development' : phases[stage.phase],
    work: { id: work.id, row_version: work.row_version }, output: source,
    approval_id: kind.startsWith('handoff_') ? output.approval_id : null,
    attachment_ids: attachments.map(a => a.id), requires_confirmation: true, modifies_project_records: kind !== 'review_output' }
}

export function revalidateProjectChatAction(proposal, current) {
  const fresh = proposeProjectChatAction({ ...current, kind: proposal.kind })
  if (JSON.stringify(fresh) !== JSON.stringify(proposal)) throw Error('Project context changed; review a new proposal')
  return copy(fresh)
}

// No provider dispatch, retry, Work completion, or approval is inferred here.
export function projectChatActionResult(proposal, receipt) {
  if (!sameScope(receipt, proposal.context) || receipt.context_sha256 !== proposal.context.context_sha256
    || receipt.work_item_id !== proposal.work.id || !['recorded', 'pending', 'blocked', 'unknown'].includes(receipt.status)) {
    throw Error('Execution receipt does not match the proposed project action')
  }
  const output = receipt.output ? exactOutput(receipt.output) : null
  if (receipt.output && !sameScope(receipt.output, proposal.context)) throw Error('Returned output belongs to another project')
  if (receipt.status === 'recorded' && !output) throw Error('Recorded result requires its exact canonical output')
  return { status: receipt.status, context: copy(proposal.context), work_item_id: receipt.work_item_id, output,
    review: output ? { required: true, artifact_version_id: output.artifact_version_id } : null,
    next_action: receipt.status === 'unknown' ? 'check_existing_execution' : receipt.status === 'blocked' ? 'resolve_blocker'
      : output ? 'review_exact_output' : 'check_existing_execution', manual_path_available: true }
}
