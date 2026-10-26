import {useEffect,useMemo,useRef,useState} from 'react'
import {supabase} from '../lib/supabase.js'
import {departmentChat} from '../data/departmentChatRepository.js'
import {createProjectSpreadsheetImportRepository,createProjectImportRecoverySession} from '../data/projectSpreadsheetImportRepository.js'
import {prepareDocumentDisclosure,validateDocumentProposal,documentProposalSheet,DOCUMENT_MIMES,parseDocumentRequest} from '../data/projectDocumentProposal.js'
import ProjectSpreadsheetCommitPane from './ProjectSpreadsheetCommitPane.jsx'
export default function ProjectDocumentProposalReader({initialFile,recoveryScope,onMappingAssist,onMappingRecover,onReadingState,onReturnToChat,onClose,onChooseAnother,documentProps}){
 const [source,setSource]=useState(null),[segments,setSegments]=useState([]),[selected,setSelected]=useState([]),[classification,setClassification]=useState('internal'),[consent,setConsent]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[proposal,setProposal]=useState(null),[messageId,setMessageId]=useState('')
 const repository=useMemo(()=>createProjectSpreadsheetImportRepository(supabase,recoveryScope),[recoveryScope]),generation=useRef(0),view=useRef(null),pane=useRef(null),flight=useRef(false),alive=useRef(true)
 view.current={source,segments,selected,proposal,repository,onMappingAssist,onMappingRecover}
 useEffect(()=>{setSource(null);setProposal(null);setError('');let active=true;const file=initialFile;if(!file||!(/\.(pdf|docx)$/i.test(file.name))||file.size<1||file.size>2097152){setError('Proposal reading supports text PDFs and DOCX originals up to 2 MiB. Legacy .doc, scans and encrypted PDFs are unsupported.');return}
 file.arrayBuffer().then(bytes=>crypto.subtle.digest('SHA-256',bytes)).then(hash=>{if(active)setSource({name:file.name,sha256:[...new Uint8Array(hash)].map(x=>x.toString(16).padStart(2,'0')).join(''),mime:/\.pdf$/i.test(file.name)?DOCUMENT_MIMES[0]:DOCUMENT_MIMES[1]})}).catch(e=>{if(active)setError(e.message)});return()=>{active=false;generation.current++}},[initialFile])
 useEffect(()=>{const previous=document.activeElement;pane.current?.querySelector?.('button')?.focus();return()=>previous?.focus?.()},[])
 useEffect(()=>{alive.current=true;return()=>{alive.current=false}},[])
 async function act(action){if(flight.current)return;flight.current=true;setBusy(true);setError('');try{await action()}catch(e){if(alive.current)setError(e.message);throw e}finally{flight.current=false;if(alive.current)setBusy(false)}}
 const run=action=>act(action).catch(()=>{})
 async function upload(){
  if(!source||!consent)throw Error('Confirm exact private original upload first')
  const token=generation.current;let failure=null
  await documentProps.run(async()=>{try{
   const conversation=await documentProps.ensureConversation();if(token!==generation.current||conversation.id!==recoveryScope.conversationId)throw Error('Document Chat context changed')
   const key=`anka:document-import:${recoveryScope.organizationId}:${recoveryScope.projectId}:${recoveryScope.conversationId}:${recoveryScope.actorId}:${source.sha256}`
   let id=sessionStorage.getItem(key);if(!id){id=crypto.randomUUID();sessionStorage.setItem(key,id)}
   const prior=await repository.sourceStatus(id)
   if(prior?.status!=='reference_only'&&prior?.status!=='processing'){
    const reserved=await repository.reserveSource(initialFile,id,classification);await repository.uploadSource(initialFile,reserved)
   }
   await repository.finishSource(id,source.sha256)
   const data=await repository.documentSource(id,source.sha256);if(token!==generation.current)return
   setSource({...source,attachmentId:id,classification:data.classification,revision:data.revision,notice:data.notice,characters:data.characters});setSegments(data.segments)
   const ids=[];let size=0;for(const s of data.segments){if(!s.text.trim())continue;if(s.text.length>4000||size+s.text.length>4000)break;ids.push(s.id);size+=s.text.length}setSelected(ids)
  }catch(reason){failure=reason;throw reason}})
  if(failure)throw failure
 }
 async function restore(){
  const snapshot=view.current,token=generation.current,session=createProjectImportRecoverySession(snapshot.repository,recoveryScope,sessionStorage)
  const pending=session.pendingRequestId?await session.recover():null
  let reply=pending?.status==='pending'?pending.preview?.rows?.[0]?.source?.sheet?.match(/^Document proposal ([0-9a-f-]{36})$/)?.[1]:null
  if(!reply){const chat=await departmentChat.getContextConversation({conversation_id:recoveryScope.conversationId},{organizationId:recoveryScope.organizationId});const humanIds=new Set((chat.messages||[]).filter(m=>{const d=parseDocumentRequest(m.body);return d?.source.attachmentId===snapshot.source.attachmentId&&d.source.sha256===snapshot.source.sha256}).map(m=>m.id));reply=[...(chat.messages||[])].reverse().find(m=>m.role==='assistant'&&m.status==='completed'&&humanIds.has(m.in_reply_to_message_id))?.id}
  if(!reply)throw Error('No original completed document proposal is available in this Chat. Read explicitly when ready.')
  const saved=await snapshot.repository.restoreDocumentProposal(snapshot.source.attachmentId,snapshot.source.sha256,reply);if(token!==generation.current)return
  const {ready:_ready,...original}=saved.proposal;const result=validateDocumentProposal(JSON.stringify(original),saved.disclosure);setSelected(saved.disclosure.segments.map(s=>s.id));setProposal(result);setMessageId(saved.message_id);onReturnToChat?.()
 }
 async function interpret(clarification='',recover=false){
  const current=view.current,token=generation.current
  const disclosure=prepareDocumentDisclosure(current.source,current.segments.filter(s=>current.selected.includes(s.id)),clarification,current.proposal)
  const answer=await (recover?current.onMappingRecover:current.onMappingAssist)?.(disclosure)
  if(token!==generation.current||!answer)return
  const result=validateDocumentProposal(answer.body,disclosure);setProposal(result);setMessageId(answer.messageId);onReturnToChat?.()
 }
 useEffect(()=>{onReadingState?.(proposal?{sourceName:source.name,sourceSha:source.sha256,questions:proposal.questions,clarify:answer=>act(()=>interpret(answer)),ready:proposal.ready}:null);return()=>onReadingState?.(null)},[proposal,source,onReadingState])
 let disclosed=null,disclosureError='';try{if(source?.attachmentId&&selected.length)disclosed=prepareDocumentDisclosure(source,segments.filter(s=>selected.includes(s.id)))}catch(e){disclosureError=e.message}
 const sheet=proposal?.ready?documentProposalSheet(proposal,messageId):null
 function keydown(e){if(e.key==='Escape'&&!busy){e.preventDefault();onClose()}if(e.key==='Tab'){const nodes=[...pane.current.querySelectorAll('button:not([disabled]),input:not([disabled]),select:not([disabled]),summary')].filter(n=>n.getClientRects().length),first=nodes[0],last=nodes.at(-1);if(e.shiftKey&&document.activeElement===first){e.preventDefault();last?.focus()}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus()}}}
 return <div className="project-import-overlay"><aside ref={pane} className="project-import" role="dialog" aria-modal="true" aria-label="Document project proposals" onKeyDown={keydown}>
 <div className="project-import-header"><h3>Read PDF / DOCX and propose updates</h3><button type="button" disabled={busy} onClick={onClose}>Back to chat</button></div>
 <button type="button" disabled={busy} onClick={onChooseAnother}>Choose another document</button><p>{initialFile?.name} · {initialFile?.size} bytes. Selection made no upload or AI call. Original checksum: {source?.sha256||'checking'}</p>
 <p>Text PDF (up to 20 pages), DOCX main text, up to 2 MiB and 16,000 extracted characters. No scans/OCR, encrypted PDF, legacy .doc, images, headers, footers or comments. Unsupported or over-limit sources are rejected without truncation.</p>
 {!segments.length&&<><label>Classification<select value={classification} disabled={busy} onChange={e=>setClassification(e.target.value)}>{['public','internal','confidential'].map(x=><option key={x}>{x}</option>)}</select></label><label><input type="checkbox" checked={consent} disabled={busy} onChange={e=>setConsent(e.target.checked)}/>I confirm private upload of this original and saving this Chat if new. Upload does not call AI or authorize project changes.</label><button type="button" disabled={busy||!source||!consent} onClick={()=>run(upload)}>Upload private document and inspect</button></>}
 {segments.length>0&&<><p>{source.notice} Extracted {source.characters} characters in {segments.length} passage(s); {selected.length} selected for AI. Review the exact passages below. This is not a claim of full-document understanding.</p><p>Exclude secrets and sensitive passages before Read. Only the shown selected passages enter the current approved private Chat model.</p>
 {segments.map(segment=><details key={segment.id}><summary><label><input type="checkbox" checked={selected.includes(segment.id)} disabled={busy||!segment.text.trim()} onChange={e=>{setProposal(null);setSelected(old=>e.target.checked?[...old,segment.id]:old.filter(x=>x!==segment.id))}}/>{segment.id} · {segment.text.length} characters</label></summary><pre style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>{segment.text}</pre></details>)}
 <p>{disclosureError}</p><button type="button" disabled={busy||!disclosed||!onMappingAssist} onClick={()=>run(()=>interpret())}>Read document and propose updates in Chat</button><button type="button" disabled={busy||!disclosed||!onMappingRecover} onClick={()=>run(()=>interpret('',true))}>Recover original document proposal</button>
 <button type="button" disabled={busy} onClick={()=>run(restore)}>Restore saved document proposal without AI</button><p>Supported updates: website page drafts, content calendar tasks and keyword plans only. Other project updates remain suggestions. No approval, publication, assignment or completion is inferred.</p></>}
 {proposal&&<section aria-label="Document proposal findings"><p>{proposal.explanation}</p>{proposal.suggestions.map((x,i)=><p key={i}>Suggestion only: {x}</p>)}{proposal.questions.map((x,i)=><p key={i}>Clarify in Chat: {x}</p>)}{proposal.rows.map((row,i)=><details key={i}><summary>Proposed row {i+1}</summary><pre>{JSON.stringify(row.values,null,2)}</pre>{row.citations.map((c,j)=><p key={j}>{c.segment}: “{c.quote}”</p>)}</details>)}</section>}
 {sheet&&<ProjectSpreadsheetCommitPane key={source.sha256+messageId} repository={repository} scope={recoveryScope} file={initialFile} source={source} sheetIndex={0} sheet={sheet.sheet} type={proposal.type} mapping={sheet.mapping} classification={source.classification} sourceAttachmentId={source.attachmentId} documentMessageId={messageId}/>}
 {error&&<p role="alert">{error}</p>}{busy&&<p role="status">Working on this exact document…</p>}
 </aside></div>
}
