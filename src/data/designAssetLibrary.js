const DATE_WINDOWS = Object.freeze({ day: 1, week: 7, month: 30 })

const array = value => Array.isArray(value) ? value : []
const clean = value => typeof value === 'string' ? value.trim() : ''

export const DESIGN_ASSET_LIBRARY_INITIAL_FILTERS = Object.freeze({ status: 'all', source: 'all', date: 'all' })

export function initialDesignAssetLibraryState(contextKey = '') {
  return { contextKey: clean(contextKey), view: 'grid', filters: { ...DESIGN_ASSET_LIBRARY_INITIAL_FILTERS }, selectedAssetId: '' }
}

export function designAssetLibraryContextKey(context = {}) {
  const work = context.workRecord || {}
  const output = context.output || {}
  const draft = context.draft || {}
  return [
    context.contextKey,
    context.activeOrganizationId || context.organizationId,
    context.projectId,
    context.engagementId,
    context.brandId,
    context.activeServiceId,
    context.stageId,
    work.kind,
    work.id,
    output.kind,
    output.id,
    output.versionId,
    draft.kind,
    draft.id,
  ].map(clean).join('|')
}

export function designAssetLibraryReducer(state, action) {
  if (action.type === 'context_changed') {
    const contextKey = clean(action.contextKey)
    return contextKey === state.contextKey ? state : initialDesignAssetLibraryState(contextKey)
  }
  if (action.type === 'set_view' && ['grid', 'list'].includes(action.view)) return { ...state, view: action.view }
  if (action.type === 'set_filter' && ['status', 'source', 'date'].includes(action.name)) {
    return { ...state, filters: { ...state.filters, [action.name]: clean(action.value) || 'all' } }
  }
  if (action.type === 'select') return { ...state, selectedAssetId: clean(action.assetId) }
  if (action.type === 'close_detail') return { ...state, selectedAssetId: '' }
  if (action.type === 'reset_filters') return { ...state, filters: { ...DESIGN_ASSET_LIBRARY_INITIAL_FILTERS } }
  return state
}

export function buildDesignAssetRows(workspace = {}) {
  const directionVersions = [...array(workspace.directionVersions), ...array(workspace.experimentalDirectionVersions)]
  const versionById = new Map(directionVersions.map(item => [item.id, item]))
  const directionById = new Map(array(workspace.directions).map(item => [item.id, item]))
  const sessionById = new Map(array(workspace.sessions).map(item => [item.id, item]))
  const modelById = new Map(array(workspace.models).map(item => [item.id, item]))
  const jobByAssetId = new Map(array(workspace.imageGenerationJobs).filter(item => item.media_asset_id).map(item => [item.media_asset_id, item]))
  const variantByAssetId = new Map(array(workspace.variants).filter(item => item.design_media_asset_id).map(item => [item.design_media_asset_id, item]))

  return array(workspace.mediaAssets).map(asset => {
    const version = versionById.get(asset.design_direction_version_id) || null
    const direction = version ? directionById.get(version.direction_id) || null : null
    const session = direction ? sessionById.get(direction.session_id) || null : null
    const job = jobByAssetId.get(asset.id) || null
    const variant = variantByAssetId.get(asset.id) || null
    const modelId = clean(job?.model_registry_id || asset.model_registry_id)
    const model = modelById.get(modelId) || null
    return {
      id: clean(asset.id), mediaType: clean(asset.media_type) || 'unknown', status: clean(asset.status) || 'unknown',
      createdAt: clean(asset.created_at), prompt: clean(asset.prompt), previewUrl: clean(asset.signed_url),
      sourceType: variant ? 'variant' : job ? 'generated' : 'recorded', recordedVariantFormat: clean(variant?.variant_format),
      jobId: clean(job?.id), jobStatus: clean(job?.status), modelId, modelName: clean(model?.display_name),
      directionVersionId: clean(version?.id || asset.design_direction_version_id),
      directionVersionNumber: Number.isInteger(version?.version_number) ? version.version_number : null,
      directionId: clean(direction?.id), directionTitle: clean(version?.content?.title), sessionId: clean(session?.id),
      sessionLabel: clean(session?.output_goal || session?.page_slug || session?.output_family), isExperimental: version?.is_experimental === true,
      recorded: Object.freeze({ dimensions: null, mimeType: null, name: null, reviewState: null, independentVersion: null }),
    }
  }).sort((left, right) => Date.parse(right.createdAt || 0) - Date.parse(left.createdAt || 0) || left.id.localeCompare(right.id))
}

export function filterDesignAssetRows(rows, filters = {}, now = Date.now()) {
  const status = clean(filters.status) || 'all'
  const source = clean(filters.source) || 'all'
  const date = clean(filters.date) || 'all'
  const days = DATE_WINDOWS[date]
  const cutoff = days ? now - (days * 24 * 60 * 60 * 1000) : null
  return array(rows).filter(row => {
    if (status !== 'all' && row.status !== status) return false
    if (source !== 'all' && row.sourceType !== source) return false
    if (cutoff !== null) {
      const created = Date.parse(row.createdAt)
      if (!Number.isFinite(created) || created < cutoff || created > now) return false
    }
    return true
  })
}

export function designAssetAccessState(row, { issuedAt, expiresInSeconds, trustedOrigin, now = Date.now() } = {}) {
  if (!row || row.mediaType !== 'image' || row.status !== 'ready') {
    return { status: 'unavailable', canOpen: false, message: 'Only ready images can be opened from the asset library.' }
  }
  if (!row.previewUrl) {
    return { status: 'missing', canOpen: false, message: 'No signed image link is available. Refresh the Workshop to request a new link.' }
  }
  let signedUrl
  try {
    signedUrl = new URL(row.previewUrl)
  } catch {
    return { status: 'invalid', canOpen: false, message: 'The signed image link is invalid. Refresh the Workshop to request a new link.' }
  }
  const trusted = clean(trustedOrigin)
  const validSignedUrl = signedUrl.protocol === 'https:' && signedUrl.origin === trusted &&
    !signedUrl.username && !signedUrl.password && !signedUrl.hash &&
    signedUrl.pathname.includes('/storage/v1/object/sign/') && Boolean(clean(signedUrl.searchParams.get('token')))
  if (!validSignedUrl) {
    return { status: 'invalid', canOpen: false, message: 'The signed image link is invalid. Refresh the Workshop to request a new link.' }
  }
  const issued = Number(issuedAt)
  const seconds = Number(expiresInSeconds)
  const conservativeSeconds = Number.isFinite(seconds) ? Math.max(0, seconds - 5) : 0
  if (!Number.isFinite(issued) || issued <= 0 || issued > now || conservativeSeconds === 0 || now >= issued + (conservativeSeconds * 1000)) {
    return { status: 'expired', canOpen: false, message: 'This signed image link has expired. Refresh the Workshop to renew it without regenerating.' }
  }
  return { status: 'ready', canOpen: true, url: signedUrl.href, expiresAt: issued + (conservativeSeconds * 1000), message: 'The signed link is temporary. Your browser may display the image instead of downloading it.' }
}

export function designAssetSourceFocus(row) {
  if (!row?.sessionId || !row?.directionVersionId) return null
  return { sessionId: row.sessionId, directionVersionId: row.directionVersionId, jobId: row.jobId || '' }
}
