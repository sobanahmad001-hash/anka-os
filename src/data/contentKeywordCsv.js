import { MAX_KEYWORD_RECORDS, normalizeKeywordWhitespace } from './contentStudio.js'

export const KEYWORD_CSV_COLUMNS = Object.freeze([
  'phrase', 'locale', 'intent', 'topic_group', 'priority', 'evidence_source',
  'search_volume', 'difficulty', 'observation_date', 'notes',
])
export const MAX_KEYWORD_CSV_BYTES = 2 * 1024 * 1024
const REQUIRED = ['phrase', 'locale']
const MAX_LENGTHS = { phrase: 500, locale: 120, intent: 500, topic_group: 500,
  priority: 120, evidence_source: 1000, notes: 2000 }

function cellsFromCsv(text) {
  const rows = []
  let cells = []
  let cell = ''
  let quoted = false
  let closed = false
  let line = 1
  let rowLine = 1
  const endCell = () => { cells.push(cell); cell = ''; closed = false }
  const endRow = () => {
    endCell()
    if (cells.some(value => value.trim())) rows.push({ line: rowLine, cells })
    if (rows.length > MAX_KEYWORD_RECORDS + 1) throw new Error('CSV supports at most 500 data rows')
    cells = []
    rowLine = line + 1
  }
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i]
    if (quoted) {
      if (char === '"') {
        if (text[i + 1] === '"') { cell += '"'; i += 1 } else { quoted = false; closed = true }
      } else {
        if (char === '\n') line += 1
        cell += char
      }
    } else if (char === ',' || char === '\r' || char === '\n') {
      if (char === ',') endCell()
      else {
        if (char === '\r' && text[i + 1] === '\n') i += 1
        endRow()
        line += 1
      }
    } else if (char === '"' && !cell && !closed) {
      quoted = true
    } else if (closed || char === '"') {
      throw new Error('Malformed CSV quoting at line ' + line)
    } else {
      cell += char
    }
  }
  if (quoted) throw new Error('Unclosed CSV quote at line ' + rowLine)
  if (cell || cells.length || closed) endRow()
  return rows
}

function realDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const date = new Date(value + 'T00:00:00.000Z')
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
}

function validateRow(record, line) {
  const problems = []
  for (const key of REQUIRED) if (!record[key]) problems.push(key + ' is required')
  for (const [key, limit] of Object.entries(MAX_LENGTHS)) {
    if (record[key].length > limit) problems.push(key + ' exceeds ' + limit + ' characters')
  }
  if (record.search_volume && (!/^\d+$/.test(record.search_volume)
    || !Number.isSafeInteger(Number(record.search_volume)))) {
    problems.push('search_volume must be a non-negative whole number')
  }
  if (record.difficulty && (!Number.isFinite(Number(record.difficulty))
    || Number(record.difficulty) < 0)) problems.push('difficulty must be a non-negative number')
  if (record.observation_date && !realDate(record.observation_date)) {
    problems.push('observation_date must be a real YYYY-MM-DD date')
  }
  if ((record.search_volume || record.difficulty || record.observation_date)
    && !record.evidence_source) problems.push('evidence_source is required for measured values')
  return problems.map(message => ({ line, message }))
}

export function parseKeywordCsv(text, { existingCount = 0 } = {}) {
  if (typeof text !== 'string') throw new Error('CSV text is required')
  if (new TextEncoder().encode(text).byteLength > MAX_KEYWORD_CSV_BYTES) throw new Error('CSV exceeds the 2 MB limit')
  const input = text.replace(/^\uFEFF/, '')
  const sourceRows = cellsFromCsv(input)
  if (!sourceRows.length) throw new Error('CSV needs a header and at least one data row')
  const headers = sourceRows[0].cells.map(value => value.trim().toLowerCase())
  if (new Set(headers).size !== headers.length) throw new Error('CSV header contains duplicate columns')
  const unsupported = headers.filter(value => !KEYWORD_CSV_COLUMNS.includes(value))
  if (unsupported.length) throw new Error('Unsupported CSV column: ' + unsupported[0])
  for (const key of REQUIRED) if (!headers.includes(key)) throw new Error('CSV requires phrase and locale columns')
  const data = sourceRows.slice(1)
  if (!data.length) throw new Error('CSV needs at least one data row')
  const errors = []
  if (data.length + existingCount > MAX_KEYWORD_RECORDS) {
    errors.push({ line: 0, message: 'Import would exceed the ' + MAX_KEYWORD_RECORDS + '-keyword limit including existing rows' })
  }
  const rows = []
  for (const item of data) {
    if (item.cells.length !== headers.length) {
      errors.push({ line: item.line, message: 'Expected ' + headers.length + ' columns, found ' + item.cells.length })
      continue
    }
    const values = Object.fromEntries(headers.map((key, index) => [key, item.cells[index].trim()]))
    const record = Object.fromEntries(KEYWORD_CSV_COLUMNS.map(key => [key, values[key] || '']))
    record.phrase = normalizeKeywordWhitespace(record.phrase)
    record.locale = normalizeKeywordWhitespace(record.locale)
    for (const key of ['intent', 'topic_group', 'priority', 'evidence_source']) {
      record[key] = normalizeKeywordWhitespace(record[key])
    }
    const rowErrors = validateRow(record, item.line)
    if (rowErrors.length) { errors.push(...rowErrors); continue }
    rows.push({
      term: record.phrase, locale: record.locale, intent: record.intent,
      topic_group: record.topic_group, priority: record.priority,
      evidence_source: record.evidence_source, search_volume: record.search_volume,
      difficulty: record.difficulty, observation_date: record.observation_date,
      notes: record.notes, target_kind: '', target_id: '', target_page_slug: '',
    })
  }
  return { rows, errors, total: data.length, existingCount }
}

export function decodeKeywordCsv(bytes) {
  if (!(bytes instanceof ArrayBuffer) || bytes.byteLength > MAX_KEYWORD_CSV_BYTES) {
    throw new Error('Choose a UTF-8 CSV file of at most 2 MB')
  }
  try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes) }
  catch { throw new Error('CSV must be encoded as UTF-8') }
}
