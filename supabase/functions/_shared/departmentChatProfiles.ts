import profileData from './departmentChatProfiles.json' with { type: 'json' }

type DepartmentChatProfile = {
  id: string
  label: string
  mount: string
  artifactTypes: readonly string[]
  contextArtifactTypes: readonly string[]
  workItemTypes: readonly string[]
}

function strings(value: unknown, field: string) {
  if (!Array.isArray(value) || !value.length || value.some(item => typeof item !== 'string' || !item.trim())) {
    throw new Error(`Invalid Department Chat profile ${field}`)
  }
  return Object.freeze([...new Set(value.map(item => item.trim()))])
}

const workItemTypes = strings(profileData.work_item_types, 'work_item_types')

export const DEPARTMENT_CHAT_PROFILE_VERSION = String(profileData.version)
export const DEPARTMENT_CHAT_DEPARTMENT_IDS = Object.freeze(Object.keys(profileData.departments))

export function departmentChatProfile(departmentId: string): DepartmentChatProfile {
  const source = profileData.departments[departmentId as keyof typeof profileData.departments]
  if (!source) throw Object.assign(new Error('Unsupported Department Chat department'), { status: 400 })
  return Object.freeze({
    id: departmentId,
    label: source.label,
    mount: source.mount,
    artifactTypes: strings(source.artifact_types, `${departmentId}.artifact_types`),
    contextArtifactTypes: strings(source.context_artifact_types, `${departmentId}.context_artifact_types`),
    workItemTypes,
  })
}
