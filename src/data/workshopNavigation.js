export const WORK_RECORD_KINDS = Object.freeze(['project_task', 'engagement_work_item'])
export const WORKSHOP_DESTINATIONS = Object.freeze({
  content: '/sphere/content/studio',
  design: '/sphere/design/workshop',
  marketing: '/sphere/marketing/studio',
  development: '/sphere/delivery',
})
const ID_KEYS = {
  organizationId: 'ctxOrg', clientId: 'ctxClient', projectId: 'ctxProject',
  engagementId: 'ctxEngagement', brandId: 'ctxBrand',
  activeServiceId: 'ctxService', stageId: 'ctxStage',
}
const MESSAGES = {
  invalid_context: 'This Workshop link is incomplete. Choose work to continue safely.',
  invalid_work_record_kind: 'This link refers to an unsupported work-record type. Choose the original work again.',
  contradictory_legacy_context: 'This link contains conflicting old and new context. Choose work again to avoid opening the wrong record.',
  unsafe_origin: 'The saved return location is not an approved Workspace page.',
  cross_organization: 'This work belongs to a different organization. Your active organization was not changed.',
  context_mismatch: 'The saved Workshop context no longer matches the available work.',
  work_record_unavailable: 'The original work record is unavailable or you no longer have access to it.',
  access_denied: 'You do not have access to this Workshop context.',
  refresh_failed: 'Fresh data could not be loaded. The last verified data is shown as stale.',
  context_switched: 'The active work context changed. Pending confirmations were cleared before continuing.',
  load_failed: 'This Workshop context could not be loaded. Try again or return to Workspace.',
}
const clean = (value, max = 500) => typeof value === 'string' ? value.trim().slice(0, max) : ''
const entityId = value => clean(typeof value === 'object' && value ? value.id : value, 240)
const freezeRecord = value => value ? Object.freeze(value) : null
const actions = value => Object.freeze(Array.isArray(value)
  ? [...new Set(value.map(item => clean(item, 100)).filter(Boolean))] : [])
function permissions(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return Object.freeze({})
  return Object.freeze(Object.fromEntries(Object.entries(value)
    .filter(([key, allowed]) => clean(key, 100) && typeof allowed === 'boolean')
    .map(([key, allowed]) => [clean(key, 100), allowed])))
}
function pair(value) {
  if (!value) return null
  const normalized = { kind: clean(value.kind, 80), id: entityId(value.id) }
  return normalized.kind || normalized.id ? normalized : null
}
function safeOrigin(value) {
  const origin = clean(value, 1000)
  if (!origin || origin.includes('\\') || origin.startsWith('//')) return ''
  try {
    const url = new URL(origin, 'https://anka.invalid')
    return url.origin === 'https://anka.invalid' && /^\/sphere\/workspace(?:\/|$)/.test(url.pathname)
      ? url.pathname + url.search + url.hash : ''
  } catch {
    return ''
  }
}
function baseContext(input = {}) {
  const output = pair(input.output || { kind: input.outputKind, id: input.outputId })
  const versionId = entityId(input.versionId ?? input.output?.versionId)
  if (output && versionId) output.versionId = versionId
  return {
    organizationId: entityId(input.organizationId ?? input.organization),
    clientId: entityId(input.clientId ?? input.client),
    projectId: entityId(input.projectId ?? input.project),
    engagementId: entityId(input.engagementId ?? input.engagement),
    brandId: entityId(input.brandId ?? input.brand),
    activeServiceId: entityId(input.activeServiceId ?? input.serviceId ?? input.activeService),
    stageId: entityId(input.stageId ?? input.stage),
    origin: safeOrigin(input.origin), originTab: clean(input.originTab, 80),
    workRecord: freezeRecord(pair(input.workRecord || input.workItem ||
      { kind: input.recordKind, id: input.recordId })),
    output: freezeRecord(output),
    draft: freezeRecord(pair(input.draft || { kind: input.draftKind, id: input.draftId })),
    workshopTab: clean(input.workshopTab, 80),
    permissions: permissions(input.permissions), allowedActions: actions(input.allowedActions),
  }
}
function problem(context, partial = true) {
  if (context.workRecord && !WORK_RECORD_KINDS.includes(context.workRecord.kind)) return 'invalid_work_record_kind'
  if ([context.workRecord, context.output, context.draft].some(value => value && (!value.kind || !value.id))) return 'invalid_context'
  const scoped = context.clientId || context.projectId || context.engagementId || context.brandId ||
    context.activeServiceId || context.stageId || context.workRecord
  return scoped && !context.organizationId && !partial ? 'invalid_context' : null
}
export function createWorkshopNavigationContext(input = {}) {
  const context = baseContext(input)
  const reason = problem(context, false)
  if (reason) throw new TypeError(navigationRecoveryMessage(reason))
  if (clean(input.origin) && !context.origin) throw new TypeError(navigationRecoveryMessage('unsafe_origin'))
  return Object.freeze(context)
}
function params(value) {
  if (value instanceof URLSearchParams) return new URLSearchParams(value)
  if (typeof value === 'string') return new URLSearchParams(value.startsWith('?') ? value.slice(1) : value)
  return value && typeof value === 'object' ? new URLSearchParams(value) : new URLSearchParams()
}

