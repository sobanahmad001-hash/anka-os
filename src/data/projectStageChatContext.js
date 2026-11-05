// Explicit metadata selection only. This adapter never reads asset bodies or sends Chat.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const HASH = /^[a-f0-9]{64}$/
const id = value => typeof value === 'string' && UUID.test(value)
const scopeKeys = ['organization_id', 'project_id', 'engagement_id']
const same = (a, b, keys) => keys.every(key => a?.[key] === b?.[key])
const partitionKeys = ['kind', 'id', 'architecture_version_id']

export function selectedProjectStageContext(selected, scope) {
  if (selected?.version !== 1 || !scopeKeys.every(key => id(scope?.[key]))
    || !same(selected, scope, scopeKeys) || !id(selected.plan_id) || !id(selected.group_id)
    || typeof selected.phase !== 'string' || !/^(branding|website|marketing)\.[a-z_]{1,40}$/.test(selected.phase)
    || !HASH.test(selected.context_sha256 || '') || !id(selected.partition?.id)
    || !['engagement', 'website_page', 'campaign_asset', 'recurring_occurrence'].includes(selected.partition.kind)
    || selected.partition.architecture_version_id != null && !id(selected.partition.architecture_version_id)) {
    throw Error('Select an exact stage in the current project')
  }
  return { version: 1, ...Object.fromEntries([...scopeKeys, 'plan_id', 'group_id', 'phase', 'context_sha256'].map(key => [key, selected[key]])),
    partition: Object.fromEntries(partitionKeys.filter(key => selected.partition[key] != null).map(key => [key, selected.partition[key]])) }
}

export function inspectProjectStageContext(selected, scope, header, unit, { versionIds = [] } = {}) {
  const context = selectedProjectStageContext(selected, scope)
  if (header?.state !== 'available' || !same(header, context, [...scopeKeys, 'plan_id'])
    || unit?.state !== 'current' || !same(unit, context, [...scopeKeys, 'plan_id', 'group_id', 'context_sha256'])
    || !same(unit.partition, context.partition, partitionKeys)) throw Error('Selected stage changed or is unavailable; reload before Send')
  const group = header.groups?.find(g => g.id === context.group_id)
  const bindings = header.bindings?.filter(b => b.group_id === context.group_id && b.phase === context.phase && b.publication_id === group?.publication_id) || []
  const steps = unit.steps?.filter(step => step.phase === context.phase && bindings.some(b => b.step_key === step.key)) || []
  if (!bindings.length || steps.length !== bindings.length || new Set(steps.map(s => s.key)).size !== steps.length
    || steps.some(s => !group?.steps?.some(g => g.key === s.key) || !Array.isArray(s.items) || s.items.length > 50)
    || !Array.isArray(versionIds) || versionIds.length > 20 || new Set(versionIds).size !== versionIds.length || versionIds.some(v => !id(v))) {
    throw Error('Exact bounded configured stage evidence required')
  }
  const items = steps.flatMap(s => s.items.map(item => ({ step_key: s.key, ...item })))
  if (items.length > 100 || items.some(i => i.work_item_id != null && !id(i.work_item_id))) throw Error('Stage context exceeds safe metadata bounds')
  const outputs = versionIds.map(versionId => {
    const matches = items.filter(i => i.output?.artifact_version_id === versionId)
    const output = matches[0]?.output
    if (!output || !id(output.artifact_id) || !HASH.test(output.content_checksum || '')
      || !Number.isSafeInteger(output.version_number) || output.version_number < 1
      || output.approval_id != null && !id(output.approval_id)
      || matches.some(i => i.output.artifact_id !== output.artifact_id || i.output.content_checksum !== output.content_checksum || i.output.version_number !== output.version_number
        || (i.output.approval_id ?? null) !== (output.approval_id ?? null) || i.output_approved === true && !id(i.output.approval_id))) {
      throw Error('Selected exact output is unavailable in this stage')
    }
    return { artifact_id: output.artifact_id, artifact_version_id: versionId, version_number: output.version_number,
      content_checksum: output.content_checksum, approval_id: output.approval_id ?? null, ai_use_allowed: output.ai_use_allowed === true,
      approved: matches.every(i => i.output_approved === true), material_current: matches.every(i => i.material_current === true),
      needs_update: matches.some(i => i.needs_update === true) }
  })
  return { context, work: items.map(i => ({ step_key: i.step_key, instance: i.instance, work_item_id: i.work_item_id,
    status: ['not_started', 'in_progress', 'in_review', 'review', 'blocked', 'done'].includes(i.work_status) ? i.work_status : null })),
    outputs, body_included: false, attachments_included: false }
}

export function createProjectStageChatContextAdapter({ readHeader, readPartition }) {
  return Object.freeze({
    async beforeSend({ text, selected, scope, versionIds = [] }, { signal } = {}) {
      if (typeof text !== 'string' || !text.trim() || text.length > 8000) throw Error('Enter a message up to 8000 characters')
      const context = selectedProjectStageContext(selected, scope)
      signal?.throwIfAborted()
      const header = await readHeader(scope, { signal })
      signal?.throwIfAborted()
      const unit = await readPartition(scope, { plan_id: context.plan_id, group_id: context.group_id, partition: context.partition }, { signal })
      signal?.throwIfAborted()
      // Human text stays byte-for-byte separate from structured metadata.
      return { text, stage: inspectProjectStageContext(context, scope, header, unit, { versionIds }) }
    },
  })
}

// Bridge to the canonical stage repository without changing its owned API.
export function createRepositoryProjectStageChatContextAdapter(repository) {
  if (typeof repository?.read !== 'function' || typeof repository?.refreshSelection !== 'function') {
    throw Error('Canonical stage-plan repository required')
  }
  return Object.freeze({
    async beforeSend({ text, selected, scope, versionIds = [] }, { signal, timeoutMs } = {}) {
      const dtoScope = { organization_id: scope?.organizationId, project_id: scope?.projectId, engagement_id: scope?.engagementId }
      const context = selectedProjectStageContext(selected, dtoScope)
      const adapter = createProjectStageChatContextAdapter({
        readHeader: (_scope, options) => repository.read(scope, { ...options, timeoutMs }),
        readPartition: (_scope, _selection, options) => repository.refreshSelection(scope, context, { ...options, timeoutMs }),
      })
      return adapter.beforeSend({ text, selected: context, scope: dtoScope, versionIds }, { signal })
    },
  })
}
