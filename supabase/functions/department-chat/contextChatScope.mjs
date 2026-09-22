const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const DEPARTMENTS = new Set(['content', 'design', 'marketing'])
const KINDS = new Set(['organization', 'department_private', 'project_team'])

function value(input) {
  return typeof input === 'string' ? input.trim() : ''
}

export function validateContextChatScope(body) {
  const kind = value(body?.context_kind)
  const projectId = value(body?.project_id)
  const departmentId = value(body?.department_id)
  const engagementId = value(body?.engagement_id)
  if (!KINDS.has(kind) || engagementId) throw new Error('Unsupported conversation context')
  if (kind === 'organization' && (projectId || departmentId)) throw new Error('Organization conversation has no project or department')
  if (kind === 'department_private' && (projectId || !DEPARTMENTS.has(departmentId))) {
    throw new Error('Private Workshop conversation needs one supported department')
  }
  if (kind === 'project_team' && (!UUID.test(projectId) || departmentId)) {
    throw new Error('Project conversation needs one project')
  }
  return {
    context_kind: kind,
    project_id: kind === 'project_team' ? projectId : null,
    engagement_id: null,
    department_id: kind === 'department_private' ? departmentId : null,
  }
}

export function validateContextChatMessage(value) {
  if (typeof value !== 'string' || value.trim().length < 1 || value.trim().length > 8000) {
    throw new Error('Message must contain 1 to 8000 characters')
  }
  return value.trim()
}

export function isContextChatUuid(value) {
  return UUID.test(value)
}

export function validateContextChatListOffset(value) {
  const offset = value ?? 0
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > 1000000) {
    throw new Error('Conversation page offset is invalid')
  }
  return offset
}
