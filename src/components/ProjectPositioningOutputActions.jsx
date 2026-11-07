import { useEffect, useMemo, useRef, useState } from 'react'
import WorkspaceDialog from './WorkspaceDialog.jsx'
import { createProjectPositioningOutputRepository } from '../data/projectPositioningOutputRepository.js'
export default function ProjectPositioningOutputActions({ client, scope, conversation, messages, request, onRequestHandled, signal, disabled, onStateChange, onContinueProductStructure }) {
  const repository = useMemo(() => createProjectPositioningOutputRepository(client), [client])
  const scopeKey = JSON.stringify(scope), live = useRef(scopeKey); live.current = scopeKey
  const key = 'anka:positioning-output:' + scopeKey
  const [review,setReview] = useState(null),[range,setRange] = useState({start:0,end:0}),[approvalId,setApprovalId] = useState(''),[attested,setAttested] = useState(false),[busy,setBusy] = useState(false),[pending,setPending] = useState(null),[saved,setSaved] = useState(null),[error,setError] = useState('')
  const seen = useRef(null)
  const source = messages.find(m => m.id === review?.sourceId)
  const approvals = source ? messages.filter(m => m.role === 'user' && m.author_id === scope.actor_id && m.status === 'completed' && m.conversation_id === scope.conversation_id && m.sequence >= source.sequence) : []
  const wording = source?.body?.slice(range.start,range.end) || ''
  useEffect(()=>{try{const original=JSON.parse(sessionStorage.getItem(key));if(original&&(!original.scope||Object.keys(scope).some(k=>original.scope[k]!==scope[k]))){setPending({invalid:true});setError('Original positioning request belongs to another scope. Keep it for recovery in its original conversation.')}else setPending(original||null)}catch{setPending({invalid:true});setError('Original positioning recovery state is unavailable. Do not save a replacement.')}setReview(null);setSaved(null)},[key]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(()=>{onStateChange?.({busy,dirty:Boolean(review||pending)})},[busy,review,pending,onStateChange])
  useEffect(()=>()=>onStateChange?.({busy:false,dirty:false}),[onStateChange])
  async function open(value){
    if(disabled||busy||pending)return
    const selected=messages.find(m=>m.id===value.sourceMessageId)
    if(!selected||selected.status!=='completed'||selected.conversation_id!==scope.conversation_id){setError('Choose an exact completed saved message in this conversation.');return}
    const token=scopeKey;setBusy(true);setError('')
    try{const data=await repository.review(scope,{signal});if(live.current!==token||signal?.aborted)return;if(!data.binding_id)throw Error('Review and bind the current Business brief before saving positioning.');setReview({sourceId:selected.id,data});setRange({start:0,end:0});setApprovalId('');setAttested(false)}catch(e){if(live.current===token&&!signal?.aborted)setError(e.message)}finally{if(live.current===token)setBusy(false)}
  }
  useEffect(()=>{if(request?.id&&seen.current!==request.id&&!disabled&&!busy&&!pending){seen.current=request.id;open(request).finally(()=>onRequestHandled?.(request.id))}},[request?.id,disabled,busy,pending]) // eslint-disable-line react-hooks/exhaustive-deps
  async function save(){
    if(disabled||busy||pending||!review)return
    const token=scopeKey;setBusy(true);setError('')
    try{
      const proposal=await repository.prepare(scope,source,messages.find(m=>m.id===approvalId),wording,review.data,crypto.randomUUID(),attested,conversation)
      if(live.current!==token||signal?.aborted)return
      sessionStorage.setItem(key,JSON.stringify(proposal));setPending(proposal)
      const result=await repository.confirm(proposal,{signal})
      if(live.current!==token||signal?.aborted)return
      sessionStorage.removeItem(key);setPending(null);setReview(null);setSaved(result)
    }catch(e){if(live.current===token&&!signal?.aborted){if(e.knownRollback){sessionStorage.removeItem(key);setPending(null)}setError(e.message)}}finally{if(live.current===token)setBusy(false)}
  }
  async function recover(){
    if(busy||!pending||pending.invalid)return
    const token=scopeKey;setBusy(true);setError('')
    try{const result=await repository.recover(pending.scope,pending.request_id,{signal});if(live.current!==token||signal?.aborted)return;if(!result)throw Error('No original save was recorded at this check. Do not resend or replace the request.');sessionStorage.removeItem(key);setPending(null);setReview(null);setSaved(result)}catch(e){if(live.current===token&&!signal?.aborted)setError(e.message)}finally{if(live.current===token)setBusy(false)}
  }
  return <section aria-label="Positioning output review">
    {review&&<WorkspaceDialog title="Review exact positioning wording" busy={busy} onClose={()=>{if(!pending)setReview(null)}}>
      <p>Select exact wording from this completed saved message. Approval is never inferred from the wording.</p>
      <textarea aria-label="Saved positioning source message" readOnly value={source?.body||''} onSelect={e=>{if(busy||pending)return;setRange({start:e.target.selectionStart,end:e.target.selectionEnd});setAttested(false)}}/>
      <pre aria-label="Chosen positioning wording">{wording}</pre>
      <label>Owner approval message<select aria-label="Owner approval message" value={approvalId} disabled={busy||Boolean(pending)} onChange={e=>{setApprovalId(e.target.value);setAttested(false)}}><option value="">Choose a saved owner message</option>{approvals.map(m=><option key={m.id} value={m.id}>Your saved message #{m.sequence}</option>)}</select></label>
      <pre aria-label="Selected owner approval message">{messages.find(m=>m.id===approvalId)?.body||''}</pre>
      <label><input aria-label="Attest chosen wording and owner approval" type="checkbox" checked={attested} disabled={busy||Boolean(pending)} onChange={e=>setAttested(e.target.checked)}/>I explicitly attest that the selected owner message approves this exact chosen wording. Save it as the reviewed positioning version; do not infer approval from text.</label>
      <button type="button" disabled={disabled||busy||Boolean(pending)||!wording.trim()||!approvalId||!attested} onClick={save}>Save reviewed positioning version</button>
      <button type="button" disabled={busy||Boolean(pending)} onClick={()=>setReview(null)}>Keep Chat without saving positioning</button>
    </WorkspaceDialog>}
    {pending&&<div role="status"><p>The original positioning save needs checking. A missing result does not authorize another save.</p><button type="button" disabled={busy||pending.invalid} onClick={recover}>Check original positioning save</button></div>}
    {saved&&<div role="status"><p>Positioning version {saved.version_number} saved for review. No Work was completed.</p><button type="button" disabled={disabled||busy||Boolean(pending)} onClick={()=>onContinueProductStructure?.(saved)}>Review product and service continuation</button></div>}
    {error&&<p role="alert">{error}</p>}
  </section>
}
