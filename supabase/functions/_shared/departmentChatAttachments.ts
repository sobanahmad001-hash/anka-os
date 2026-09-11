import { inflateSync } from 'npm:fflate@0.8.2'

export const ATTACHMENT_LIMITS = Object.freeze({
  filesPerTurn: 3, fileBytes: 5 * 1024 * 1024, docxBytes: 4 * 1024 * 1024,
  zipEntries: 256, zipExpandedBytes: 16 * 1024 * 1024, docxXmlBytes: 8 * 1024 * 1024,
  zipExpansionRatio: 30, textCharacters: 16_000, turnCharacters: 24_000,
  imageDimension: 4096, imagePixels: 16_000_000,
})

export const ATTACHMENT_MIME_TYPES = Object.freeze([
  'text/plain', 'text/markdown',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'image/png', 'image/jpeg',
])

export type AttachmentInspection = {
  verifiedMime: string
  extractionKind: 'plain_text' | 'main_document_text' | 'reference_only'
  extractedText: string | null
  extractionNotice: string
  width?: number
  height?: number
}

const invalid = (message: string) => Object.assign(new Error(message), { status: 422 })
const le16 = (b: Uint8Array, o: number) => b[o] | b[o + 1] << 8
const le32 = (b: Uint8Array, o: number) => (b[o] | b[o + 1] << 8 | b[o + 2] << 16 | b[o + 3] << 24) >>> 0
const be32 = (b: Uint8Array, o: number) => (b[o] * 0x1000000 + (b[o + 1] << 16) + (b[o + 2] << 8) + b[o + 3]) >>> 0

function utf8(bytes: Uint8Array) {
  let value = ''
  try { value = new TextDecoder('utf-8', { fatal: true }).decode(bytes) } catch { throw invalid('The file is not valid UTF-8 text.') }
  if (value.includes('\0') || /[\u0001-\u0008\u000B\u000C\u000E-\u001F]/.test(value)) {
    throw invalid('The file contains binary or unsupported control characters.')
  }
  return value.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n')
}

function checkedText(value: string) {
  if (value.length > ATTACHMENT_LIMITS.textCharacters) {
    throw invalid(`Extracted text exceeds ${ATTACHMENT_LIMITS.textCharacters} characters; the file was not truncated.`)
  }
  if (!value.trim()) throw invalid('The attachment contains no extractable text.')
  return value
}

function crc32(bytes: Uint8Array) {
  let crc = 0xffffffff
  for (const byte of bytes) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1))
  }
  return (crc ^ 0xffffffff) >>> 0
}

function dimensions(width: number, height: number) {
  if (!width || !height || width > ATTACHMENT_LIMITS.imageDimension || height > ATTACHMENT_LIMITS.imageDimension
      || width * height > ATTACHMENT_LIMITS.imagePixels) {
    throw invalid('Image dimensions exceed safe bounds or are invalid.')
  }
}

