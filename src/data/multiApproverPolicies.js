export function moveApprover(ids, userId, offset) {
  const index = ids.indexOf(userId)
  const target = index + offset
  if (index < 0 || target < 0 || target >= ids.length) return ids
  const next = [...ids]
  ;[next[index], next[target]] = [next[target], next[index]]
  return next
}
