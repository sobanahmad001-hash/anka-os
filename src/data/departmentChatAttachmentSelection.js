export const DEPARTMENT_CHAT_ATTACHMENT_LIMITS = Object.freeze({
  filesPerSelection: 3,
  fileBytes: 5 * 1024 * 1024,
  docxBytes: 4 * 1024 * 1024,
})

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'

export function departmentChatAttachmentMime(file) {
  if (file?.type) return String(file.type).toLowerCase()
  const extension = String(file?.name || '').toLowerCase().split('.').pop()
  return {
    txt: 'text/plain', md: 'text/markdown', docx: DOCX_MIME,
    png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
  }[extension] || ''
}

export function validateDepartmentChatAttachmentFile(file) {
  const claimedMime = departmentChatAttachmentMime(file)
  if (!claimedMime) throw new Error(`${file?.name || 'File'}: file type could not be verified.`)
  const byteLimit = claimedMime === DOCX_MIME
    ? DEPARTMENT_CHAT_ATTACHMENT_LIMITS.docxBytes
    : DEPARTMENT_CHAT_ATTACHMENT_LIMITS.fileBytes
  const limitLabel = claimedMime === DOCX_MIME ? '4 MiB DOCX' : '5 MiB'
  if (!Number.isFinite(file?.size) || file.size < 0 || file.size > byteLimit) {
    throw new Error(`${file?.name || 'File'}: file exceeds the ${limitLabel} limit.`)
  }
  return claimedMime
}

export function selectPendingDepartmentChatAttachments(fileList) {
  const files = Array.from(fileList || [])
  if (files.length > DEPARTMENT_CHAT_ATTACHMENT_LIMITS.filesPerSelection) {
    return { files: [], error: 'Choose no more than three files. No files were selected.' }
  }
  try {
    for (const file of files) validateDepartmentChatAttachmentFile(file)
    return { files, error: '' }
  } catch (error) {
    return { files: [], error: error.message || 'Attachment selection is invalid.' }
  }
}