function png(bytes: Uint8Array): AttachmentInspection {
  const signature = [137, 80, 78, 71, 13, 10, 26, 10]
  if (bytes.length < 45 || signature.some((value, index) => bytes[index] !== value)) throw invalid('PNG signature is invalid.')
  let offset = 8; let count = 0; let width = 0; let height = 0; let colorType = -1
  let idat = false; let idatEnded = false; let palette = false; let iend = false
  while (offset < bytes.length) {
    if (++count > 4096 || offset + 12 > bytes.length) throw invalid('PNG structure is malformed.')
    const length = be32(bytes, offset)
    if (length > ATTACHMENT_LIMITS.fileBytes || offset + 12 + length > bytes.length) throw invalid('PNG chunk bounds are invalid.')
    const typeBytes = bytes.subarray(offset + 4, offset + 8)
    const type = String.fromCharCode(...typeBytes)
    const data = bytes.subarray(offset + 8, offset + 8 + length)
    const crcInput = new Uint8Array(length + 4); crcInput.set(typeBytes); crcInput.set(data, 4)
    if (crc32(crcInput) !== be32(bytes, offset + 8 + length)) throw invalid('PNG checksum is invalid.')
    if (count === 1) {
      if (type !== 'IHDR' || length !== 13) throw invalid('PNG IHDR is invalid.')
      width = be32(data, 0); height = be32(data, 4)
      colorType = data[9]
      const validDepths: Record<number, number[]> = { 0: [1, 2, 4, 8, 16], 2: [8, 16], 3: [1, 2, 4, 8], 4: [8, 16], 6: [8, 16] }
      if (!validDepths[colorType]?.includes(data[8]) || data[10] !== 0 || data[11] !== 0 || data[12] > 1) throw invalid('PNG header is unsupported.')
    }
    if (type === 'IHDR' && count !== 1) throw invalid('PNG contains a duplicate IHDR.')
    if (type === 'PLTE') {
      if (palette || idat || colorType === 0 || colorType === 4 || !length || length % 3 || length > 768) throw invalid('PNG palette is malformed or out of order.')
      palette = true
    }
    if (type === 'IDAT') {
      if (idatEnded || colorType === 3 && !palette) throw invalid('PNG image data is out of order.')
      idat = true
    } else if (idat && type !== 'IEND') idatEnded = true
    if (type === 'IEND') {
      if (length || !idat || colorType === 3 && !palette || offset + 12 !== bytes.length) throw invalid('PNG ending is malformed.')
      iend = true
    } else if (!['IHDR', 'PLTE', 'IDAT'].includes(type) && (typeBytes[0] & 32) === 0) {
      throw invalid('PNG contains an unsupported critical chunk.')
    }
    offset += length + 12
    if (iend) break
  }
  if (!iend) throw invalid('PNG is incomplete.')
  dimensions(width, height)
  return { verifiedMime: 'image/png', extractionKind: 'reference_only', extractedText: null,
    extractionNotice: 'Validated image reference only; image bytes are not sent to the AI.', width, height }
}

function jpeg(bytes: Uint8Array): AttachmentInspection {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes.at(-2) !== 0xff || bytes.at(-1) !== 0xd9) {
    throw invalid('JPEG signature or ending is invalid.')
  }
  let offset = 2; let count = 0; let width = 0; let height = 0; let frameSeen = false; let scanSeen = false
  while (offset < bytes.length - 2) {
    if (++count > 4096 || bytes[offset++] !== 0xff) throw invalid('JPEG marker structure is malformed.')
    while (bytes[offset] === 0xff) offset++
    const marker = bytes[offset++]
    if (marker === 0xd9) break
    if (marker === 0xda) {
      if (!width || !height || offset + 2 > bytes.length) throw invalid('JPEG scan header is malformed.')
      const scanLength = bytes[offset] << 8 | bytes[offset + 1]
      if (scanLength < 6 || offset + scanLength > bytes.length - 2) throw invalid('JPEG scan bounds are invalid.')
      offset += scanLength
      let ended = false
      while (offset < bytes.length) {
        if (bytes[offset++] !== 0xff) continue
        while (bytes[offset] === 0xff) offset++
        const scanMarker = bytes[offset++]
        if (scanMarker === 0x00 || scanMarker >= 0xd0 && scanMarker <= 0xd7) continue
        if (scanMarker === 0xd9 && offset === bytes.length) { ended = true; break }
        throw invalid('JPEG scan data contains an unsupported or malformed marker.')
      }
      if (!ended) throw invalid('JPEG scan is incomplete.')
      scanSeen = true
      break
    }
    if (marker === 0x01 || marker >= 0xd0 && marker <= 0xd7) continue
    if (offset + 2 > bytes.length) throw invalid('JPEG segment is truncated.')
    const length = bytes[offset] << 8 | bytes[offset + 1]
    if (length < 2 || offset + length > bytes.length) throw invalid('JPEG segment bounds are invalid.')
    if (marker === 0xc0) {
      if (frameSeen || length < 8) throw invalid('JPEG frame is malformed.')
      frameSeen = true
      height = bytes[offset + 3] << 8 | bytes[offset + 4]
      width = bytes[offset + 5] << 8 | bytes[offset + 6]
    } else if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
      throw invalid('Only baseline JPEG frame encoding is supported.')
    }
    offset += length
  }
  if (!scanSeen) throw invalid('JPEG contains no complete baseline scan.')
  dimensions(width, height)
  return { verifiedMime: 'image/jpeg', extractionKind: 'reference_only', extractedText: null,
    extractionNotice: 'Validated image reference only; image bytes are not sent to the AI.', width, height }
}