const contradiction = (value, modern, legacy) =>
  value.has(modern) && value.has(legacy) && clean(value.get(modern)) !== clean(value.get(legacy))
const parsedInvalid = reason => Object.freeze({ ...baseContext(), status: 'invalid', reason })

export function parseWorkshopNavigation(searchParams) {
  const value = params(searchParams)
  if (contradiction(value, 'ctxEngagement', 'engagement') ||
      contradiction(value, 'ctxBrand', 'brand') ||
      contradiction(value, 'ctxWorkshopTab', 'tab')) return parsedInvalid('contradictory_legacy_context')
  const outputKind = clean(value.get('ctxOutputKind'), 80)
  const outputId = clean(value.get('ctxOutputId'), 240)
  const session = clean(value.get('session'), 240)
  const eventLink = clean(value.get('eventLink'), 240)
  if (session && ((outputKind && outputKind !== 'design_session') || (outputId && outputId !== session))) {
    return parsedInvalid('contradictory_legacy_context')
  }
  if (eventLink && ((outputKind && outputKind !== 'event_link') || (outputId && outputId !== eventLink))) {
    return parsedInvalid('contradictory_legacy_context')
  }
  if (session && eventLink) return parsedInvalid('contradictory_legacy_context')
  const origin = clean(value.get('ctxOrigin'), 1000)
  const context = baseContext({
    organizationId: value.get('ctxOrg'), clientId: value.get('ctxClient'),
    projectId: value.get('ctxProject'),
    engagementId: value.get('ctxEngagement') || value.get('engagement'),
    brandId: value.get('ctxBrand') || value.get('brand'),
    activeServiceId: value.get('ctxService'), stageId: value.get('ctxStage'),
    origin, originTab: value.get('ctxOriginTab'),
    recordKind: value.get('ctxRecordKind'), recordId: value.get('ctxRecordId'),
    outputKind: outputKind || (session ? 'design_session' : eventLink ? 'event_link' : ''),
    outputId: outputId || session || eventLink, versionId: value.get('ctxVersionId'),
    draftKind: value.get('ctxDraftKind'), draftId: value.get('ctxDraftId'),
    workshopTab: value.get('ctxWorkshopTab') || value.get('tab'),
  })
  if (origin && !context.origin) return parsedInvalid('unsafe_origin')
  const reason = problem(context)
  const populated = Object.values(ID_KEYS).some(key => value.has(key)) ||
    Boolean(context.workRecord || context.output || context.draft || context.origin)
  return Object.freeze({ ...context, status: reason ? 'invalid' : populated ? 'parsed' : 'empty', reason })
}

function writePair(value, prefix, item) {
  if (!item) return
  value.set(prefix + 'Kind', item.kind)
  value.set(prefix + 'Id', item.id)
}
function assertLegacyCompatible(value, context) {
  const checks = [['engagement', context.engagementId], ['brand', context.brandId], ['tab', context.workshopTab]]
  for (const [key, expected] of checks) {
    if (expected && value.has(key) && clean(value.get(key)) !== expected) {
      throw new TypeError(navigationRecoveryMessage('contradictory_legacy_context'))
    }
  }
  if (context.output?.kind === 'design_session' && value.has('session') &&
      clean(value.get('session')) !== context.output.id) {
    throw new TypeError(navigationRecoveryMessage('contradictory_legacy_context'))
  }
  if (context.output?.kind === 'event_link' && value.has('eventLink') &&
      clean(value.get('eventLink')) !== context.output.id) {
    throw new TypeError(navigationRecoveryMessage('contradictory_legacy_context'))
  }
}

