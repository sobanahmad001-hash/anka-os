import {useCallback,useEffect,useRef,useState} from 'react'
import {readProjectAttachmentSheet} from '../data/readProjectAttachmentSheet.js'
import {ATTACHMENT_TYPES,excludedAttachmentColumn,detectAttachmentWork,prepareAttachmentReading,suggestAttachmentColumns,validateAttachmentReading,sameAttachmentReadingScope} from '../data/projectAttachmentReading.js'
import {IMPORT_FIELDS,proposeImportMapping,validateImportMapping} from '../data/projectSpreadsheetPreview.js'
import {SpreadsheetDisclosure} from './ProjectSpreadsheetReview.jsx'
import ProjectSpreadsheetCommitPane from './ProjectSpreadsheetCommitPane.jsx'
import './projectSpreadsheetImport.css'
export default function ProjectAttachmentReader({initialFile,projectLabel,onClose,repository,recoveryScope,onMappingAssist,onMappingRecover,onReturnToChat,onReadingState,onChooseAnother}){
 const [loaded,setLoaded]=useState(null),[file,setFile]=useState(null),[sheetIndex,setSheetIndex]=useState(0),[columns,setColumns]=useState([]),[classification,setClassification]=useState('internal'),[proposal,setProposal]=useState(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[manualType,setManualType]=useState('website_pages'),[manualMapping,setManualMapping]=useState({}),[reserved,setReserved]=useState(false)
 const generation=useRef(0),controller=useRef(null),lastDisclosure=useRef(null),view=useRef(null),pane=useRef(null)
 const sheet=loaded?.workbook.sheets[sheetIndex]
 const privateSource=reserved||Boolean(recoveryScope&&sessionStorage.getItem(`anka:import-source:${recoveryScope.organizationId}:${recoveryScope.projectId}:${recoveryScope.conversationId}:${recoveryScope.actorId}`))
 let disclosure=null,disclosureError=''
 try{if(sheet&&columns.length)disclosure=prepareAttachmentReading({sheet,columns,source:loaded.source,classification})}catch(reason){disclosureError=reason.message}
 view.current={loaded,sheet,columns,classification,proposal,busy,onMappingAssist,onMappingRecover,privateSource}
 async function read(next){
  const token=++generation.current;controller.current?.abort();controller.current=new AbortController();setBusy(true);setError('');setLoaded(null);setProposal(null);lastDisclosure.current=null
  try{const result=await readProjectAttachmentSheet(next,{signal:controller.current.signal});if(token!==generation.current)return;setFile(next);setLoaded(result);setSheetIndex(result.index);setColumns(suggestAttachmentColumns(result.workbook.sheets[result.index]));const local=detectAttachmentWork(result.workbook.sheets[result.index]);setManualType(local.type||'website_pages');setManualMapping(local.mapping)}catch(e){if(token===generation.current)setError(e.message)}finally{if(token===generation.current)setBusy(false)}
 }
 useEffect(()=>{if(initialFile)void read(initialFile);return()=>{generation.current++;controller.current?.abort()}},[initialFile])
 useEffect(()=>{const previous=document.activeElement;pane.current?.querySelector?.('button')?.focus();return()=>previous?.focus?.()},[])
 const interpret=useCallback(async(clarification='',recover=false)=>{
  const snapshot=view.current;if(snapshot.busy||snapshot.privateSource&&!recover)throw Error('Finish or recover the current attachment operation first')
  const token=generation.current;setBusy(true);setError('')
  try{
   const base=prepareAttachmentReading({sheet:snapshot.sheet,columns:snapshot.columns,source:snapshot.loaded.source,classification:snapshot.classification})
   if(recover&&lastDisclosure.current&&!sameAttachmentReadingScope(lastDisclosure.current,base))throw Error('Restore and review the original source, sheet, columns and classification before recovery')
   const next=recover?(lastDisclosure.current||base):prepareAttachmentReading({sheet:snapshot.sheet,columns:snapshot.columns,source:snapshot.loaded.source,classification:snapshot.classification,clarification,previous:snapshot.proposal})
   lastDisclosure.current=next
   const action=recover?snapshot.onMappingRecover:snapshot.onMappingAssist;if(!action)throw Error('Approved Project Chat model required for AI reading; local inspection and Advanced mapping remain available')
   const answer=await action(next);if(token!==generation.current||!answer)return
   const result=validateAttachmentReading(answer,next);setProposal(result);if(result.type!=='reference_only'){setManualType(result.type);setManualMapping(result.mapping)}
   onReturnToChat?.()
  }catch(e){if(token===generation.current)setError(e.message);throw e}finally{if(token===generation.current)setBusy(false)}
 },[onReturnToChat])
 useEffect(()=>{onReadingState?.(proposal?{sourceName:loaded?.source.name,sourceSha:loaded?.source.sha256,questions:proposal.questions,clarify:answer=>interpret(answer),ready:proposal.ready}:null);return()=>onReadingState?.(null)},[proposal,loaded,onReadingState,interpret])
 const run=action=>Promise.resolve().then(action).catch(()=>{})
 const local=sheet?detectAttachmentWork(sheet):null
 return <div className="project-import-overlay"><aside ref={pane} className="project-import" role="dialog" aria-modal="true" aria-label="Read project attachment" onKeyDown={event=>{if(event.key==='Escape'&&!busy){event.preventDefault();onClose()}if(event.key==='Tab'){const nodes=[...pane.current.querySelectorAll('button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),summary')].filter(n=>n.getClientRects().length),first=nodes[0],last=nodes.at(-1);if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus()}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus()}}}}>
 <div className="project-import-header"><h3>Read attachment · {projectLabel||'Project Chat'}</h3><button type="button" disabled={busy} onClick={onClose}>Back to chat</button></div>
 <p>Selection inspects supported content locally. Read the disclosed sample in Chat, clarify only real ambiguities, then choose whether to review project changes. Keeping a chat reference never requires import.</p>
 {!initialFile&&<label>Choose spreadsheet<input aria-label="Attachment source spreadsheet" type="file" accept=".csv,.xlsx" disabled={busy||privateSource} onChange={e=>run(()=>read(e.target.files?.[0]))}/></label>}
 {busy&&<p role="status">Reading attachment…</p>}{error&&<p role="alert">{error}</p>}
 {onChooseAnother&&<button type="button" disabled={busy||privateSource} onClick={onChooseAnother}>Choose another attachment</button>}
 {loaded&&sheet&&<>
 <section aria-label="Selected attachment"><h4>{loaded.source.name}</h4><p>{file.size} bytes · exact original retained in this tab · {sheet.name} · {sheet.rows.length-1} visible data rows</p><p>{local.explanation}</p></section>
 {loaded.workbook.sheets.filter(s=>!s.hidden&&s.rows.length).length>1&&<label>Which sheet should Chat read?<select aria-label="Attachment sheet" disabled={busy||privateSource} value={sheetIndex} onChange={e=>{generation.current++;const index=Number(e.target.value);setSheetIndex(index);setColumns(suggestAttachmentColumns(loaded.workbook.sheets[index]));setProposal(null);lastDisclosure.current=null}}>{loaded.workbook.sheets.map((s,i)=><option key={i} value={i} disabled={s.hidden||!s.rows.length}>{s.name}{s.hidden?' · excluded':''}</option>)}</select></label>}
 <p>AI receives only the shown columns and up to three truncated, non-formula sample rows after Read. Hidden content and unselected columns are excluded; the whole file is not sent. Classification: {classification}. Existing model, source and billing consent still apply.</p>
 {disclosure&&<SpreadsheetDisclosure payload={disclosure.payload}/>}
 {!disclosure&&<p role="alert">{disclosureError||'No eligible disclosed sample. Check Advanced exclusions or keep the source local.'}</p>}
 <button type="button" disabled={busy||!disclosure||!onMappingAssist||privateSource} onClick={()=>run(()=>interpret())}>Read disclosed attachment in Chat</button>
 {!onMappingAssist&&<p>AI reading is unavailable until the current approved Project Chat model is ready. File selection has not sent anything.</p>}
 {onMappingRecover&&<button type="button" disabled={busy||!disclosure} onClick={()=>run(()=>interpret('',true))}>Recover original attachment reading</button>}
 {privateSource&&<p>Original import source is reserved. Use its existing review/recovery; a new AI reading is not authorized by upload.</p>}
 {proposal&&<section aria-label="Attachment interpretation"><h4>{ATTACHMENT_TYPES[proposal.type]}</h4><p>{proposal.explanation}</p>{proposal.questions.length>0&&<p>Answer the attachment questions in Chat before reviewing project changes.</p>}{proposal.type==='reference_only'&&<p>This source can be discussed in Chat; no supported canonical import adapter was established.</p>}</section>}
 <details><summary>Advanced · source disclosure and manual mapping</summary>
 <p>{loaded.workbook.disclosures.join(' ')} {sheet.excluded?.join(' ')}</p>
 <label>Source classification<select aria-label="Attachment source classification" disabled={busy||privateSource} value={classification} onChange={e=>{setClassification(e.target.value);setProposal(null)}}>{['public','internal','confidential','restricted'].map(x=><option key={x}>{x}</option>)}</select></label>
 {sheet.rows[0].cells.map((header,i)=>header&&<label key={i}><input type="checkbox" checked={columns.includes(i)} disabled={busy||privateSource||excludedAttachmentColumn(header)||!columns.includes(i)&&columns.length>=12} onChange={e=>{setProposal(null);setColumns(old=>e.target.checked?[...old,i]:old.filter(x=>x!==i))}}/>{header} · {excludedAttachmentColumn(header)?'excluded sensitive column':columns.includes(i)?'disclosed':'excluded'}</label>)}
 <label>Manual supported work type<select aria-label="Advanced attachment work type" disabled={busy} value={manualType} onChange={e=>{setManualType(e.target.value);setManualMapping(proposeImportMapping(sheet.rows[0].cells,e.target.value).mapping);setProposal(null)}}>{Object.keys(IMPORT_FIELDS).map(type=><option key={type} value={type}>{ATTACHMENT_TYPES[type]}</option>)}</select></label>
 <div className="project-import-mapping">{IMPORT_FIELDS[manualType].map(field=><label key={field}>{field.replaceAll('_',' ')}<select aria-label={'Advanced map '+field} disabled={busy} value={manualMapping[field]??''} onChange={e=>{setProposal(null);setManualMapping(old=>{const next={...old};if(e.target.value==='')delete next[field];else next[field]=Number(e.target.value);return next})}}><option value="">Not mapped</option>{sheet.rows[0].cells.map((header,i)=><option key={i} value={i}>{header}</option>)}</select></label>)}</div>
 <button type="button" disabled={busy} onClick={()=>{try{const mapping=validateImportMapping(manualMapping,sheet.rows[0].cells,manualType);setProposal({type:manualType,mapping,disclosedMapping:{},questions:[],explanation:'Explicitly reviewed manual mapping; no AI interpretation was made.',ready:true});setError('')}catch(e){setError(e.message)}}}>Use reviewed manual mapping</button>
 </details>
 {proposal?.ready&&repository&&recoveryScope&&<ProjectSpreadsheetCommitPane key={loaded.source.sha256} repository={repository} scope={recoveryScope} file={file} source={loaded.source} sheetIndex={sheetIndex} sheet={sheet} type={proposal.type} mapping={proposal.mapping} classification={classification} onSourceReserved={()=>setReserved(true)}/>}
 {proposal?.ready&&!repository&&<p>Save or recover the current owned private Chat before canonical review. No project records have been created.</p>}
 </>}
 </aside></div>
}
