import test from 'node:test'
import assert from 'node:assert/strict'
import { zipSync, strToU8 } from 'fflate'
import { parseImportCsv, inspectImportZip, parseImportXlsx, unpackImportXlsx } from './projectSpreadsheetSource.js'
import { proposeImportMapping, validateImportMapping, previewSpreadsheetImport, spreadsheetSourceIdentity, boundedMappingProposalContext } from './projectSpreadsheetPreview.js'

const bytes = strToU8
const projectId = 'a0000000-0000-4000-8000-000000000001'
const sourceSha256 = 'a'.repeat(64)
const sourceName = 'synthetic.csv'
function sheet(csv) { return parseImportCsv(bytes(csv)).sheets[0] }
const preview = (csv, extras = {}) => previewSpreadsheetImport({ projectId, sourceSha256, sourceName, type: 'website_pages', sheet: sheet(csv), mapping: { page_key: 0, title: 1, planned_path: 2 }, existingComplete: true, ...extras })

test('CSV preserves original physical row and quoted multiline values', () => {
  const s = sheet('\uFEFFtitle,date\r\n"Hello, world\nnext",2026-09-30\r\n\r\nOther,2026-10-01')
  assert.equal(s.rows[1].row, 2); assert.equal(s.rows[2].row, 5)
  assert.equal(s.rows[1].cells[0], 'Hello, world\nnext')
})
test('CSV rejects malformed quoting, invalid UTF8 and bounded overflow', () => {
  for (const value of ['a\n"unterminated', 'a\n"ok"bad', 'a\n' + 'x'.repeat(8001), Array(65).fill('a').join(','), 'a\n' + Array(1001).fill('b').join('\n')]) assert.throws(() => parseImportCsv(bytes(value)))
  assert.throws(() => parseImportCsv(new Uint8Array([255])))
})
test('ZIP preflight rejects expansion before inflation', () => {
  const good = zipSync({ 'xl/workbook.xml': bytes('<workbook/>') })
  assert.equal(inspectImportZip(good).size, 1)
  const bomb = zipSync({ 'xl/workbook.xml': bytes('x'.repeat(2 * 1024 * 1024)) })
  assert.throws(() => inspectImportZip(bomb), /expansion/)
})
test('ZIP preflight rejects traversal, macros, external links and truncation', () => {
  for (const name of ['../escape', 'xl/vbaProject.bin', 'xl/externalLinks/externalLink1.xml']) assert.throws(() => inspectImportZip(zipSync({ [name]: bytes('x') })))
  const archive = zipSync({ 'xl/workbook.xml': bytes('x') })
  assert.throws(() => inspectImportZip(archive.subarray(0, archive.length - 1)))
  assert.throws(() => parseImportXlsx(archive), /browser XML parser/)
})
test('source identity hashes exact bytes, including newline differences', async () => {
  assert.equal((await spreadsheetSourceIdentity(bytes('abc'))).length, 64)
  assert.notEqual(await spreadsheetSourceIdentity(bytes('a\n')), await spreadsheetSourceIdentity(bytes('a\r\n')))
})
test('mapping proposals clarify duplicate aliases and forbid authority fields', () => {
  const proposal = proposeImportMapping(['page key', 'title', 'page title', 'path'], 'website_pages')
  assert.ok(proposal.ambiguities.some(x => x.includes('title')))
  assert.throws(() => validateImportMapping({ page_key: 0, title: 1, planned_path: 2, approved: 3 }, ['key', 'title', 'path', 'approval'], 'website_pages'))
  assert.throws(() => validateImportMapping({ page_key: 0, title: 0, planned_path: 2 }, ['key', 'title', 'path'], 'website_pages'))
  assert.equal(proposeImportMapping(['name'], 'invoice').mapping.constructor, Object)
})
test('preview returns create/update/skip without mutations and preserves revisions', async () => {
  const p = await preview('key,title,path\na,Home,/home\nb,New,/new\nc,Same,/same', { existing: [{ projectId, identity: 'a', revision: 7, values: { page_key: 'a', title: 'Old', planned_path: '/home' } }, { projectId, identity: 'c', revision: 2, values: { page_key: 'c', title: 'Same', planned_path: '/same' } }] })
  assert.deepEqual(p.rows.map(x => x.action), ['update', 'create', 'skip'])
  assert.equal(p.rows[0].expectedRevision, 7); assert.equal(p.mutationMade, false); assert.equal(p.providerRequestMade, false)
  assert.equal(p.commitReady, false); assert.ok(p.rows.every(x => !x.commitReady))
  assert.equal(p.rows[0].source.row, 2)
})
test('incomplete target lookup cannot classify unknown rows as safe creates', async () => {
  const p = await preview('key,title,path\na,Home,/home', { existingComplete: false })
  assert.equal(p.rows[0].action, 'error'); assert.match(p.rows[0].errors.join(' '), /incomplete/)
})
test('duplicate input identities and paths flag every conflicting row', async () => {
  const p = await preview('key,title,path\na,First,/one\na,Second,/two\nb,Third,/two')
  assert.ok(p.rows.every(x => x.action === 'error'))
})
test('foreign targets and ambiguous existing identities cannot be updated', async () => {
  await assert.rejects(() => preview('key,title,path\na,Home,/home', { existing: [{ projectId: 'other', identity: 'a', revision: 0, values: {} }] }), /exact project/)
  const target = { projectId, identity: 'a', revision: 0, values: {} }
  const p = await preview('key,title,path\na,Home,/home', { existing: [target, target] })
  assert.equal(p.rows[0].action, 'error')
})
test('review identity is deterministic and changes with mapping/content/project scope', async () => {
  const a = await preview('key,title,path\na,Home,/home'); const b = await preview('key,title,path\na,Home,/home')
  assert.equal(a.batchId, b.batchId); assert.equal(a.rows[0].rowId, b.rows[0].rowId)
  const changed = await preview('key,title,path\na,New,/home')
  assert.notEqual(a.rows[0].rowId, changed.rows[0].rowId)
  assert.notEqual(a.batchId, (await preview('key,title,path\na,Home,/home', { sourceSha256: 'b'.repeat(64) })).batchId)
})
test('formula cached rows require review and historical status is never promoted', async () => {
  const s = sheet('key,title,path,status\na,Home,/home,approved'); s.formulas = [{ row: 2, column: 2 }]
  const p = await preview('', { sheet: s, mapping: { page_key: 0, title: 1, planned_path: 2, historical_status: 3 } })
  assert.equal(p.rows[0].action, 'error'); assert.match(p.rows[0].warnings.join(' '), /cannot approve/)
  assert.equal(p.rows[0].values.historical_status, 'approved')
})
test('ambiguous calendar dates/timezones and invented target IDs are errors', async () => {
  const p = await preview('', { type: 'content_calendar', sheet: sheet('kind,title,date,zone,id\nproject_task,Post,09/10/26,local,a0000000-0000-4000-8000-000000000002'), mapping: { record_kind: 0, title: 1, original_date: 2, timezone: 3, record_id: 4 } })
  assert.equal(p.rows[0].action, 'error'); assert.ok(p.rows[0].errors.length >= 3)
})
test('keyword measurements require dated evidence and exact target mapping', async () => {
  const p = await preview('', { type: 'keyword_plan', sheet: sheet('term,locale,target,volume\nlimo,en-US,page:home,100'), mapping: { term: 0, locale: 1, target_page_key: 2, search_volume: 3 } })
  assert.equal(p.rows[0].action, 'error'); assert.match(p.rows[0].errors.join(' '), /evidence/)
})
test('provider proposal scope needs explicit consent and excludes unselected cells', () => {
  const s = sheet('title,private\nPublic,NEVER_SEND\nSecond,secret\nThird,secret\nFourth,secret')
  assert.throws(() => boundedMappingProposalContext({ sheet: s, columns: [0] }), /Confirm/)
  const p = boundedMappingProposalContext({ sheet: s, columns: [0], confirmed: true })
  assert.equal(p.samples.length, 3); assert.equal(JSON.stringify(p).includes('NEVER_SEND'), false)
  assert.throws(() => boundedMappingProposalContext({ sheet: { ...s, hidden: true }, columns: [0], confirmed: true }))
})
test('ZIP checksum detects payload corruption without XML parsing', () => {
  const good = zipSync({ 'xl/workbook.xml': bytes('original') }, { level: 0 })
  assert.equal(new TextDecoder().decode(unpackImportXlsx(good)['xl/workbook.xml']), 'original')
  const damaged = good.slice(); const view = new DataView(damaged.buffer)
  const start = 30 + view.getUint16(26, true) + view.getUint16(28, true); damaged[start] ^= 1
  assert.throws(() => unpackImportXlsx(damaged), /checksum/)
})
test('page parent cycles and existing URL collisions need explicit resolution', async () => {
  const p = await preview('key,title,path,parent\na,A,/a,b\nb,B,/b,a', { mapping: { page_key: 0, title: 1, planned_path: 2, parent_page_key: 3 } })
  assert.ok(p.rows.every(row => row.errors.includes('Page hierarchy cycle')))
  const collision = await preview('key,title,path\na,Home,/home', { existing: [{ projectId, identity: 'other', revision: 1, values: { planned_path: '/home' } }] })
  assert.match(collision.rows[0].errors.join(' '), /Existing page/)
})
