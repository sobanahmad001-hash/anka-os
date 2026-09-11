import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { createDepartmentChatRepository } from './departmentChatTransport.js'

const read = path => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8')
const migration = read('supabase/migrations/20260911121056_p9_chat_private_attachments.sql')
const edge = read('supabase/functions/department-chat/index.ts')
const parser = read('supabase/functions/_shared/departmentChatAttachments.ts')
const chat = read('src/components/DepartmentChat.jsx')
const verifier = read('supabase/verify_20260911121056_p9_chat_private_attachments.sql')

test('CHAT-3 private storage and tables are exact-scope, RLS-enabled, and browser-write closed', () => {
  assert.match(migration, /'department-chat-attachments', 'department-chat-attachments', false, 5242880/)
  assert.doesNotMatch(migration, /application\/pdf/)
  for (const table of ['department_chat_attachments', 'department_chat_message_attachments']) {
    assert.ok(migration.includes(`alter table public.${table} enable row level security`))
  }
  assert.match(migration, /revoke all on table public\.department_chat_attachments, public\.department_chat_message_attachments\s+from public, anon, authenticated/)
  for (const helper of ['block_unsafe_department_chat_share', 'guard_department_chat_attachment_dispatch',
    'mark_department_chat_attachment_dispatch', 'protect_department_chat_attachment_records',
    'protect_department_chat_attachment_manifest']) {
    assert.ok(migration.includes(`revoke all on function private.${helper}() from public, anon, authenticated`), helper)
  }
  assert.match(migration, /staging_path = organization_id::text \|\| '\/' \|\| conversation_id::text \|\| '\/staging\/' \|\| id::text/)
  assert.match(migration, /final_path = organization_id::text \|\| '\/' \|\| conversation_id::text \|\| '\/final\/' \|\| id::text/)
})

test('CHAT-3 binds an immutable source manifest to idempotent turns and dispatch checks', () => {
  assert.ok(migration.includes('begin_department_chat_turn_with_attachments'))
  assert.ok(migration.includes('client_request_id conflicts with a different attachment manifest.'))
  assert.ok(migration.includes('attachment_sha256_hex'))
  assert.ok(migration.includes('provider_dispatched_at'))
  assert.ok(migration.includes('department_chat_attachment_dispatch_guard'))
  assert.ok(migration.includes('private.is_current_department_chat_contributor'))
  assert.ok(migration.includes('Every source used in a shared conversation must be explicitly shareable.'))
  assert.ok(migration.includes('Conversation contains sources that were not approved for recipient sharing.'))
})

test('CHAT-3 finalization separates expiring signed staging from immutable server-only objects', () => {
  assert.match(edge, /createSignedUploadUrl\(attachment\.staging_path, \{ upsert: false \}\)/)
  assert.match(edge, /\.upload\(finalPath, bytes, \{\s*contentType: inspected\.verifiedMime, cacheControl: '0', upsert: false/)
  assert.match(edge, /'Cache-Control': 'private, no-store, max-age=0'/)
  assert.doesNotMatch(edge, /createSignedUrl/)
  assert.ok(edge.includes('cleanupExpiredAttachments'))
  assert.ok(migration.includes('perform private.require_accessible_department_chat_conversation'))
})

test('CHAT-3 parsers enforce bounded preflight and fail-closed extraction', () => {
  for (const boundary of ['zipEntries: 256', 'zipExpandedBytes: 16 * 1024 * 1024', 'docxXmlBytes: 8 * 1024 * 1024',
    'zipExpansionRatio: 30', 'textCharacters: 16_000', 'turnCharacters: 24_000', 'imageDimension: 4096',
    'imageDecodedBytes: 32 * 1024 * 1024']) {
    assert.ok(parser.includes(boundary), boundary)
  }
  for (const guard of ['crc32(result) !== entry.crc', 'duplicate or path-ambiguous', '<!DOCTYPE|<!ENTITY',
    'Only baseline JPEG frame encoding is supported.', 'PNG checksum is invalid.',
    'PNG image data could not be decoded safely.', 'JPEG entropy data contains an invalid Huffman code.',
    'DOCX text outside the main document body is unsupported.', 'DOCX text contains an invalid XML character entity.',
    'File signature conflicts with the reserved text type.']) {
    assert.ok(parser.includes(guard), guard)
  }
  assert.ok(parser.includes('Main document text only; comments, headers, footers, embedded media, and unsupported parts are excluded.'))
  assert.ok(edge.includes('reference_only: { mime_types:'))
  assert.ok(edge.includes("unavailable: ['PDF'"))
  assert.doesNotMatch(edge, /input_file|input_image/)
})

test('CHAT-3 transport uploads only to the reserved path and finalizes the same identity', async () => {
  const actions = []
  const uploads = []
  const client = {
    functions: { invoke: async (_name, request) => {
      actions.push(request.body)
      if (request.body.action === 'reserve_attachment') return { data: { data: {
        attachment: { id: 'attachment-1' }, upload: { bucket: 'department-chat-attachments', path: 'org/conversation/staging/attachment-1', token: 'token' },
      } }, status: 200 }
      if (request.body.action === 'finalize_attachment') return { data: { data: { id: 'attachment-1', status: 'extracted' } }, status: 200 }
      return { data: { data: {} }, status: 200 }
    } },
    storage: { from: bucket => ({ uploadToSignedUrl: async (path, token, file, options) => {
      uploads.push({ bucket, path, token, file, options }); return { data: { path }, error: null }
    } }) },
  }
  const repository = createDepartmentChatRepository(client)
  const file = new Blob(['safe'], { type: 'text/plain' }); file.name = 'notes.txt'
  const result = await repository.uploadAttachment('content', {
    file, conversation_id: 'conversation', engagement_id: 'engagement', project_id: 'project',
    data_classification: 'internal', ai_use_allowed: true, share_with_recipients: false,
  }, { organizationId: 'org' })
  assert.equal(result.status, 'extracted')
  assert.deepEqual(actions.map(item => item.action), ['reserve_attachment', 'finalize_attachment'])
  assert.deepEqual(uploads.map(item => [item.bucket, item.path, item.token, item.options.contentType]),
    [['department-chat-attachments', 'org/conversation/staging/attachment-1', 'token', 'text/plain']])
  assert.equal('upsert' in uploads[0].options, false)
  assert.equal(actions[1].attachment_id, 'attachment-1')
})

test('CHAT-3 UI is explicit about selection, AI use, source sharing, and unavailable formats', () => {
  for (const phrase of ['Explicit source files', 'Only checked files are linked to the request',
    'Share this source with current and future conversation recipients', 'PDF and scanned/OCR documents are unavailable']) {
    assert.ok(chat.includes(phrase), phrase)
  }
  assert.ok(chat.includes('attachment_ids: supportsSavedConversations ? selectedAttachmentIds : undefined'))
})

test('CHAT-3 verifier is rollback-only and names storage, ACL, manifest, and revocation gates', () => {
  assert.match(verifier, /^-- P9 CHAT-3 rollback-only/)
  assert.ok(verifier.includes('begin;'))
  assert.ok(verifier.includes('rollback;'))
  assert.ok(verifier.includes("privilege.grantee in (0, 'anon'::regrole, 'authenticated'::regrole)"))
  for (const gate of ['attachment_private_bucket_contract', 'attachment_server_only_acl',
    'attachment_exact_manifest_and_hash', 'attachment_share_and_dispatch_revocation',
    'attachment_finalization_reauthorization']) assert.ok(verifier.includes(gate), gate)
})
