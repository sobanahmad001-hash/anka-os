import { listFrames } from './frames.ts'

export class FigmaReadError extends Error {
  constructor(public status: number, message: string) {
    super(message)
  }
}

/** The caller supplies the file key from the authorized project binding. */
export async function readDesignFile(fileKey: string, token: string, fetcher = fetch) {
  if (!/^[A-Za-z0-9]{1,160}$/.test(fileKey)) throw new FigmaReadError(400, 'Invalid Figma file key.')
  const response = await fetcher('https://api.figma.com/v1/files/' + fileKey, {
    headers: { 'X-Figma-Token': token }, redirect: 'error',
  })
  if (response.status === 401 || response.status === 403) {
    throw new FigmaReadError(403, 'The connected Figma account cannot read this file. Check its token and file access.')
  }
  if (response.status === 404) throw new FigmaReadError(404, 'The selected Figma file is unavailable.')
  if (response.status === 429) throw new FigmaReadError(429, 'Figma rate limit reached. Try again later.')
  if (!response.ok) throw new FigmaReadError(502, 'Figma could not return the design file.')
  const file = await response.json()
  if (typeof file.version !== 'string' || !file.version || file.document?.type !== 'DOCUMENT') {
    throw new FigmaReadError(502, 'Figma returned an incomplete design file.')
  }
  return { fileKey, name: file.name, version: file.version, frames: listFrames(file.document) }
}
