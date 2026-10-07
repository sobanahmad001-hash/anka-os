import { unzipSync } from 'fflate'

export const IMPORT_LIMITS = Object.freeze({ bytes: 2 * 1024 * 1024, expanded: 16 * 1024 * 1024, entries: 128, rows: 1000, columns: 64, cell: 8000 })
const decode = bytes => new TextDecoder('utf-8', { fatal: true }).decode(bytes)
const fail = message => { throw new TypeError(message) }
function boundedRows(rows) {
  if (rows.length > IMPORT_LIMITS.rows + 1) fail('Select at most 1000 data rows')
  for (const row of rows) {
    if (row.cells.length > IMPORT_LIMITS.columns) fail('At most 64 columns are supported')
    if (row.cells.some(cell => cell.length > IMPORT_LIMITS.cell)) fail('Cell exceeds 8000 characters')
  }
  return rows
}
export function parseImportCsv(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length > IMPORT_LIMITS.bytes) fail('Choose a UTF-8 CSV of at most 2 MB')
  const text = decode(bytes).replace(/^\uFEFF/, '')
  const rows = []; let cells = []; let cell = ''; let quoted = false; let closed = false; let line = 1; let start = 1
  const endCell = () => { cells.push(cell); cell = ''; closed = false; if (cells.length > IMPORT_LIMITS.columns) fail('At most 64 columns are supported') }
  const endRow = () => { endCell(); if (cells.some(x => x.trim())) rows.push({ row: start, cells }); boundedRows(rows); cells = []; start = line + 1 }
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (quoted) {
      if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++ } else { quoted = false; closed = true } }
      else { cell += c; if (c === '\n') line++ }
    } else if (c === '"' && !cell && !closed) quoted = true
    else if (c === ',') endCell()
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; endRow(); line++ }
    else if (closed || c === '"') fail('Malformed CSV at line ' + line)
    else cell += c
    if (cell.length > IMPORT_LIMITS.cell) fail('Cell exceeds 8000 characters')
  }
  if (quoted) fail('Unclosed CSV quote')
  if (cell || cells.length || closed) endRow()
  return { sheets: [{ name: 'CSV', hidden: false, rows: boundedRows(rows), excluded: [] }], disclosures: ['CSV values are untrusted text; formulas are never executed.'] }
}

