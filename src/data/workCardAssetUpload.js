export async function uploadIdentity(file) {
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer())
  return Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2,'0')).join('')
}

export function duplicateUpload(error) {
  return Number(error?.statusCode ?? error?.status) === 409 || ['Duplicate','ResourceAlreadyExists'].includes(error?.error)
}
