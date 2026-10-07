import { useEffect, useRef, useState } from 'react'
import { IMPORT_FIELDS, previewSpreadsheetImport, proposeImportMapping, spreadsheetSourceIdentity } from '../data/projectSpreadsheetPreview.js'
import { IMPORT_LIMITS, parseImportCsv, parseImportXlsx } from '../data/projectSpreadsheetSource.js'
import { SpreadsheetRowReview, SpreadsheetDisclosure } from './ProjectSpreadsheetReview.jsx'
import './projectSpreadsheetImport.css'
import ProjectSpreadsheetCommitPane from './ProjectSpreadsheetCommitPane.jsx'
import { prepareMappingDisclosure, validateAssistedMapping } from '../data/projectSpreadsheetMappingAssist.js'

// Local proposal workbench. No provider calls, persistence, upload or canonical
// commit is wired until the server authority/provenance contracts are settled.
export default function ProjectSpreadsheetImportPanel({ projectId, projectLabel, onClose, repository=null, recoveryScope=null, onMappingAssist=null, onMappingRecover=null }) {
  const [workbook, setWorkbook] = useState(null); const [source, setSource] = useState(null)
  const [sheetIndex, setSheetIndex] = useState(0); const [type, setType] = useState('website_pages')
  const [mapping, setMapping] = useState({}); const [preview, setPreview] = useState(null)
  const [error, setError] = useState(''); const [busy, setBusy] = useState(false)
  const [file,setFile]=useState(null),[columns,setColumns]=useState([]),[disclosure,setDisclosure]=useState(null),[questions,setQuestions]=useState([])
  const [classification,setClassification]=useState('internal')
  const [sourceReserved,setSourceReserved]=useState(false)
  const hasPrivateSource=sourceReserved||Boolean(recoveryScope&&globalThis.sessionStorage?.getItem(`anka:import-source:${recoveryScope.organizationId}:${recoveryScope.projectId}:${recoveryScope.conversationId}:${recoveryScope.actorId}`))
  const pane=useRef(null)
  useEffect(()=>{const previous=globalThis.document?.activeElement;pane.current?.querySelector?.('button')?.focus?.();return()=>previous?.focus?.()},[])
  function keyboard(event){if(event.key==='Escape'){event.preventDefault();onClose?.();return}if(event.key!=='Tab')return;const focusable=[...(pane.current?.querySelectorAll?.('button:not([disabled]),input:not([disabled]),select:not([disabled]),summary,[tabindex="0"]')||[])].filter(el=>el.getClientRects?.().length!==0);const first=focusable[0],last=focusable.at(-1);if(event.shiftKey&&globalThis.document.activeElement===first){event.preventDefault();last?.focus()}else if(!event.shiftKey&&globalThis.document.activeElement===last){event.preventDefault();first?.focus()}}
  const generation = useRef(0); const activeWorker = useRef(null)
  useEffect(() => () => { generation.current++; activeWorker.current?.terminate() }, [])
  const sheet = workbook?.sheets[sheetIndex]
  function choose(nextSheet, nextType) {
    generation.current++; setPreview(null); setError('');setDisclosure(null);setQuestions([]);setColumns([])
    setMapping(nextSheet?.rows.length ? proposeImportMapping(nextSheet.rows[0].cells, nextType).mapping : {})
  }
  async function read(file) {
    const token = ++generation.current
    activeWorker.current?.terminate(); setBusy(true); setError(''); setPreview(null); setSource(null); setWorkbook(null);setFile(null);setDisclosure(null);setQuestions([]);setColumns([])
    try {
      if (!file || file.size < 1 || file.size > IMPORT_LIMITS.bytes || !/\.(csv|xlsx)$/i.test(file.name)) throw new Error('Choose CSV or XLSX, at most 2 MB. XLS/XLSM are unsupported.')
      const data = new Uint8Array(await file.arrayBuffer())
      let result
      if (/\.csv$/i.test(file.name)) result = parseImportCsv(data)
      else {
        const archive = await new Promise((resolve, reject) => {
          const worker = new Worker(new URL('../data/projectSpreadsheetWorker.js', import.meta.url), { type: 'module' })
          activeWorker.current = worker
          const timer = setTimeout(() => { worker.terminate(); reject(new Error('Workbook inspection timed out; choose a smaller workbook')) }, 3000)
          const finish = () => { clearTimeout(timer); worker.terminate(); if (activeWorker.current === worker) activeWorker.current = null }
          worker.onmessage = event => { finish(); if (event.data.error) reject(new Error(event.data.error)); else resolve(event.data.archive) }
          worker.onerror = () => { finish(); reject(new Error('Workbook inspection failed')) }
          worker.postMessage(data.buffer.slice(0))
        })
        result = parseImportXlsx(data, globalThis.DOMParser, archive)
      }
      const hash = await spreadsheetSourceIdentity(data)
      if (generation.current !== token) return
      const first = result.sheets.findIndex(s => !s.hidden && s.rows.length)
      if (first < 0) throw new Error('No visible nonempty sheet found')
      setSource({ name: file.name, sha256: hash });setFile(file); setWorkbook(result); setSheetIndex(first)
      setMapping(proposeImportMapping(result.sheets[first].rows[0].cells, type).mapping)
    } catch (e) { if (generation.current === token) setError(e.message) }
    finally { if (generation.current === token) setBusy(false) }
  }
  async function inspect() {
    const token = ++generation.current; setBusy(true); setError('')
    try {
      const result = await previewSpreadsheetImport({ projectId, sourceSha256: source.sha256, sourceName: source.name, sheet, type, mapping, existingComplete: false })
      if (generation.current === token) setPreview(result)
    } catch (e) { if (generation.current === token) setError(e.message) }
    finally { if (generation.current === token) setBusy(false) }
  }
  return <div className="project-import-overlay"><aside ref={pane} className="project-import" role="dialog" aria-modal="true" onKeyDown={keyboard} aria-label="Project spreadsheet import">
    <div className="project-import-header"><h3>Import existing work · {projectLabel || 'Current project'}</h3><button type="button" onClick={onClose}>Close import</button></div>
    <p>Inspection starts locally. Upload and AI mapping each require their own confirmation. Closing keeps only saved recovery references; it does not save a local-only inspection.</p>
    <label>Source spreadsheet<input aria-label="Source spreadsheet" type="file" accept=".csv,.xlsx" disabled={busy} onChange={e => read(e.target.files?.[0])} /></label>
    {busy && <p role="status">Inspecting selected source…</p>}
    {error && <p role="alert">{error}</p>}
    {workbook && <>
      <label>Sheet<select aria-label="Import sheet" disabled={busy} value={sheetIndex} onChange={e => { const i = Number(e.target.value); setSheetIndex(i); choose(workbook.sheets[i], type) }}>{workbook.sheets.map((s, i) => <option key={i} value={i} disabled={s.hidden}>{s.name}{s.hidden ? ' · hidden, excluded' : ''}</option>)}</select></label>
      <label>Work type<select aria-label="Import work type" disabled={busy} value={type} onChange={e => { setType(e.target.value); choose(sheet, e.target.value) }}>{Object.keys(IMPORT_FIELDS).map(k => <option key={k} value={k}>{k.replaceAll('_', ' ')}</option>)}</select></label>
      <details><summary>Source and exclusions</summary><p>{source.name} · {workbook.sheets.length} sheets · selected sheet: {sheet.name}</p>{workbook.disclosures.map(s => <p key={s}>{s}</p>)}{sheet?.excluded?.map(s => <p key={s}>{s}</p>)}</details>
      <p>First visible row is the header. Resolve ambiguous column matches below; dates and statuses retain their source meaning.</p>
      <label>Source classification<select aria-label="Spreadsheet source classification" value={classification} disabled={hasPrivateSource} onChange={e=>{setClassification(e.target.value);setDisclosure(null)}}>{['public','internal','confidential','restricted'].map(x=><option key={x}>{x}</option>)}</select></label>
      <details><summary>Review column mapping · {Object.keys(mapping).length} columns mapped</summary><div className="project-import-mapping">{IMPORT_FIELDS[type].map(field => <label key={field}>{field.replaceAll('_', ' ')}<select aria-label={'Map ' + field} disabled={busy} value={mapping[field] ?? ''} onChange={e => { setPreview(null); setMapping(current => { const next = { ...current }; if (e.target.value === '') delete next[field]; else next[field] = Number(e.target.value); return next }) }}><option value="">Not mapped</option>{sheet?.rows[0]?.cells.map((header, i) => header.trim() ? <option key={i} value={i}>{i + 1}: {header}</option> : null)}</select></label>)}</div></details>
      {onMappingAssist&&!hasPrivateSource&&<details><summary>Ask AI about selected columns</summary><p>Choose at most12 visible columns before private upload. Review the exact headers and up to three truncated sample rows before dispatch. Existing approved model and billing consent still apply.</p>
       {sheet.rows[0].cells.map((header,i)=>header&&<label key={i}><input type="checkbox" checked={columns.includes(i)} disabled={busy||!columns.includes(i)&&columns.length>=12} onChange={e=>{setDisclosure(null);setColumns(old=>e.target.checked?[...old,i]:old.filter(x=>x!==i))}}/>{header}</label>)}
       <button disabled={busy||!columns.length||classification==='restricted'} onClick={()=>{try{setDisclosure(prepareMappingDisclosure(sheet,columns,type,classification))}catch(e){setError(e.message)}}}>Show exact AI content scope</button>
       {disclosure&&<><p>{disclosure.notice}</p><SpreadsheetDisclosure payload={disclosure.payload}/><button disabled={busy} onClick={async()=>{const token=++generation.current;setBusy(true);setError('');try{const answer=await onMappingAssist(disclosure);if(token!==generation.current)return;const result=validateAssistedMapping(answer,disclosure);setMapping(result.mapping);setQuestions(result.questions);setPreview(null)}catch(e){if(token===generation.current)setError(e.message)}finally{if(token===generation.current)setBusy(false)}}}>Confirm this disclosed scope and request mapping</button></>}
       {questions.map((q,i)=><p key={i}>Clarification: {q}</p>)}
       {onMappingRecover&&disclosure&&<button disabled={busy} onClick={async()=>{const token=++generation.current;setBusy(true);try{const answer=await onMappingRecover(disclosure);if(token===generation.current&&answer){const result=validateAssistedMapping(answer,disclosure);setMapping(result.mapping);setQuestions(result.questions);setPreview(null)}}catch(e){if(token===generation.current)setError(e.message)}finally{if(token===generation.current)setBusy(false)}}}>Recover original mapping without a new AI call</button>}
      </details>}
      <button type="button" disabled={busy} onClick={inspect}>Preview mapped rows</button>
      {preview && <><SpreadsheetRowReview preview={preview} local/><p>Local mapping inspection only. Existing project matches are checked in the authorized review step; no changes have been made.</p></>}
    </>}
      {repository&&recoveryScope&&<ProjectSpreadsheetCommitPane key={source?.sha256||'recovery'} repository={repository} scope={recoveryScope} file={file} source={source} sheetIndex={sheetIndex} sheet={sheet} type={type} mapping={mapping} classification={classification} onSourceReserved={()=>{setSourceReserved(true);setDisclosure(null)}}/>}
  </aside></div>
}
