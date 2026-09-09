const ORGANIZATION_SNAPSHOT_ROLES = new Set(['system_owner', 'operations_admin', 'executive'])

export function canPreserveReportsSnapshot({ membership, userId, projectOwnerId } = {}) {
  if (!membership || !userId) return false
  return ORGANIZATION_SNAPSHOT_ROLES.has(membership.role)
    || (membership.role === 'project_owner' && projectOwnerId === userId)
}

export async function runReportsSnapshotOperation({
  signal,
  isCurrent,
  preserve,
  refresh,
  onPreserved,
  onRefreshed,
  onError,
  onFinished,
}) {
  try {
    const snapshot = await preserve(signal)
    if (!isCurrent()) return
    onPreserved(snapshot)
    const workspace = await refresh(signal)
    if (!isCurrent()) return
    onRefreshed(workspace)
  } catch (error) {
    if (isCurrent()) onError(error)
  } finally {
    if (isCurrent()) onFinished()
  }
}
