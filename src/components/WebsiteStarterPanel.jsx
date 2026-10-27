import {useEffect,useRef,useState} from 'react'
import {websiteStarter} from '../data/websiteStarter.js'
import {canPublishWebsiteStarter} from '../data/websiteStarterRepository.js'

export default function WebsiteStarterPanel({organizationId,actorId,membership,signal,onPublished,repository=websiteStarter}) {
  const key=`anka:website-starter:${organizationId}:${actorId}:v1`
  const [pending,setPending]=useState(()=>{try {const value=JSON.parse(sessionStorage.getItem(key));return value?.requestId && value?.hash && value?.reason ? value : null}catch{return null}})
  const [review,setReview]=useState(null),[receipt,setReceipt]=useState(null),[error,setError]=useState(''),[busy,setBusy]=useState(false)
  const [reason,setReason]=useState('Reviewed the reusable Website starter for organization use.')
  const active=useRef(false),flight=useRef(false)
  useEffect(()=>{active.current=true;return ()=>{active.current=false}},[])
  const canPublish=Boolean(actorId) && membership?.organizationId===organizationId && canPublishWebsiteStarter(membership)
  const current=()=>active.current && !signal?.aborted
  function remember(command){sessionStorage.setItem(key,JSON.stringify(command));setPending(command)}
  function clear(){try{sessionStorage.removeItem(key)}catch{/* The server receipt remains authoritative. */}setPending(null)}
  async function inspect(){
    if(flight.current || !current() || !canPublish)return
    flight.current=true;setBusy(true);setError('')
    try{
      const value=await repository.review(organizationId,signal)
      if(!current())return
      if(value.published){setReceipt(value.receipt);setReview(null);clear()}
      else {setReview(value);if(pending)setError('No publication receipt found yet. Retry only the original publish request below.')}
    }catch(e){if(current())setError(e.message)}finally{flight.current=false;if(current())setBusy(false)}
  }
  async function publish(){
    if(flight.current || !current() || !canPublish || (!pending && !review))return
    flight.current=true;setBusy(true);setError('')
    try{
      const command=pending || {requestId:crypto.randomUUID(),hash:review.review_sha256,reason:reason.trim()}
      // Persist before the write. Storage failure blocks dispatch, rather than losing retry identity.
      remember(command)
      const result=await repository.publish(organizationId,command,signal)
      if(!current())return
      setReceipt({result});setReview(null);clear()
      try{await onPublished?.()}catch{/* A catalogue refresh failure does not undo publication. */}
    }catch(e){if(current()){if(['40001','22023','42501','55000'].includes(e.code)){clear();setReview(null);setError(`${e.message}. Review the plan again before publishing.`)}else setError(`${e.message}. Check publication status before retrying.`)}}finally{flight.current=false;if(current())setBusy(false)}
  }
  if(!canPublish)return null
  return <section aria-labelledby="website-starter-title" className="workspace-card my-5 space-y-4 p-4 sm:p-5">
    <div><h2 id="website-starter-title" className="font-semibold">Website starter</h2><p className="mt-1 text-sm text-[var(--anka-muted)]">Review once and publish a reusable plan as an organization admin. Project service activation, assignments, deliverable approvals and manual run review stay separate.</p></div>
    {!receipt && <button type="button" className="workspace-button workspace-button-primary" disabled={busy} onClick={inspect}>{pending ? 'Check publication status' : 'Review Website plan'}</button>}
    {busy && <p role="status">Checking the current organization and exact plan…</p>}
    {error && <p role="alert" className="break-words text-sm text-[var(--anka-danger)]">{error}</p>}
    {review && !receipt && <div className="space-y-4">
      <h3 className="font-semibold">Website core: copy → design → staging</h3>
      <ul className="list-disc space-y-1 pl-5 text-sm">{review.services.map(service=><li key={service.id}>{service.name} · {service.unit} · {service.recurrence.replaceAll('_',' ')}</li>)}</ul>
      <ol className="list-decimal space-y-3 pl-5 text-sm">{review.plan.execution.p_steps.map(step=><li key={step.key}><p className="font-medium">{step.label}</p><p className="text-[var(--anka-muted)]">{step.kind==='approval_gate' ? 'Human review' : 'Human delivery'} · {step.department_id}{step.depends_on.length ? ` · After ${step.depends_on.map(key=>review.plan.execution.p_steps.find(prior=>prior.key===key)?.label || key).join(', ')}` : ''}</p><p>{step.stage_contract.output_label}</p>{step.stage_contract.required_inputs.map(input=><p key={input.key}>Required: {input.label}</p>)}{step.stage_contract.reuse_allowed && <p>May reuse an exact approved website page copy version.</p>}</li>)}</ol>
      <p className="text-sm text-[var(--anka-muted)]">Publishes this preset and its six required stages together. No work, provider calls, production launch or project changes start here. Existing manual selection remains available.</p>
      <label className="block text-sm">Publication reason<textarea aria-label="Website publication reason" className="mt-1 w-full rounded-lg border border-[var(--anka-line)] bg-[var(--anka-surface)] p-2" maxLength={500} disabled={busy || Boolean(pending)} value={pending?.reason || reason} onChange={event=>setReason(event.target.value)} /></label>
      <button type="button" className="workspace-button workspace-button-primary" disabled={busy || (!pending && !reason.trim())} onClick={publish}>{pending ? 'Retry original publish' : 'Publish plan'}</button>
    </div>}
    {receipt && <div role="status" className="space-y-2 text-sm"><p className="font-semibold">Website starter published</p><p>The reusable plan is available for project selection. Exact service eligibility and project activation are checked separately.</p><a className="workspace-button" href="/sphere/projects">Open projects</a></div>}
  </section>
}