type ZipEntry = { name: string, flags: number, method: number, crc: number, compressed: number, expanded: number, localOffset: number }
function zipEntries(bytes: Uint8Array) {
  let eocd = -1
  for (let index = bytes.length - 22, minimum = Math.max(0, bytes.length - 65_557); index >= minimum; index--) {
    if (le32(bytes, index) === 0x06054b50) { eocd = index; break }
  }
  if (eocd < 0 || eocd + 22 > bytes.length || eocd + 22 + le16(bytes, eocd + 20) !== bytes.length
      || le16(bytes, eocd + 4) || le16(bytes, eocd + 6)) throw invalid('DOCX ZIP directory is missing, trailing, or multi-disk.')
  const count = le16(bytes, eocd + 10); const directorySize = le32(bytes, eocd + 12); const directoryOffset = le32(bytes, eocd + 16)
  if (!count || count > ATTACHMENT_LIMITS.zipEntries || directoryOffset + directorySize > eocd) throw invalid('DOCX ZIP directory exceeds safe bounds.')
  const decoder = new TextDecoder('utf-8', { fatal: true }); const seen = new Set<string>(); const entries: ZipEntry[] = []
  let totalExpanded = 0; let offset = directoryOffset
  for (let index = 0; index < count; index++) {
    if (offset + 46 > eocd || le32(bytes, offset) !== 0x02014b50) throw invalid('DOCX ZIP directory is malformed.')
    const flags = le16(bytes, offset + 8); const method = le16(bytes, offset + 10)
    const compressed = le32(bytes, offset + 20); const expanded = le32(bytes, offset + 24)
    const nameLength = le16(bytes, offset + 28); const extraLength = le16(bytes, offset + 30); const commentLength = le16(bytes, offset + 32)
    const end = offset + 46 + nameLength + extraLength + commentLength
    if (!nameLength || end > eocd || flags & ~(0x800 | 0x8) || ![0, 8].includes(method)) throw invalid('DOCX contains encrypted or unsupported ZIP entries.')
    let name = ''
    const nameBytes = bytes.subarray(offset + 46, offset + 46 + nameLength)
    if (!(flags & 0x800) && nameBytes.some(value => value > 0x7f)) throw invalid('DOCX legacy non-ASCII entry names are unsupported.')
    try { name = decoder.decode(nameBytes).replaceAll('\\', '/').toLowerCase() } catch { throw invalid('DOCX entry name is invalid UTF-8.') }
    if (name.startsWith('/') || name.split('/').some(part => !part || part === '..') || seen.has(name)) throw invalid('DOCX contains duplicate or path-ambiguous entries.')
    seen.add(name); totalExpanded += expanded
    if (totalExpanded > ATTACHMENT_LIMITS.zipExpandedBytes || (compressed ? expanded / compressed > ATTACHMENT_LIMITS.zipExpansionRatio : expanded > 0)) throw invalid('DOCX expansion exceeds safe bounds.')
    entries.push({ name, flags, method, crc: le32(bytes, offset + 16), compressed, expanded, localOffset: le32(bytes, offset + 42) }); offset = end
  }
  if (offset !== directoryOffset + directorySize) throw invalid('DOCX ZIP directory length is inconsistent.')
  return entries
}

function entryBytes(bytes: Uint8Array, entry: ZipEntry) {
  const offset = entry.localOffset
  if (offset + 30 > bytes.length || le32(bytes, offset) !== 0x04034b50) throw invalid('DOCX local entry is malformed.')
  const localFlags = le16(bytes, offset + 6); const localMethod = le16(bytes, offset + 8)
  const nameLength = le16(bytes, offset + 26); const extraLength = le16(bytes, offset + 28)
  let localName = ''
  try { localName = new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(offset + 30, offset + 30 + nameLength)).replaceAll('\\', '/').toLowerCase() } catch { throw invalid('DOCX local entry name is invalid.') }
  if (localFlags !== entry.flags || localMethod !== entry.method || localName !== entry.name) throw invalid('DOCX local and central entries disagree.')
  if (!(entry.flags & 0x8) && (le32(bytes, offset + 14) !== entry.crc || le32(bytes, offset + 18) !== entry.compressed || le32(bytes, offset + 22) !== entry.expanded)) {
    throw invalid('DOCX local sizes or checksum disagree.')
  }
  const start = offset + 30 + nameLength + extraLength
  if (start + entry.compressed > bytes.length) throw invalid('DOCX entry data is truncated.')
  try {
    const result = entry.method === 0 ? bytes.slice(start, start + entry.compressed)
      : inflateSync(bytes.subarray(start, start + entry.compressed), { out: new Uint8Array(entry.expanded) })
    if (result.length !== entry.expanded || crc32(result) !== entry.crc) throw new Error('length or checksum')
    return result
  } catch { throw invalid('DOCX main document could not be decompressed safely.') }
}

