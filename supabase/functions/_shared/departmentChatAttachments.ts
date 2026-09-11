import { inflateSync, Unzlib } from 'npm:fflate@0.8.2'

export const ATTACHMENT_LIMITS = Object.freeze({
  filesPerTurn: 3, fileBytes: 5 * 1024 * 1024, docxBytes: 4 * 1024 * 1024,
  zipEntries: 256, zipExpandedBytes: 16 * 1024 * 1024, docxXmlBytes: 8 * 1024 * 1024,
  zipExpansionRatio: 30, textCharacters: 16_000, turnCharacters: 24_000,
  imageDimension: 4096, imagePixels: 16_000_000,
  imageDecodedBytes: 32 * 1024 * 1024,
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
  let offset = 8; let count = 0; let width = 0; let height = 0; let colorType = -1; let bitDepth = 0
  let idat = false; let idatEnded = false; let palette = false; let iend = false
  const idatParts: Uint8Array[] = []; let idatBytes = 0
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
      bitDepth = data[8]; colorType = data[9]
      const validDepths: Record<number, number[]> = { 0: [1, 2, 4, 8, 16], 2: [8, 16], 3: [1, 2, 4, 8], 4: [8, 16], 6: [8, 16] }
      if (!validDepths[colorType]?.includes(bitDepth) || data[10] !== 0 || data[11] !== 0 || data[12] !== 0) throw invalid('PNG header is unsupported.')
    }
    if (type === 'IHDR' && count !== 1) throw invalid('PNG contains a duplicate IHDR.')
    if (type === 'PLTE') {
      if (palette || idat || colorType === 0 || colorType === 4 || !length || length % 3 || length > 768) throw invalid('PNG palette is malformed or out of order.')
      palette = true
    }
    if (type === 'IDAT') {
      if (idatEnded || colorType === 3 && !palette) throw invalid('PNG image data is out of order.')
      idat = true; idatBytes += data.length
      if (idatBytes > ATTACHMENT_LIMITS.fileBytes) throw invalid('PNG image data exceeds safe bounds.')
      idatParts.push(data)
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
  const channels: Record<number, number> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }
  const rowBytes = Math.ceil(width * channels[colorType] * bitDepth / 8)
  const decodedBytes = height * (rowBytes + 1)
  if (!Number.isSafeInteger(decodedBytes) || decodedBytes > ATTACHMENT_LIMITS.imageDecodedBytes) {
    throw invalid('PNG decoded image exceeds safe bounds.')
  }
  const compressed = new Uint8Array(idatBytes); let compressedOffset = 0
  for (const part of idatParts) { compressed.set(part, compressedOffset); compressedOffset += part.length }
  try {
    let decodedOffset = 0; let finalSeen = false; const rowStride = rowBytes + 1
    const decoder = new Unzlib((chunk, final) => {
      if (decodedOffset + chunk.length > decodedBytes) throw new Error('decoded length')
      for (let index = 0; index < chunk.length; index++) if ((decodedOffset + index) % rowStride === 0 && chunk[index] > 4) throw new Error('filter')
      decodedOffset += chunk.length; finalSeen ||= final
    })
    decoder.push(compressed, true)
    if (!finalSeen || decodedOffset !== decodedBytes) throw new Error('decoded length')
  } catch { throw invalid('PNG image data could not be decoded safely.') }
  return { verifiedMime: 'image/png', extractionKind: 'reference_only', extractedText: null,
    extractionNotice: 'Validated image reference only; image bytes are not sent to the AI.', width, height }
}

type JpegHuffmanTable = Map<string, number>
type JpegComponent = { id: number, h: number, v: number, quant: number, dc?: JpegHuffmanTable, ac?: JpegHuffmanTable }

function jpegHuffmanTable(counts: Uint8Array, symbols: Uint8Array) {
  const table: JpegHuffmanTable = new Map(); let code = 0; let symbol = 0
  for (let length = 1; length <= 16; length++) {
    const count = counts[length - 1]
    if (code + count > 1 << length) throw invalid('JPEG Huffman table is oversubscribed.')
    for (let index = 0; index < count; index++) table.set(`${length}:${code++}`, symbols[symbol++])
    code <<= 1
  }
  if (!table.size || symbol !== symbols.length) throw invalid('JPEG Huffman table is malformed.')
  return table
}

