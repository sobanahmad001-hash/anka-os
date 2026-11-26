export function consentSuccessor(artifact, version, latestId, allowed) {
  if (allowed !== true || !artifact?.id || version?.artifact_id !== artifact.id || version.id !== latestId
    || artifact.artifact_type !== 'content' || version.content?.schema_version !== 2
    || version.data_classification === 'restricted' || version.ai_use_allowed === true) {
    throw new Error('Select the latest unrestricted writer version and explicitly allow AI use.')
  }
  return {
    engagement_id: artifact.engagement_id, artifact_id: artifact.id, artifact_type: 'content',
    engagement_stage_instance_id: artifact.engagement_stage_instance_id || null,
    expected_parent_version_id: version.id, title: artifact.title,
    content: structuredClone(version.content), data_classification: version.data_classification,
    ai_use_allowed: true,
    change_summary: `Explicit AI consent; identical content and source provenance from version ${version.id} (${version.content_checksum}). Approval required for this new version.`,
  }
}