export function appendWorkshopNavigation(path, contextInput, existingParams) {
  const context = createWorkshopNavigationContext(contextInput)
  const target = new URL(clean(path, 2000), 'https://anka.invalid')
  if (target.origin !== 'https://anka.invalid' || !target.pathname.startsWith('/sphere/')) {
    throw new TypeError('Workshop destination must be an internal Anka Sphere path')
  }
  for (const [key, item] of params(existingParams)) target.searchParams.set(key, item)
  assertLegacyCompatible(target.searchParams, context)
  for (const [field, key] of Object.entries(ID_KEYS)) {
    if (context[field]) target.searchParams.set(key, context[field])
  }
  if (context.origin) target.searchParams.set('ctxOrigin', context.origin)
  if (context.originTab) target.searchParams.set('ctxOriginTab', context.originTab)
  writePair(target.searchParams, 'ctxRecord', context.workRecord)
  writePair(target.searchParams, 'ctxOutput', context.output)
  if (context.output?.versionId) target.searchParams.set('ctxVersionId', context.output.versionId)
  writePair(target.searchParams, 'ctxDraft', context.draft)
  if (context.workshopTab) target.searchParams.set('ctxWorkshopTab', context.workshopTab)
  if (context.engagementId) target.searchParams.set('engagement', context.engagementId)
  if (context.brandId) target.searchParams.set('brand', context.brandId)
  if (context.workshopTab) target.searchParams.set('tab', context.workshopTab)
  if (context.output?.kind === 'design_session') target.searchParams.set('session', context.output.id)
  if (context.output?.kind === 'event_link') target.searchParams.set('eventLink', context.output.id)
  return target.pathname + target.search + target.hash
}

const resolvedId = (scope, field, alias) => entityId(scope?.[field] ?? scope?.[alias])
const outcome = (status, reason, context, extra = {}) =>
  Object.freeze({ status, reason: reason || null, context, stale: status === 'stale', ...extra })

