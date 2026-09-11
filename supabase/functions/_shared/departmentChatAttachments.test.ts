import { assertEquals, assertThrows } from 'jsr:@std/assert@1.0.14'
import { strToU8, zipSync, zlibSync } from 'npm:fflate@0.8.2'
import { inspectDepartmentChatAttachment } from './departmentChatAttachments.ts'

const docxBytes = (document: string) => zipSync({
  '[Content_Types].xml': strToU8('<Types/>'),
  'word/document.xml': strToU8(document),
})

function crc32(bytes: Uint8Array) {
  let crc = 0xffffffff
  for (const byte of bytes) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1))
  }
  return (crc ^ 0xffffffff) >>> 0
}

function pngChunk(type: string, data: Uint8Array) {
  const result = new Uint8Array(data.length + 12); const view = new DataView(result.buffer)
  view.setUint32(0, data.length); result.set(strToU8(type), 4); result.set(data, 8)
  view.setUint32(data.length + 8, crc32(result.subarray(4, data.length + 8)))
  return result
}

function onePixelPng(imageData = zlibSync(new Uint8Array([0, 0])), width = 1, height = 1, interlace = 0) {
  const signature = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])
  const ihdr = new Uint8Array(13); new DataView(ihdr.buffer).setUint32(0, width); new DataView(ihdr.buffer).setUint32(4, height); ihdr[8] = 8; ihdr[12] = interlace
  const chunks = [pngChunk('IHDR', ihdr), pngChunk('IDAT', imageData), pngChunk('IEND', new Uint8Array())]
  const result = new Uint8Array(signature.length + chunks.reduce((sum, chunk) => sum + chunk.length, 0)); result.set(signature)
  let offset = signature.length; for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.length }
  return result
}

const jpegSegment = (marker: number, data: number[]) => new Uint8Array([0xff, marker, (data.length + 2) >> 8, (data.length + 2) & 255, ...data])
function onePixelJpeg(frameMarker = 0xc0, width = 1, height = 1) {
  const dqt = jpegSegment(0xdb, [0, ...new Array(64).fill(1)])
  const sof = jpegSegment(frameMarker, [8, height >> 8, height & 255, width >> 8, width & 255, 1, 1, 0x11, 0])
  const counts = [1, ...new Array(15).fill(0)]
  const dc = jpegSegment(0xc4, [0, ...counts, 0]); const ac = jpegSegment(0xc4, [0x10, ...counts, 0])
  const sos = jpegSegment(0xda, [1, 1, 0, 0, 63, 0])
  const parts = [new Uint8Array([0xff, 0xd8]), dqt, sof, dc, ac, sos, new Uint8Array([0x3f, 0xff, 0xd9])]
  const result = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0)); let offset = 0
  for (const part of parts) { result.set(part, offset); offset += part.length }
  return result
}

Deno.test('CHAT-3 accepts complete UTF-8 text and rejects instead of truncating', () => {
  assertEquals(inspectDepartmentChatAttachment(strToU8('complete safe text'), 'text/plain').extractedText, 'complete safe text')
  assertThrows(
    () => inspectDepartmentChatAttachment(strToU8('x'.repeat(16_001)), 'text/plain'),
    Error, 'not truncated',
  )
  assertThrows(
    () => inspectDepartmentChatAttachment(new Uint8Array([0, 1, 2]), 'text/plain'),
    Error, 'binary or unsupported control',
  )
  assertThrows(
    () => inspectDepartmentChatAttachment(strToU8('%PDF-1.7 disguised'), 'text/plain'),
    Error, 'signature conflicts',
  )
})

Deno.test('CHAT-3 extracts only bounded DOCX main-document text', () => {
  const document = '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Hello &amp; safe</w:t></w:r></w:p></w:body></w:document>'
  const bytes = zipSync({
    '[Content_Types].xml': strToU8('<Types/>'),
    'word/document.xml': strToU8(document),
    'word/header1.xml': strToU8('<w:hdr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:p><w:r><w:t>Excluded</w:t></w:r></w:p></w:hdr>'),
  })
  const inspected = inspectDepartmentChatAttachment(
    bytes, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  )
  assertEquals(inspected.extractionKind, 'main_document_text')
  assertEquals(inspected.extractedText, 'Hello & safe')
  assertEquals(inspected.extractionNotice.includes('headers'), true)
})