function validateJpegEntropy(data: Uint8Array, components: JpegComponent[], width: number, height: number) {
  const entropy: number[] = []
  for (let offset = 0; offset < data.length; offset++) {
    const byte = data[offset]
    if (byte !== 0xff) { entropy.push(byte); continue }
    if (data[++offset] !== 0x00) throw invalid('JPEG scan data contains an unsupported or malformed marker.')
    entropy.push(0xff)
  }
  let bit = 0
  const readBits = (count: number) => {
    if (bit + count > entropy.length * 8) throw invalid('JPEG entropy data is truncated.')
    let value = 0
    while (count--) value = value << 1 | entropy[bit >> 3] >> (7 - (bit++ & 7)) & 1
    return value
  }
  const symbol = (table: JpegHuffmanTable | undefined) => {
    if (!table) throw invalid('JPEG scan references a missing Huffman table.')
    let code = 0
    for (let length = 1; length <= 16; length++) {
      code = code << 1 | readBits(1)
      const found = table.get(`${length}:${code}`)
      if (found !== undefined) return found
    }
    throw invalid('JPEG entropy data contains an invalid Huffman code.')
  }
  const maxH = Math.max(...components.map(component => component.h)); const maxV = Math.max(...components.map(component => component.v))
  const mcus = Math.ceil(width / (8 * maxH)) * Math.ceil(height / (8 * maxV))
  for (let mcu = 0; mcu < mcus; mcu++) for (const component of components) {
    for (let block = 0; block < component.h * component.v; block++) {
      const dcSize = symbol(component.dc)
      if (dcSize > 11) throw invalid('JPEG DC coefficient is invalid.')
      readBits(dcSize)
      for (let coefficient = 1; coefficient < 64;) {
        const value = symbol(component.ac); const run = value >> 4; const size = value & 15
        if (size === 0) {
          if (run === 0) break
          if (run !== 15 || coefficient + 16 > 64) throw invalid('JPEG AC coefficient run is invalid.')
          coefficient += 16; continue
        }
        if (size > 10 || coefficient + run >= 64) throw invalid('JPEG AC coefficient is invalid.')
        coefficient += run + 1; readBits(size)
      }
    }
  }
  const remaining = entropy.length * 8 - bit
  if (remaining > 7 || remaining && readBits(remaining) !== (1 << remaining) - 1) throw invalid('JPEG entropy padding is invalid.')
}

function jpeg(bytes: Uint8Array): AttachmentInspection {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes.at(-2) !== 0xff || bytes.at(-1) !== 0xd9) {
    throw invalid('JPEG signature or ending is invalid.')
  }
  let offset = 2; let count = 0; let width = 0; let height = 0; let frameSeen = false; let scanSeen = false
  const quantTables = new Set<number>(); const huffmanTables = new Map<string, JpegHuffmanTable>(); let components: JpegComponent[] = []
  while (offset < bytes.length - 2) {
    if (++count > 4096 || bytes[offset++] !== 0xff) throw invalid('JPEG marker structure is malformed.')
    while (bytes[offset] === 0xff) offset++
    const marker = bytes[offset++]
    if (marker === 0xd9) break
    if (marker === 0xda) {
      if (!width || !height || offset + 2 > bytes.length) throw invalid('JPEG scan header is malformed.')
      const scanLength = bytes[offset] << 8 | bytes[offset + 1]
      const scanComponents = bytes[offset + 2]
      if (scanComponents !== components.length || scanLength !== 6 + 2 * scanComponents || offset + scanLength > bytes.length - 2) throw invalid('JPEG scan bounds are invalid.')
      const selected = new Set<number>()
      for (let index = 0; index < scanComponents; index++) {
        const id = bytes[offset + 3 + 2 * index]; const selectors = bytes[offset + 4 + 2 * index]
        const component = components.find(candidate => candidate.id === id)
        if (!component || selected.has(id)) throw invalid('JPEG scan components are malformed.')
        selected.add(id); component.dc = huffmanTables.get(`0:${selectors >> 4}`); component.ac = huffmanTables.get(`1:${selectors & 15}`)
        if (!component.dc || !component.ac || !quantTables.has(component.quant)) throw invalid('JPEG scan references a missing table.')
      }
      const parameters = offset + 3 + 2 * scanComponents
      if (bytes[parameters] !== 0 || bytes[parameters + 1] !== 63 || bytes[parameters + 2] !== 0) throw invalid('JPEG baseline scan parameters are invalid.')
      offset += scanLength
      if (bytes.at(-2) !== 0xff || bytes.at(-1) !== 0xd9 || offset > bytes.length - 2) throw invalid('JPEG scan is incomplete.')
      validateJpegEntropy(bytes.subarray(offset, bytes.length - 2), components, width, height)
      scanSeen = true
      break
    }
    if (marker === 0x01) continue
    if (marker === 0x00 || marker >= 0xd0 && marker <= 0xd7) throw invalid('JPEG marker structure is malformed.')
    if (offset + 2 > bytes.length) throw invalid('JPEG segment is truncated.')
    const length = bytes[offset] << 8 | bytes[offset + 1]
    if (length < 2 || offset + length > bytes.length) throw invalid('JPEG segment bounds are invalid.')
    const data = bytes.subarray(offset + 2, offset + length)
    if (marker === 0xdb) {
      let index = 0
      while (index < data.length) {
        const info = data[index++]; const precision = info >> 4; const id = info & 15; const tableBytes = precision === 0 ? 64 : precision === 1 ? 128 : 0
        if (!tableBytes || id > 3 || index + tableBytes > data.length || quantTables.has(id)) throw invalid('JPEG quantization table is malformed.')
        for (let value = 0; value < tableBytes; value += precision + 1) {
          const quantizer = precision ? data[index + value] << 8 | data[index + value + 1] : data[index + value]
          if (!quantizer) throw invalid('JPEG quantization table is malformed.')
        }
        quantTables.add(id); index += tableBytes
      }
      if (!data.length) throw invalid('JPEG quantization table is malformed.')
    } else if (marker === 0xc4) {
      let index = 0
      while (index < data.length) {
        const info = data[index++]; const tableClass = info >> 4; const id = info & 15
        if (tableClass > 1 || id > 3 || index + 16 > data.length || huffmanTables.has(`${tableClass}:${id}`)) throw invalid('JPEG Huffman table is malformed.')
        const counts = data.subarray(index, index + 16); index += 16
        const symbolCount = counts.reduce((sum, value) => sum + value, 0)
        if (!symbolCount || index + symbolCount > data.length) throw invalid('JPEG Huffman table is malformed.')
        const symbols = data.subarray(index, index + symbolCount)
        if (tableClass === 0 && symbols.some(value => value > 11)
            || tableClass === 1 && symbols.some(value => (value & 15) > 10 || !(value & 15) && value >> 4 !== 0 && value >> 4 !== 15)) {
          throw invalid('JPEG Huffman table contains invalid baseline symbols.')
        }
        huffmanTables.set(`${tableClass}:${id}`, jpegHuffmanTable(counts, symbols)); index += symbolCount
      }
    } else if (marker === 0xdd) {
      throw invalid('JPEG restart intervals are unsupported.')
    } else if (marker === 0xc0) {
      const componentCount = bytes[offset + 7]
      if (frameSeen || bytes[offset + 2] !== 8 || ![1, 3].includes(componentCount) || length !== 8 + 3 * componentCount) throw invalid('JPEG frame is malformed.')
      frameSeen = true
      height = bytes[offset + 3] << 8 | bytes[offset + 4]
      width = bytes[offset + 5] << 8 | bytes[offset + 6]
      dimensions(width, height)
      const ids = new Set<number>(); components = []
      for (let index = 0; index < componentCount; index++) {
        const start = offset + 8 + 3 * index; const id = bytes[start]; const sampling = bytes[start + 1]; const h = sampling >> 4; const v = sampling & 15; const quant = bytes[start + 2]
        if (ids.has(id) || !h || !v || h > 4 || v > 4 || quant > 3) throw invalid('JPEG frame components are malformed.')
        ids.add(id); components.push({ id, h, v, quant })
      }
      if (components.reduce((sum, component) => sum + component.h * component.v, 0) > 10) throw invalid('JPEG frame sampling exceeds safe baseline bounds.')
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
    const valid = point === 0x9 || point === 0xa || point === 0xd || point >= 0x20 && point <= 0xd7ff
      || point >= 0xe000 && point <= 0xfffd || point >= 0x10000 && point <= 0x10ffff
    if (!valid) throw invalid('DOCX text contains an invalid XML character entity.')
    return String.fromCodePoint(point)
  })
}

