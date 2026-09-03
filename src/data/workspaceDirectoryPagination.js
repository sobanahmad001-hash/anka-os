export const DIRECTORY_PAGE_SIZE = 500
const MAX_DIRECTORY_PAGES = 10000

export function directoryAbortError() {
  return Object.assign(new Error('Workspace directory request aborted'), { name: 'AbortError' })
}

export function directoryResponseRows(result, name) {
  if (result.error) throw Object.assign(new Error('Unable to load ' + name + ': ' + result.error.message), {
    cause: result.error,
    status: result.status || result.error.status || result.error.statusCode,
  })
  return result.data || []
}

export async function collectDirectoryPages(fetchPage, { name, signal, validate = () => true, key = (row) => row?.id, pageSize = DIRECTORY_PAGE_SIZE } = {}) {
  const byId = new Map()
  for (let page = 0; page < MAX_DIRECTORY_PAGES; page += 1) {
    if (signal?.aborted) throw directoryAbortError()
    const from = page * pageSize
    const rows = directoryResponseRows(await fetchPage(from, from + pageSize - 1), name)
    if (signal?.aborted) throw directoryAbortError()
    for (const row of rows) {
      const rowKey = key(row)
      if (!rowKey || !validate(row)) {
        throw Object.assign(new Error(name + ' returned a record outside the active organization scope.'), { status: 403, membershipMismatch: true })
      }
      const previous = byId.get(rowKey)
      if (previous && JSON.stringify(previous) !== JSON.stringify(row)) {
        throw Object.assign(new Error(name + ' changed while the directory was loading.'), { status: 409, membershipMismatch: true })
      }
      if (!previous) byId.set(rowKey, row)
    }
    if (rows.length < pageSize) return [...byId.values()]
  }
  throw Object.assign(new Error(name + ' exceeded the safe pagination limit.'), { status: 409 })
}
