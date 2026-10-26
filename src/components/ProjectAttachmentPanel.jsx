import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import ProjectDocumentPanel from './ProjectDocumentPanel.jsx'
import { projectAttachmentRoute } from '../data/projectAttachmentRouting.js'
import './projectSpreadsheetImport.css'
import './projectAttachmentPanel.css'
const DocumentReader = lazy(()=>import('./ProjectDocumentProposalReader.jsx'))
const Reader = lazy(() => import('./ProjectAttachmentReader.jsx'))
const Spreadsheet = lazy(() => import('./ProjectSpreadsheetImportPanel.jsx'))
export default function ProjectAttachmentPanel({ onClose, documentProps, ...spreadsheetProps }) {
  const [route, setRoute] = useState(''), [file, setFile] = useState(null), [error, setError] = useState('')
  const pane = useRef(null)
  useEffect(() => { const previous = document.activeElement; pane.current?.querySelector?.('button')?.focus?.(); return () => previous?.focus?.() }, [])
  function keydown(event) {
    if (event.key === 'Escape' && (!documentProps.busy||documentProps.canReturnToChat)) { event.preventDefault(); onClose(); return }
    if (event.key !== 'Tab') return
    const nodes = [...pane.current.querySelectorAll('button:not([disabled]),input:not([disabled]),select:not([disabled]),[tabindex="0"]')].filter(x=>x.getClientRects().length)
    const first=nodes[0], last=nodes.at(-1)
    if (event.shiftKey && document.activeElement===first) { event.preventDefault();last?.focus() }
    else if(!event.shiftKey && document.activeElement===last) {event.preventDefault();first?.focus()}
  }
  if (route === 'spreadsheet') return <Suspense fallback={<p role="status">Opening attachment reader…</p>}><Reader {...spreadsheetProps} initialFile={file} onClose={onClose} onChooseAnother={()=>{setRoute('');setFile(null)}}/></Suspense>
  if(route==='document'&&/\.(pdf|docx)$/i.test(file?.name||''))return <Suspense fallback={<p role="status">Opening document proposal reader…</p>}><DocumentReader {...spreadsheetProps} documentProps={documentProps} initialFile={file} onClose={onClose} onChooseAnother={()=>{setRoute('');setFile(null)}}/></Suspense>
  if (route === 'manual') return <Suspense fallback={<p role="status">Opening spreadsheet review…</p>}><Spreadsheet {...spreadsheetProps} initialFile={file} onClose={onClose}/></Suspense>
  return <div className="project-import-overlay"><aside ref={pane} className="project-import project-attachments" role="dialog" aria-modal="true" aria-label="Project attachments" onKeyDown={keydown}>
    <div className="project-import-header"><h3>Attach files · {spreadsheetProps.projectLabel || 'Project Chat'}</h3><button type="button" disabled={documentProps.busy&&!documentProps.canReturnToChat} onClick={onClose}>Back to chat</button></div>
    <p>Choose a spreadsheet to inspect and review project changes, or PDF/DOCX to read in Chat and propose supported updates. TXT/Markdown remain discussion references. File selection alone does not upload, call AI or create project work.</p>
    {!route && <><label>Choose attachment<input aria-label="Choose attachment" type="file" accept=".csv,.xlsx,.pdf,.docx,.txt,.md" onChange={e=>{try { const next=e.target.files?.[0];if(!next)return;setRoute(projectAttachmentRoute(next));setFile(next);setError('') }catch(reason){setError(reason.message)}}}/></label>
      <button type="button" onClick={()=>setRoute('manual')}>Open spreadsheet review or recovery</button>
      <button type="button" disabled={!documentProps.conversationId} onClick={()=>setRoute('document')}>Manage document references</button></>}
    {error && <p role="alert">{error}</p>}
    {documentProps.recoveryPending&&<p role="status">Return to Chat and check the original save recovery before retrying this upload. The same file request is retained.</p>}
    {route === 'document' && <ProjectDocumentPanel {...documentProps} initialFile={file}/>}
    {route && <button type="button" disabled={documentProps.busy} onClick={()=>{setRoute('');setFile(null)}}>Choose another attachment type</button>}
  </aside></div>
}