function docxBody(xml: string) {
  const source = xml.replace(/^\s*<\?xml\s[^?]*\?>/, '')
  if (/<!--|<!\[CDATA\[|<\?/i.test(source)) throw invalid('DOCX main document markup is unsupported.')
  const tag = /<\/?([A-Za-z_][\w:.-]*)(?:\s[^<>]*?)?\s*\/?>/g
  const stack: string[] = []; let cursor = 0; let root = ''; let rootClosed = false; let bodyStart = -1; let bodyEnd = -1; let bodies = 0
  for (const match of source.matchAll(tag)) {
    const between = match.index === undefined ? '' : source.slice(cursor, match.index)
    if (match.index === undefined || between.includes('<') || !stack.length && between.trim()) throw invalid('DOCX main document XML is malformed.')
    const token = match[0]; const name = match[1]; const closing = token.startsWith('</'); const selfClosing = /\/\s*>$/.test(token)
    if (closing) {
      if (stack.pop() !== name) throw invalid('DOCX main document XML is malformed.')
      if (name === 'w:body') bodyEnd = match.index
      if (!stack.length) rootClosed = true
    } else {
      if (!stack.length) {
        if (root || rootClosed) throw invalid('DOCX main document XML is malformed.')
        root = name
      }
      if (name === 'w:body') {
        if (++bodies !== 1 || stack.at(-1) !== 'w:document' || selfClosing) throw invalid('DOCX main document body is malformed.')
        bodyStart = match.index + token.length
      }
      if (!selfClosing) stack.push(name)
    }
    cursor = match.index + token.length
  }
  if (source.slice(cursor).includes('<') || source.slice(cursor).trim() || stack.length || !rootClosed || root !== 'w:document' || bodies !== 1 || bodyEnd < bodyStart) throw invalid('DOCX main document body is malformed.')
  const outside = source.slice(0, bodyStart) + source.slice(bodyEnd)
  if (/<w:t(?:\s|>)/.test(outside)) throw invalid('DOCX text outside the main document body is unsupported.')
  return source.slice(bodyStart, bodyEnd)
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
  const body = docxBody(xml)
  const pieces: string[] = []; let length = 0
  for (const match of body.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|<w:tab\s*\/\s*>|<w:(?:br|cr)(?:\s[^>]*)?\/\s*>|<\/w:p\s*>/g)) {
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