export function validateWorkshopNavigation(contextInput, resolvedScope = {}) {
  const context = contextInput?.status ? contextInput
    : Object.freeze({ ...baseContext(contextInput), status: 'parsed', reason: null })
  if (context.status === 'invalid') return outcome('invalid', context.reason, null)
  if (resolvedScope.status === 'loading') return outcome('loading', null, context)
  if (resolvedScope.status === 'denied') return outcome('denied', 'access_denied', null)
  if (resolvedScope.contextChanged === true || resolvedScope.status === 'context_switch') {
    return outcome('context_switch', 'context_switched', null, {
      previousContext: context, preserveDraft: context.draft,
      clearTransient: true, invalidatePendingConfirmations: true,
    })
  }
  if (resolvedScope.status === 'error') {
    if (resolvedScope.lastGoodScope) {
      const lastGood = validateWorkshopNavigation(context, resolvedScope.lastGoodScope)
      if (lastGood.status === 'ready') {
        return outcome('stale', 'refresh_failed', lastGood.context, { error: resolvedScope.error || null })
      }
    }
    return outcome('error', 'load_failed', null, { error: resolvedScope.error || null })
  }
  if (resolvedScope.status === 'empty') return outcome('empty', null, context)

  const resolved = {
    organizationId: resolvedId(resolvedScope, 'organizationId', 'organization'),
    clientId: resolvedId(resolvedScope, 'clientId', 'client'),
    projectId: resolvedId(resolvedScope, 'projectId', 'project'),
    engagementId: resolvedId(resolvedScope, 'engagementId', 'engagement'),
    brandId: resolvedId(resolvedScope, 'brandId', 'brand'),
    activeServiceId: resolvedId(resolvedScope, 'activeServiceId', 'activeService'),
    stageId: resolvedId(resolvedScope, 'stageId', 'stage'),
  }
  const activeOrganizationId = resolvedId(resolvedScope, 'activeOrganizationId', 'activeOrganization') ||
    resolved.organizationId
  if (context.organizationId && !activeOrganizationId) {
    return outcome('stale', 'context_mismatch', null, { rejected: true, field: 'organizationId' })
  }
  if (context.organizationId && activeOrganizationId && context.organizationId !== activeOrganizationId) {
    return outcome('stale', 'cross_organization', null, { rejected: true })
  }
  if (resolved.organizationId && activeOrganizationId &&
      resolved.organizationId !== activeOrganizationId) {
    return outcome('stale', 'cross_organization', null, { rejected: true })
  }
  if (context.organizationId && resolved.organizationId &&
      context.organizationId !== resolved.organizationId) {
    return outcome('stale', 'cross_organization', null, { rejected: true })
  }
  for (const field of Object.keys(ID_KEYS)) {
    if (field !== 'organizationId' && context[field] && context[field] !== resolved[field]) {
      return outcome('stale', 'context_mismatch', null, { rejected: true, field })
    }
  }

  const resolvedWorkRecord = pair(resolvedScope.workRecord || resolvedScope.workItem)
  if (context.workRecord) {
    if (!resolvedWorkRecord || context.workRecord.kind !== resolvedWorkRecord.kind ||
        context.workRecord.id !== resolvedWorkRecord.id) {
      return outcome('stale', 'work_record_unavailable', null, { rejected: true })
    }
    const record = resolvedScope.workRecord || resolvedScope.workItem
    const recordOrganizationId = resolvedId(record, 'organizationId', 'organization')
    const recordProjectId = resolvedId(record, 'projectId', 'project')
    const recordEngagementId = resolvedId(record, 'engagementId', 'engagement')
    if (recordOrganizationId !== activeOrganizationId ||
        (context.projectId && context.projectId !== recordProjectId) ||
        (context.workRecord.kind === 'engagement_work_item' && context.engagementId &&
          recordEngagementId !== context.engagementId)) {
      return outcome('stale', 'work_record_unavailable', null, { rejected: true })
    }
  }
  for (const field of ['output', 'draft']) {
    if (!context[field]) continue
    const available = pair(resolvedScope[field])
    const versionMatches = field !== 'output' || !context.output.versionId ||
      entityId(resolvedScope.output?.versionId) === context.output.versionId
    if (!available || available.kind !== context[field].kind ||
        available.id !== context[field].id || !versionMatches) {
      return outcome('stale', 'context_mismatch', null, { rejected: true, field })
    }
  }

  const merged = Object.freeze({
    ...context,
    ...Object.fromEntries(Object.entries(resolved).map(([key, value]) => [key, value || context[key]])),
    workRecord: freezeRecord(resolvedWorkRecord || context.workRecord),
    permissions: permissions(resolvedScope.permissions),
    allowedActions: actions(resolvedScope.allowedActions),
    status: undefined, reason: undefined,
  })
  const stale = resolvedScope.status === 'stale'
  return outcome(stale ? 'stale' : 'ready', stale ? 'refresh_failed' : null, merged)
}

function returnContext(input) {
  if (!input) return baseContext()
  return 'context' in input ? input.context || baseContext() : input
}
export function workspaceReturnTarget(contextInput, { fallbackProjectId } = {}) {
  const context = returnContext(contextInput)
  const fallbackId = entityId(fallbackProjectId) || entityId(context?.projectId)
  const origin = safeOrigin(context?.origin)
  if (!origin) return fallbackId
    ? '/sphere/workspace/projects/' + encodeURIComponent(fallbackId) + '?tab=overview'
    : '/sphere/workspace'
  const target = new URL(origin, 'https://anka.invalid')
  if (context.originTab) target.searchParams.set('tab', context.originTab)
  for (const [field, key] of Object.entries(ID_KEYS)) {
    if (context[field]) target.searchParams.set(key, context[field])
  }
  writePair(target.searchParams, 'ctxRecord', context.workRecord)
  writePair(target.searchParams, 'ctxOutput', context.output)
  if (context.output?.versionId) target.searchParams.set('ctxVersionId', context.output.versionId)
  writePair(target.searchParams, 'ctxDraft', context.draft)
  return target.pathname + target.search + target.hash
}
export function navigationRecoveryMessage(reason) {
  return MESSAGES[reason] || MESSAGES.invalid_context
}
