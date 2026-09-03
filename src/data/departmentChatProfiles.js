import profileData from '../../supabase/functions/_shared/departmentChatProfiles.json' with { type: 'json' }

function freezeProfile(id, source) {
  if (!source) throw new Error('Unsupported Department Chat department')
  return Object.freeze({
    id,
    label: source.label,
    mount: source.mount,
    artifactTypes: Object.freeze([...source.artifact_types]),
    contextArtifactTypes: Object.freeze([...source.context_artifact_types]),
    workItemTypes: Object.freeze([...profileData.work_item_types]),
  })
}

export const DEPARTMENT_CHAT_PROFILE_VERSION = profileData.version
export const DEPARTMENT_CHAT_PROFILES = Object.freeze(Object.fromEntries(
  Object.entries(profileData.departments).map(([id, source]) => [id, freezeProfile(id, source)]),
))

export function departmentChatProfile(departmentId) {
  const profile = DEPARTMENT_CHAT_PROFILES[departmentId]
  if (!profile) throw new Error('Unsupported Department Chat department')
  return profile
}
