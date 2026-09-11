import { assertEquals, assertThrows } from 'jsr:@std/assert@1.0.14'
import { strToU8, zipSync } from 'npm:fflate@0.8.2'
import { inspectDepartmentChatAttachment } from './departmentChatAttachments.ts'

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
