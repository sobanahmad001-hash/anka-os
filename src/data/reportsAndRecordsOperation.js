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
