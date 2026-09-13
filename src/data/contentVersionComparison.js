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

function valueKind(value) {
  if (value === null) return 'Null'
  if (Array.isArray(value)) return 'Array'
  if (value === undefined) return 'Undefined'
  return `${typeof value}`.replace(/^./, character => character.toUpperCase())
}

function stableValue(value) {
  const kind = valueKind(value)
  if (value === undefined) return `${kind}\nNot recorded`
  if (typeof value === 'string') return `${kind}\n${JSON.stringify(value)}`
  return `${kind}\n${JSON.stringify(value, null, 2)}`
}

function valueIdentity(value) {
  return JSON.stringify([valueKind(value), value])
}

function pathIdentity(segments) {
  return JSON.stringify(segments)
}

function displayPath(segments) {
  if (!segments.length) return 'content'
  return segments.map((segment, index) => {
    if (segment.type === 'index') return `[${segment.value}]`
    if (/^[A-Za-z_$][\w$]*$/.test(segment.value)) return `${index ? '.' : ''}${segment.value}`
    return `[${JSON.stringify(segment.value)}]`
  }).join('')
}

function flatten(value, segments = [], output = new Map()) {
  if (Array.isArray(value)) {
    if (!value.length) output.set(pathIdentity(segments), { path: displayPath(segments), value })
    else value.forEach((item, index) => flatten(item, [...segments, { type: 'index', value: index }], output))
    return output
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value).sort(([left], [right]) => left.localeCompare(right))
    if (!entries.length) output.set(pathIdentity(segments), { path: displayPath(segments), value })
    else entries.forEach(([key, item]) => flatten(item, [...segments, { type: 'key', value: key }], output))
    return output
  }
  output.set(pathIdentity(segments), { path: displayPath(segments), value })
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
  const identities = [...new Set([...leftContent.keys(), ...rightContent.keys()])]
  const content = identities.map(identity => {
    const leftItem = leftContent.get(identity)
    const rightItem = rightContent.get(identity)
    const leftPresent = Boolean(leftItem)
    const rightPresent = Boolean(rightItem)
    const path = leftItem?.path || rightItem?.path || 'content'
    const leftValue = leftPresent ? stableValue(leftItem.value) : 'Not recorded'
    const rightValue = rightPresent ? stableValue(rightItem.value) : 'Not recorded'
    const typedRelationship = leftPresent && rightPresent
      ? (valueIdentity(leftItem.value) === valueIdentity(rightItem.value) ? 'same' : 'changed')
      : relationship(leftValue, rightValue, leftPresent, rightPresent)
    return { identity, path, leftValue, rightValue, relationship: typedRelationship }
  }).sort((left, right) => left.path.localeCompare(right.path) || left.identity.localeCompare(right.identity))
  const summary = { changed: 0, added: 0, removed: 0, same: 0 }
  content.forEach(item => { summary[item.relationship] += 1 })
  return { left, right, ready, metadata, content, summary }
}
