import assert from 'node:assert/strict'
import test from 'node:test'

import { decodeKeywordCsv, parseKeywordCsv, MAX_KEYWORD_CSV_BYTES } from './contentKeywordCsv.js'
import { keywordStrategyIssues, serializeContentArtifact } from './contentStudio.js'

test('C03 imports quoted UTF-8 CSV into unsaved keyword rows without guessed targets or metrics', () => {
  const input = '\uFEFFphrase,locale,intent,evidence_source,search_volume,notes\r\n"brand, design",en-PK,commercial,Research report,120,"First line\nsecond line"\r\nLocal SEO,ur-PK,,,,\r\n'
  const result = parseKeywordCsv(input)
  assert.equal(result.total, 2)
  assert.deepEqual(result.errors, [])
  assert.deepEqual(result.rows.map(row => [row.term, row.locale, row.target_kind, row.target_id]), [
    ['brand, design', 'en-PK', '', ''], ['Local SEO', 'ur-PK', '', ''],
  ])
  assert.equal(result.rows[0].notes, 'First line\nsecond line')
  assert.equal(result.rows[1].search_volume, '')
  const issues = keywordStrategyIssues({ keywords: result.rows })
  assert.match(issues.get(0), /Choose a target type/)
  assert.match(issues.get(1), /Choose an existing target/)
  const serialized = serializeContentArtifact('keyword_strategy', { keywords: result.rows })
  assert.equal(serialized.keywords[1].search_volume, null)
  assert.equal(serialized.keywords[0].target_page_key, null)
})

test('C03 previews every invalid row and blocks missing evidence, bad metrics, dates, and column counts', () => {
  const input = 'phrase,locale,search_volume,difficulty,observation_date,evidence_source\nGood,en,10,2,2026-09-20,Report\nMissing locale,,10,,,\nBad metric,en,1.5,-1,2026-02-30,\nToo,few\n'
  const result = parseKeywordCsv(input)
  assert.equal(result.total, 4)
  assert.equal(result.rows.length, 1)
  assert.deepEqual([...new Set(result.errors.map(error => error.line))], [3, 4, 5])
  assert.match(result.errors.map(error => error.message).join(' '), /locale is required/)
  assert.match(result.errors.map(error => error.message).join(' '), /search_volume must be/)
  assert.match(result.errors.map(error => error.message).join(' '), /difficulty must be/)
  assert.match(result.errors.map(error => error.message).join(' '), /observation_date must be/)
  assert.match(result.errors.map(error => error.message).join(' '), /evidence_source is required/)
})

test('C03 rejects unsupported headers, malformed quoting, invalid UTF-8, and over-limit imports', () => {
  assert.throws(() => parseKeywordCsv('phrase,intent\nx,commercial'), /requires phrase and locale/)
  assert.throws(() => parseKeywordCsv('phrase,locale,locale\nx,en,en'), /duplicate columns/)
  assert.throws(() => parseKeywordCsv('phrase,locale,formula\nx,en,y'), /Unsupported CSV column/)
  assert.throws(() => parseKeywordCsv('phrase,locale\n"x,en'), /Unclosed CSV quote/)
  assert.match(parseKeywordCsv('phrase,locale\nx,en', { existingCount: 500 }).errors[0].message, /500-keyword limit/)
  assert.throws(() => parseKeywordCsv('phrase,locale\n' + 'x,en\n'.repeat(501)), /at most 500 data rows/)
  assert.throws(() => decodeKeywordCsv(Uint8Array.from([0xc3, 0x28]).buffer), /UTF-8/)
  assert.throws(() => decodeKeywordCsv(new ArrayBuffer(MAX_KEYWORD_CSV_BYTES + 1)), /at most 2 MB/)
  assert.equal(decodeKeywordCsv(new TextEncoder().encode('phrase,locale\nx,en').buffer), 'phrase,locale\nx,en')
})
