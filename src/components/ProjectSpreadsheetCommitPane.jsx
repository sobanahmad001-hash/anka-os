import { useMemo, useRef, useState } from 'react'
import { SpreadsheetRowReview, SpreadsheetResults } from './ProjectSpreadsheetReview.jsx'
import { createProjectImportRecoverySession } from '../data/projectSpreadsheetImportRepository.js'

// Capability is injected only by the closed importer release gate. Opening this
// pane performs no reads, uploads, proposal saves or canonical writes.
export default function ProjectSpreadsheetCommitPane({ repository, scope, file, source, sheetIndex, sheet, type, mapping, classification='internal',onSourceReserved=()=>{} }) {
 const session=useMemo(()=>createProjectImportRecoverySession(repository,scope,globalThis.sessionStorage),[repository,scope])
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[receipt,setReceipt]=useState(null),[review,setReview]=useState(null),[proposal,setProposal]=useState(null)
 const [engagement,setEngagement]=useState(''),[artifact,setArtifact]=useState(''),[architecture,setArchitecture]=useState(''),[title,setTitle]=useState('')
 const [result,setResult]=useState(null)
 const [choices,setChoices]=useState(null)
 const contextCurrent=choices?.type===type
 const engagementCurrent=contextCurrent&&choices.engagements.some(x=>x.id===engagement)
 const [selected,setSelected]=useState([]),[consent,setConsent]=useState(false)
 const sourceKey=`anka:import-source:${scope.organizationId}:${scope.projectId}:${scope.conversationId}:${scope.actorId}`
 const originalSource=useRef(undefined),originalSave=useRef(null),flight=useRef(false)
 if(originalSource.current===undefined){const id=globalThis.sessionStorage.getItem(sourceKey);if(id&&!/^[0-9a-f-]{36}$/.test(id))throw Error('Invalid original source recovery');originalSource.current=id?{id,sha:null}:null}
 const stamp=JSON.stringify({source:source?.sha256,sheetIndex,type,mapping,selected,engagement,artifact,architecture,title})
 const reviewCurrent=review?.stamp===stamp
 async function act(run){if(flight.current)return;flight.current=true;setBusy(true);setError('');try{await run()}catch(e){setError(e.message)}finally{flight.current=false;setBusy(false)}}
 function request(){return {attachment_id:originalSource.current.id,engagement_id:engagement,artifact_id:artifact||null,architecture_version_id:architecture||null,title,type,sheet_index:sheetIndex,mapping,selected_rows:selected}}
 async function upload(){
  if(!consent)throw Error('Confirm private source upload; AI use and sharing remain disabled')
  if(!originalSource.current){const id=crypto.randomUUID();globalThis.sessionStorage.setItem(sourceKey,id);originalSource.current={id,sha:source.sha256};onSourceReserved()}
  if(originalSource.current.sha&&originalSource.current.sha!==source.sha256)throw Error('Check the original source before replacing it')
  const id=originalSource.current.id,status=await repository.sourceStatus(id)
  if(status?.status==='reference_only'){if(status.sha256_hex!==source.sha256)throw Error('Original source hash changed');setReceipt(status);return}
  if(status?.status==='processing')throw Error('Original source is processing; check its status instead of uploading again')
  const reserved=await repository.reserveSource(file,id,classification)
  await repository.uploadSource(file,reserved)
  setReceipt(await repository.finishSource(id,source.sha256))
 }
 const hasSource=Boolean(file&&source&&sheet)
 return <section aria-label="Reviewed private import">
  <p>Current Project Chat only. Source is private, excluded from AI and recipient sharing. Canonical confirmation shares only reviewed project work through its existing authority.</p>
  {hasSource&&<><label><input type="checkbox" checked={consent} disabled={busy} onChange={e=>setConsent(e.target.checked)}/>I confirm uploading this source as a private reference.</label>
  <button disabled={busy||!consent||!!session.pendingRequestId} onClick={()=>act(upload)}>Upload reviewed private source</button>

  {originalSource.current&&<button disabled={busy} onClick={()=>act(async()=>setReceipt(await repository.finishSource(originalSource.current.id,source.sha256)))}>Verify original upload without uploading again</button>}
  </>}
  {originalSource.current&&<button disabled={busy} onClick={()=>act(async()=>setReceipt(await repository.sourceStatus(originalSource.current.id)))}>Check original source</button>}
  <p>{receipt?`Source: ${{reference_only:'Verified private reference',awaiting_upload:'Waiting for upload',processing:'Verifying source',failed:'Needs recovery'}[receipt.status]||'Check source status'}`:'No verified source uploaded'}</p>
  {hasSource&&<><section aria-label="Project work selection"><h4>Choose project work</h4>
   <button disabled={busy||!!session.pendingRequestId} onClick={()=>act(async()=>{setChoices(await repository.targets(type));setEngagement('');setArtifact('');setArchitecture('');setReview(null)})}>Load current project workstreams</button>
   {contextCurrent&&<label>Workstream<select aria-label="Import workstream" value={engagement} disabled={busy||!!session.pendingRequestId} onChange={e=>{const next=e.target.value;setEngagement(next);setArtifact('');setArchitecture('');setChoices(null);setReview(null);if(next)act(async()=>setChoices(await repository.targets(type,next)))}}><option value="">Choose a workstream</option>{choices.engagements.map(x=><option key={x.id} value={x.id}>{x.label} · {x.status}</option>)}</select></label>}
   {!busy&&contextCurrent&&!choices.engagements.length&&<p>No active workstream with the required service is available to you in this project.</p>}
   {engagementCurrent&&type!=='content_calendar'&&<>
    <label>Project draft<select aria-label="Import project draft" value={artifact} disabled={busy||!!session.pendingRequestId} onChange={e=>{setArtifact(e.target.value);setReview(null)}}>{!choices.artifacts.length?<option value="">Create a new unapproved draft</option>:<option value="">Choose an existing draft</option>}{choices.artifacts.map(x=><option key={x.id} value={x.id}>{x.label}{x.version_number?` · current version ${x.version_number}`:''}</option>)}</select></label>
    <label>Draft title<input value={title} disabled={busy||!!session.pendingRequestId} onChange={e=>setTitle(e.target.value)}/></label>
   </>}
   {engagementCurrent&&type==='keyword_plan'&&<label>Website architecture reference<select aria-label="Import architecture reference" value={architecture} disabled={busy||!!session.pendingRequestId} onChange={e=>{setArchitecture(e.target.value);setReview(null)}}><option value="">Choose the exact architecture version</option>{choices.architectures.map(x=><option key={x.id} value={x.id}>{x.label}</option>)}</select></label>}
  </section>
  {type==='content_calendar'&&<p>New rows: choose engagement_work_item and a stable calendar_key, leaving record_id blank. They create unassigned Marketing tasks in not_started state. Original date/status/channel remain private evidence; only explicit start_date/due_date become schedule dates. Previously imported rows match their original import key. Other existing work must be matched before review.</p>}
  <p>Choose up to 25 source rows for this batch.</p>
  <button disabled={busy||!!session.pendingRequestId} onClick={()=>setSelected(sheet.rows.slice(1,26).map(row=>row.row))}>Select first 25 visible rows</button>
  <details><summary>Choose source rows · {selected.length} selected</summary>
  {sheet.rows.slice(1).map(row=><label key={row.row}><input type="checkbox" checked={selected.includes(row.row)} disabled={busy||!selected.includes(row.row)&&selected.length>=25} onChange={e=>setSelected(old=>e.target.checked?[...old,row.row]:old.filter(x=>x!==row.row))}/>Source row {row.row} · {row.cells[mapping.title??mapping.term]||'Untitled source row'}</label>)}</details>
  <button disabled={busy||receipt?.status!=='reference_only'||receipt.sha256_hex!==source.sha256||!selected.length||!engagementCurrent||type!=='content_calendar'&&(!title.trim()||choices.artifacts.length&&!artifact)||type==='keyword_plan'&&!architecture||!!session.pendingRequestId} onClick={()=>act(async()=>{const input=request(),data=await repository.preview(input);setReview({...data,stamp});setProposal(null);setResult(null);originalSave.current={input,review:data.review_sha256}})}>Review canonical differences</button>
  {review&&<><SpreadsheetRowReview preview={review.preview}/><button disabled={busy||!reviewCurrent||!!session.pendingRequestId||!!result?.rows} onClick={()=>act(async()=>setProposal(await session.save(originalSave.current.input,originalSave.current.review)))}>Save private reviewed proposal</button></>}
  </>}
  {session.pendingRequestId&&<><p>An import needs recovery. Check the original saved review before starting another batch.</p><button disabled={busy} onClick={()=>act(async()=>{const result=await session.recover();if(result?.status==='accepted'){setResult(result.result);setProposal(result)}else if(result){setProposal(result);if(result.status!=='pending')setError('This saved review is '+result.status+'. Make a fresh review before proceeding.')}else setError('No saved receipt was found yet. Retry the original save if this tab still has its review; do not start another import.')})}>Resume original import</button>
   {!proposal&&hasSource&&originalSave.current&&<button disabled={busy||!reviewCurrent} onClick={()=>act(async()=>setProposal(await session.retrySave(originalSave.current.input,originalSave.current.review)))}>Retry original proposal save</button>}</>}
  {proposal?.status==='pending'&&<><SpreadsheetRowReview preview={proposal.preview}/><button disabled={busy} onClick={()=>act(async()=>setResult(await session.confirm(proposal.review_sha256,true)))}>Confirm exactly this saved proposal</button></>}
  {result?.rows&&<SpreadsheetResults result={result} preview={proposal?.preview||review?.preview}/>}
  {error&&<p role="alert">{error}</p>}
 </section>
}
