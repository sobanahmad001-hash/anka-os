import { recordedSourceReferences } from './contentLibrary.js'

const clean = value => typeof value === 'string' ? value.trim() : ''
const array = value => Array.isArray(value) ? value : []

function defaultSelection(versions, preferredVersionId = '') {
  const available = array(versions)
  const preferred = available.find(version => version.id === clean(preferredVersionId)) || available[0] || null
  const other = available.find(version => version.id !== preferred?.id) || null
  return { leftVersionId: other?.id || '', rightVersionId: preferred?.id || '' }
}

export function initialContentVersionComparisonState(contextKey = '', versions = [], preferredVersionId = '') {
  return { contextKey: clean(contextKey), ...defaultSelection(versions, preferredVersionId) }
}

export function contentVersionComparisonReducer(state, action) {
  if (action.type === 'sync_context') {
    const contextKey = clean(action.contextKey)
    const ids = new Set(array(action.versions).map(version => clean(version.id)).filter(Boolean))
    if (contextKey !== state.contextKey) {
      return initialContentVersionComparisonState(contextKey, action.versions, action.preferredVersionId)
    }
    const leftVersionId = ids.has(state.leftVersionId) ? state.leftVersionId : ''
    const rightVersionId = ids.has(state.rightVersionId) ? state.rightVersionId : ''
    if (leftVersionId && rightVersionId && leftVersionId === rightVersionId) {
      return { ...state, leftVersionId: '' }
    }
    return { ...state, leftVersionId, rightVersionId }
  }
  if (action.type === 'clear_all') return { ...state, leftVersionId: '', rightVersionId: '' }
  if (action.type === 'clear_slot' && ['left', 'right'].includes(action.slot)) {
    return { ...state, [action.slot === 'left' ? 'leftVersionId' : 'rightVersionId']: '' }
  }
  if (action.type === 'select_slot' && ['left', 'right'].includes(action.slot)) {
    const versionId = clean(action.versionId)
    const selectedKey = action.slot === 'left' ? 'leftVersionId' : 'rightVersionId'
    const otherKey = action.slot === 'left' ? 'rightVersionId' : 'leftVersionId'
    return { ...state, [selectedKey]: versionId, ...(versionId && versionId === state[otherKey] ? { [otherKey]: '' } : {}) }
  }
  return state
}

function stableValue(value) {
  if (typeof value === 'string') return value
  if (value === undefined) return 'Not recorded'
  return JSON.stringify(value, null, 2)
}

function flatten(value, path = '', output = new Map()) {
  if (Array.isArray(value)) {
    if (!value.length) output.set(path || 'content', '[]')
    else value.forEach((item, index) => flatten(item, `${path}[${index}]`, output))
    return output
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value).sort(([left], [right]) => left.localeCompare(right))
    if (!entries.length) output.set(path || 'content', '{}')
    else entries.forEach(([key, item]) => flatten(item, path ? `${path}.${key}` : key, output))
    return output
  }
  output.set(path || 'content', stableValue(value))
  return output
}

function relationship(leftValue, rightValue, leftPresent = true, rightPresent = true) {
  if (!leftPresent) return 'added'
  if (!rightPresent) return 'removed'
  return leftValue === rightValue ? 'same' : 'changed'
}

function sourceSummary(version) {
  const references = recordedSourceReferences(version?.content)
  return references.length ? references.map(item => `${item.path} = ${item.id}`).sort().join('\n') : 'No recorded source versions'
}

const METADATA = Object.freeze([
  ['version_id', 'Version ID', version => version.id],
  ['version_number', 'Version number', version => String(version.version_number)],
  ['created_at', 'Created', version => clean(version.created_at) || 'Not recorded'],
  ['content_checksum', 'Content checksum', version => clean(version.content_checksum) || 'Not recorded'],
  ['change_summary', 'Change summary', version => clean(version.change_summary) || 'No summary recorded'],
  ['data_classification', 'Classification', version => clean(version.data_classification) || 'Not recorded'],
  ['ai_use_allowed', 'AI use allowed', version => version.ai_use_allowed === true ? 'Yes' : 'No'],
  ['sources', 'Recorded source versions', sourceSummary],
])

export function contentVersionComparisonModel(versions, state) {
  const available = array(versions)
  const left = available.find(version => version.id === clean(state?.leftVersionId)) || null
  const right = available.find(version => version.id === clean(state?.rightVersionId)) || null
  const sameArtifact = Boolean(left && right && left.artifact_id && left.artifact_id === right.artifact_id)
  const ready = Boolean(sameArtifact && left.id !== right.id)
  if (!ready) return { left, right, ready: false, metadata: [], content: [], summary: { changed: 0, added: 0, removed: 0, same: 0 } }

  const metadata = METADATA.map(([key, label, read]) => {
    const leftValue = read(left)
    const rightValue = read(right)
    return { key, label, leftValue, rightValue, relationship: relationship(leftValue, rightValue) }
  })
  const leftContent = flatten(left.content)
  const rightContent = flatten(right.content)
  const paths = [...new Set([...leftContent.keys(), ...rightContent.keys()])].sort()
  const content = paths.map(path => {
    const leftPresent = leftContent.has(path)
    const rightPresent = rightContent.has(path)
    const leftValue = leftPresent ? leftContent.get(path) : 'Not recorded'
    const rightValue = rightPresent ? rightContent.get(path) : 'Not recorded'
    return { path, leftValue, rightValue, relationship: relationship(leftValue, rightValue, leftPresent, rightPresent) }
  })
  const summary = { changed: 0, added: 0, removed: 0, same: 0 }
  content.forEach(item => { summary[item.relationship] += 1 })
  return { left, right, ready, metadata, content, summary }
}