Deno.test('CHAT-3 rejects DOCX text outside its single well-formed main body', () => {
  const namespace = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"'
  assertThrows(() => inspectDepartmentChatAttachment(docxBytes(
    `<w:document ${namespace}><w:t>SECRET</w:t><w:body><w:p><w:r><w:t>BODY</w:t></w:r></w:p></w:body></w:document>`,
  ), 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'), Error, 'outside the main document body')
  assertThrows(() => inspectDepartmentChatAttachment(docxBytes(
    `<w:document ${namespace}><w:body><w:p/></w:body><w:body><w:p/></w:body></w:document>`,
  ), 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'), Error, 'body is malformed')
  assertThrows(() => inspectDepartmentChatAttachment(docxBytes(
    `<w:document ${namespace}><w:body><w:p><w:r><w:t>BROKEN</w:t></w:p></w:body></w:document>`,
  ), 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'), Error, 'XML is malformed')
})

Deno.test('CHAT-3 rejects invalid numeric XML control entities', () => {
  for (const entity of ['&#1;', '&#x1;']) assertThrows(() => inspectDepartmentChatAttachment(docxBytes(
    `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>${entity}</w:t></w:r></w:p></w:body></w:document>`,
  ), 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'), Error, 'invalid XML character entity')
})

Deno.test('CHAT-3 rejects DOCX expansion bombs before decompression', () => {
  const bytes = zipSync({ 'word/document.xml': strToU8('x'.repeat(1_000_000)) }, { level: 9 })
  assertThrows(
    () => inspectDepartmentChatAttachment(
      bytes, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    ),
    Error, 'expansion exceeds safe bounds',
  )
})

Deno.test('CHAT-3 fails closed on malformed image bytes and never treats images as text', () => {
  assertThrows(() => inspectDepartmentChatAttachment(new Uint8Array([137, 80, 78, 71]), 'image/png'), Error, 'PNG signature')
  assertThrows(() => inspectDepartmentChatAttachment(new Uint8Array([255, 216, 255, 217]), 'image/jpeg'), Error, 'no complete baseline scan')
})

Deno.test('CHAT-3 decodes bounded PNG image data before accepting a reference', () => {
  const inspected = inspectDepartmentChatAttachment(onePixelPng(), 'image/png')
  assertEquals([inspected.width, inspected.height, inspected.extractionKind], [1, 1, 'reference_only'])
  assertThrows(() => inspectDepartmentChatAttachment(onePixelPng(new Uint8Array([0, 1, 2])), 'image/png'), Error, 'could not be decoded safely')
  const invalidFilter = onePixelPng(zlibSync(new Uint8Array([5, 0])))
  assertThrows(() => inspectDepartmentChatAttachment(invalidFilter, 'image/png'), Error, 'could not be decoded safely')
  const badCrc = onePixelPng(); badCrc[41] ^= 1
  assertThrows(() => inspectDepartmentChatAttachment(badCrc, 'image/png'), Error, 'checksum is invalid')
  assertThrows(() => inspectDepartmentChatAttachment(onePixelPng(undefined, 4097), 'image/png'), Error, 'dimensions exceed safe bounds')
  assertThrows(() => inspectDepartmentChatAttachment(onePixelPng(undefined, 1, 1, 1), 'image/png'), Error, 'header is unsupported')
})

Deno.test('CHAT-3 entropy-decodes a bounded baseline JPEG and rejects nominal framing', () => {
  const inspected = inspectDepartmentChatAttachment(onePixelJpeg(), 'image/jpeg')
  assertEquals([inspected.width, inspected.height, inspected.extractionKind], [1, 1, 'reference_only'])
  const nominal = new Uint8Array([0xff, 0xd8, ...jpegSegment(0xc0, [8, 0, 1, 0, 1, 1, 1, 0x11, 0]), ...jpegSegment(0xda, [1, 1, 0, 0, 63, 0]), 0, 0xff, 0xd9])
  assertThrows(() => inspectDepartmentChatAttachment(nominal, 'image/jpeg'), Error, 'missing table')
  assertThrows(() => inspectDepartmentChatAttachment(onePixelJpeg(0xc2), 'image/jpeg'), Error, 'Only baseline JPEG')
  assertThrows(() => inspectDepartmentChatAttachment(onePixelJpeg(0xc0, 4097), 'image/jpeg'), Error, 'dimensions exceed safe bounds')
})