// Check central-directory sizes BEFORE inflation. ZIP64, encrypted, duplicate,
// traversal, unsupported compression and oversized archives are rejected.
export function inspectImportZip(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length > IMPORT_LIMITS.bytes || bytes.length < 22) fail('Choose an XLSX of at most 2 MB')
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let end = -1
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
    if (v.getUint32(i, true) === 0x06054b50 && i + 22 + v.getUint16(i + 20, true) === bytes.length) { end = i; break }
  }
  if (end < 0 || v.getUint16(end + 4, true) || v.getUint16(end + 6, true) || v.getUint16(end + 20, true) || (end >= 20 && v.getUint32(end - 20, true) === 0x07064b50)) fail('Malformed, commented, ZIP64 or multi-disk ZIP')
  const count = v.getUint16(end + 10, true); const size = v.getUint32(end + 12, true); let p = v.getUint32(end + 16, true)
  if (!count || count > IMPORT_LIMITS.entries || v.getUint16(end + 8, true) !== count || p + size !== end) fail('Unsupported ZIP directory')
  const entries = new Map(); let total = 0
  for (let i = 0; i < count; i++) {
    if (p + 46 > end || v.getUint32(p, true) !== 0x02014b50) fail('Malformed ZIP entry')
    const flags = v.getUint16(p + 8, true); const method = v.getUint16(p + 10, true)
    const packed = v.getUint32(p + 20, true); const unpacked = v.getUint32(p + 24, true)
    const nameSize = v.getUint16(p + 28, true); const extra = v.getUint16(p + 30, true); const comment = v.getUint16(p + 32, true)
    if (p + 46 + nameSize + extra + comment > end) fail('Truncated ZIP directory')
    const name = decode(bytes.subarray(p + 46, p + 46 + nameSize))
    if (flags & 1 || ![0, 8].includes(method) || packed === 0xffffffff || unpacked === 0xffffffff || !name || /(^\/|\\|\x00|(^|\/)\.\.(\/|$))/.test(name) || entries.has(name)) fail('Unsafe ZIP entry')
    const offset = v.getUint32(p + 42, true)
    if (offset + 30 > end || v.getUint32(offset, true) !== 0x04034b50 || v.getUint16(offset + 8, true) !== method || v.getUint16(offset + 6, true) !== flags) fail('ZIP local header mismatch')
    const localNameSize = v.getUint16(offset + 26, true); const localExtra = v.getUint16(offset + 28, true)
    if (!(flags & 8) && (v.getUint32(offset + 18, true) !== packed || v.getUint32(offset + 22, true) !== unpacked || v.getUint32(offset + 14, true) !== v.getUint32(p + 16, true))) fail('ZIP size/checksum headers disagree')
    if (offset + 30 + localNameSize + localExtra + packed > v.getUint32(end + 16, true) || decode(bytes.subarray(offset + 30, offset + 30 + localNameSize)) !== name) fail('ZIP payload mismatch')
    total += unpacked
    if (total > IMPORT_LIMITS.expanded || unpacked > IMPORT_LIMITS.expanded || (unpacked > 1024 * 1024 && unpacked > Math.max(1, packed) * 100)) fail('Workbook expansion limit exceeded')
    if (/vbaProject|externalLinks|macrosheets/i.test(name)) fail('Macros and external-linked workbooks are unsupported')
    entries.set(name, unpacked); p += 46 + nameSize + extra + comment
  }
  if (p !== end) fail('ZIP directory mismatch')
  return entries
}
export function unpackImportXlsx(bytes) {
  const directory = inspectImportZip(bytes)
  const archive = unzipSync(bytes)
  if (Object.keys(archive).length !== directory.size) fail('Workbook entry mismatch')
  for (const [name, data] of Object.entries(archive)) if (directory.get(name) !== data.length) fail('Workbook expanded size mismatch')
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let p = view.getUint32(bytes.length - 6, true)
  for (let i = 0; i < directory.size; i++) {
    const n = view.getUint16(p + 28, true)
    const name = decode(bytes.subarray(p + 46, p + 46 + n))
    let crc = -1
    for (const byte of archive[name]) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0) }
    if (((crc ^ -1) >>> 0) !== view.getUint32(p + 16, true)) fail('Workbook checksum mismatch')
    p += 46 + n + view.getUint16(p + 30, true) + view.getUint16(p + 32, true)
  }
  return archive
}
export function parseImportXlsx(bytes, Parser = globalThis.DOMParser, preparedArchive = null) {
  inspectImportZip(bytes)
  if (!Parser) fail('XLSX XML inspection requires a browser XML parser')
  const archive = preparedArchive || unpackImportXlsx(bytes)
  const xml = name => {
    if (!archive[name]) fail('Workbook part is missing: ' + name)
    const value = decode(archive[name])
    if (/<!DOCTYPE|<!ENTITY/i.test(value)) fail('XML declarations/entities are unsupported')
    const doc = new Parser().parseFromString(value, 'application/xml')
    if (doc.getElementsByTagName('parsererror').length) fail('Malformed workbook XML')
    return doc
  }
  if (archive['[Content_Types].xml'] && /macroEnabled|vbaProject|macrosheet/i.test(decode(archive['[Content_Types].xml']))) fail('Macro content types are unsupported')
  const all = (node, name) => Array.from(node.getElementsByTagNameNS('*', name))
  const texts = node => all(node, 't').map(x => x.textContent).join('')
  const relationships = new Map(all(xml('xl/_rels/workbook.xml.rels'), 'Relationship').map(r => {
    if (r.getAttribute('TargetMode') === 'External') fail('External workbook relationships are unsupported')
    const target = r.getAttribute('Target') || ''
    if (!/^\/?(?:xl\/)?worksheets\/[^/]+\.xml$/.test(target)) return [r.getAttribute('Id'), null]
    return [r.getAttribute('Id'), target.startsWith('/') ? target.slice(1) : target.startsWith('xl/') ? target : 'xl/' + target]
  }))
  const strings = archive['xl/sharedStrings.xml'] ? all(xml('xl/sharedStrings.xml'), 'si').map(texts) : []
  const disclosures = ['Formula cells use cached values only, flagged for review. Dates retain original stored values; serial dates require explicit mapping.', 'Hidden sheets, rows and columns are excluded. No external links are fetched.']
  const sheets = all(xml('xl/workbook.xml'), 'sheet').map(sheet => {
    const name = sheet.getAttribute('name'); const hidden = ['hidden', 'veryHidden'].includes(sheet.getAttribute('state'))
    if (hidden) return { name, hidden, rows: [], excluded: ['Entire hidden sheet'] }
    const path = relationships.get(sheet.getAttribute('r:id'))
    if (!path) fail('Unsupported worksheet relationship')
    const doc = xml(path); const hiddenColumns = new Set(); const excluded = []; const formulas = []
    for (const col of all(doc, 'col')) if (col.getAttribute('hidden') === '1' || col.getAttribute('hidden') === 'true') {
      const min = Number(col.getAttribute('min')); const max = Number(col.getAttribute('max'))
      if (!Number.isInteger(min) || !Number.isInteger(max) || min < 1 || max < min || max > 16384) fail('Invalid hidden column range')
      for (let i = min; i <= max; i++) hiddenColumns.add(i)
      excluded.push(`Hidden columns ${min}–${max}`)
    }
    const rows = []
    for (const row of all(doc, 'row')) {
      const index = Number(row.getAttribute('r'))
      if (!Number.isInteger(index) || index < 1 || index > 1048576) fail('Invalid worksheet row')
      if (['1', 'true'].includes(row.getAttribute('hidden'))) { excluded.push('Hidden row ' + index); continue }
      const cells = []; const occupied = new Set()
      for (const c of all(row, 'c')) {
        const match = /^([A-Z]{1,3})([1-9][0-9]*)$/.exec(c.getAttribute('r') || '')
        if (!match || Number(match[2]) !== index) fail('Invalid cell identity')
        const column = [...match[1]].reduce((n, x) => n * 26 + x.charCodeAt(0) - 64, 0)
        if (hiddenColumns.has(column)) continue
        if (column > IMPORT_LIMITS.columns || occupied.has(column)) fail('Unsupported or duplicate column')
        occupied.add(column)
        const type = c.getAttribute('t'); const raw = all(c, 'v')[0]?.textContent ?? ''
        if (all(c, 'f').length) formulas.push({ row: index, column })
        let value = type === 'inlineStr' ? texts(c) : raw
        if (type === 's') { if (!/^\d+$/.test(raw) || strings[Number(raw)] === undefined) fail('Invalid shared string'); value = strings[Number(raw)] }
        cells[column - 1] = value
      }
      for (let i = 0; i < cells.length; i++) cells[i] ??= ''
      if (cells.some(x => x.trim())) rows.push({ row: index, cells })
      boundedRows(rows)
    }
    if (new Set(rows.map(x => x.row)).size !== rows.length) fail('Duplicate worksheet row')
    return { name, hidden, rows, excluded, formulas }
  })
  if (sheets.length > 32) fail('At most 32 sheets are supported')
  return { sheets, disclosures }
}
