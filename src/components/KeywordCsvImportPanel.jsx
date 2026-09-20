import { useEffect, useRef, useState } from 'react'
import { keywordDuplicateWarnings } from '../data/contentStudio.js'
import { decodeKeywordCsv, KEYWORD_CSV_COLUMNS, parseKeywordCsv } from '../data/contentKeywordCsv.js'

export default function KeywordCsvImportPanel({ records = [], onImport, buttonClass }) {
  const [preview, setPreview] = useState(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const generation = useRef(0)
  useEffect(() => () => { generation.current += 1 }, [])

  async function chooseFile(event) {
    const file = event.target.files?.[0]
    event.target.value = ''
    const current = ++generation.current
    setPreview(null)
    setError('')
    if (!file) return
    if (file.size > 2 * 1024 * 1024) { setError('Choose a UTF-8 CSV file of at most 2 MB'); return }
    setLoading(true)
    try {
      const input = decodeKeywordCsv(await file.arrayBuffer())
      const result = parseKeywordCsv(input, { existingCount: records.length })
      if (current === generation.current) setPreview({ ...result, fileName: file.name || 'CSV file' })
    } catch (cause) {
      if (current === generation.current) setError(cause.message || 'Could not read the CSV file')
    } finally {
      if (current === generation.current) setLoading(false)
    }
  }

  const stale = preview && preview.existingCount !== records.length
  const duplicateWarnings = preview && !stale
    ? keywordDuplicateWarnings([...records, ...preview.rows]) : new Map()
  const duplicateCount = preview ? preview.rows.filter((_, index) =>
    duplicateWarnings.has(records.length + index)).length : 0

  function apply() {
    if (!preview || stale || preview.errors.length || !preview.rows.length) return
    onImport([...records, ...preview.rows])
    setPreview(null)
  }

  return <section className="mt-4 rounded-xl border border-slate-700 bg-slate-950/50 p-4" aria-label="Import keyword CSV">
    <h4 className="text-sm font-semibold text-white">Import keyword CSV</h4>
    <p className="mt-1 text-xs leading-5 text-slate-400">UTF-8 CSV, up to 2 MB and 500 total keywords. Required headers: phrase, locale. Optional: {KEYWORD_CSV_COLUMNS.slice(2).join(', ')}. Quoted commas and line breaks are supported. Targets are chosen in the editor after import; importing does not save a version.</p>
    <label className="mt-3 block text-xs text-slate-400">Choose CSV file<input aria-label="Choose keyword CSV file" type="file" accept=".csv,text/csv" disabled={loading || records.length >= 500} className="mt-2 block w-full text-xs text-slate-300" onChange={chooseFile} /></label>
    {loading && <p role="status" className="mt-3 text-xs text-slate-400">Reading CSV…</p>}
    {error && <p role="alert" className="mt-3 text-xs text-red-300">{error}</p>}
    {preview && <div className="mt-4 border-t border-slate-800 pt-4">
      <p className="text-sm text-slate-300">{preview.fileName}: {preview.rows.length} valid of {preview.total} data rows · {preview.errors.length} issue{preview.errors.length === 1 ? '' : 's'}.</p>
      {stale && <p role="alert" className="mt-2 text-xs text-amber-300">The keyword list changed after this preview. Select the file again before applying.</p>}
      {preview.errors.length > 0 && <p className="mt-2 text-xs text-red-300">Fix the CSV and choose it again; no rows are added while issues remain.</p>}
      {preview.errors.length > 0 && <ul role="alert" className="mt-2 max-h-48 space-y-1 overflow-y-auto text-xs text-red-300">{preview.errors.map((item, index) => <li key={index}>{item.line ? 'Line ' + item.line + ': ' : ''}{item.message}</li>)}</ul>}
      {duplicateCount > 0 && <p className="mt-2 text-xs text-amber-300">{duplicateCount} imported row{duplicateCount === 1 ? '' : 's'} repeat a phrase and locale. Rows remain separate; review intent before saving.</p>}
      {preview.rows.length > 0 && <div className="mt-3 max-h-72 overflow-auto"><table className="min-w-[1100px] text-left text-xs"><thead className="sticky top-0 bg-slate-950"><tr>{KEYWORD_CSV_COLUMNS.map(column => <th key={column} className="px-2 py-1">{column}</th>)}</tr></thead><tbody>{preview.rows.map((row, index) => <tr key={index} className="border-t border-slate-800">{KEYWORD_CSV_COLUMNS.map(column => <td key={column} className="px-2 py-1 align-top">{(column === 'phrase' ? row.term : row[column]) || '—'}</td>)}</tr>)}</tbody></table></div>}
      <button type="button" className={buttonClass + ' mt-4'} disabled={stale || preview.errors.length > 0 || !preview.rows.length} onClick={apply}>Add previewed rows to draft</button>
      <p className="mt-2 text-xs text-slate-500">Then choose an existing page or content request for each row. Save remains blocked until all targets are valid.</p>
    </div>}
  </section>
}