function xmlText(value: string) {
  return value.replace(/&(?:amp|lt|gt|quot|apos);|&#(?:x[0-9a-fA-F]+|[0-9]+);/g, entity => {
    const named: Record<string, string> = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'" }
    if (named[entity]) return named[entity]
    const raw = entity.slice(2, -1); const hex = raw[0].toLowerCase() === 'x'; const point = Number.parseInt(hex ? raw.slice(1) : raw, hex ? 16 : 10)
    return point > 0 && point <= 0x10ffff && !(point >= 0xd800 && point <= 0xdfff) ? String.fromCodePoint(point) : '\uFFFD'
  })
}

function docx(bytes: Uint8Array): AttachmentInspection {
  if (bytes.length > ATTACHMENT_LIMITS.docxBytes) throw invalid('DOCX exceeds the 4 MiB limit.')
  const main = zipEntries(bytes).find(entry => entry.name === 'word/document.xml')
  if (!main || main.expanded > ATTACHMENT_LIMITS.docxXmlBytes) throw invalid('DOCX main document is missing or exceeds safe bounds.')
  const xml = utf8(entryBytes(bytes, main))
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw invalid('DOCX external or custom entities are unsupported.')
  if (!/xmlns:w=["']http:\/\/schemas\.openxmlformats\.org\/wordprocessingml\/2006\/main["']/.test(xml)
      || /&(?!amp;|lt;|gt;|quot;|apos;|#(?:x[0-9a-fA-F]+|[0-9]+);)/.test(xml)) {
    throw invalid('DOCX main document namespace or entities are unsupported.')
  }
  const pieces: string[] = []; let length = 0
  for (const match of xml.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|<w:tab\s*\/\s*>|<w:(?:br|cr)(?:\s[^>]*)?\/\s*>|<\/w:p\s*>/g)) {
    if (match[1]?.includes('<')) throw invalid('DOCX contains unsupported nested text markup.')
    const piece = match[1] !== undefined ? xmlText(match[1])
      : match[0].startsWith('<w:tab') ? '\t' : '\n'
    length += piece.length
    if (length > ATTACHMENT_LIMITS.textCharacters) throw invalid('DOCX extracted text exceeds the character limit; the file was not truncated.')
    pieces.push(piece)
  }
  const extractedText = checkedText(pieces.join('').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim())
  return { verifiedMime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    extractionKind: 'main_document_text', extractedText,
    extractionNotice: 'Main document text only; comments, headers, footers, embedded media, and unsupported parts are excluded.' }
}

export function inspectDepartmentChatAttachment(bytes: Uint8Array, claimedMime: string): AttachmentInspection {
  if (!bytes.length || bytes.length > ATTACHMENT_LIMITS.fileBytes) throw invalid('Attachment size is outside the supported bounds.')
  if (!ATTACHMENT_MIME_TYPES.includes(claimedMime)) throw invalid('Attachment type is unsupported.')
  if (claimedMime === 'image/png') return png(bytes)
  if (claimedMime === 'image/jpeg') return jpeg(bytes)
  if (claimedMime.includes('wordprocessingml')) return docx(bytes)
  const conflictingBinarySignature =
    bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46
    || bytes[0] === 0x50 && bytes[1] === 0x4b
    || bytes[0] === 0x4d && bytes[1] === 0x5a
    || bytes[0] === 0x7f && bytes[1] === 0x45 && bytes[2] === 0x4c && bytes[3] === 0x46
  if (conflictingBinarySignature) throw invalid('File signature conflicts with the reserved text type.')
  const extractedText = checkedText(utf8(bytes))
  return { verifiedMime: claimedMime, extractionKind: 'plain_text', extractedText,
    extractionNotice: 'Validated UTF-8 text; the complete accepted text is eligible for explicit per-turn use.' }
}
