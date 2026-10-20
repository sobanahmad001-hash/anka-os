const supported = new Map([
  ['csv', 'spreadsheet'], ['xlsx', 'spreadsheet'],
  ['pdf', 'document'], ['docx', 'document'], ['txt', 'document'], ['md', 'document'],
])
export function projectAttachmentRoute(file) {
  const extension = typeof file?.name === 'string' ? file.name.split('.').pop().toLowerCase() : ''
  const route = supported.get(extension)
  if (!route || !Number.isSafeInteger(file.size) || file.size < 1) throw new Error('Choose CSV, XLSX, PDF, DOCX, TXT or Markdown.')
  const limit = route === 'spreadsheet' ? 2 * 1024 * 1024 : extension === 'docx' ? 4 * 1024 * 1024 : 5 * 1024 * 1024
  if (file.size > limit) throw new Error(`This file exceeds the ${limit / 1024 / 1024} MiB limit.`)
  return route
}
