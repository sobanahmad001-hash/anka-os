export function restrictArtifactTypes(profileTypes, allowedArtifactTypes) {
  if (allowedArtifactTypes === null || allowedArtifactTypes === undefined) return profileTypes
  if (!Array.isArray(allowedArtifactTypes)) return []
  return profileTypes.filter(type => allowedArtifactTypes.includes(type))
}
