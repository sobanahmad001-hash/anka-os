import { useEffect, useRef, useState } from 'react'
const inputClass='mt-2 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white disabled:opacity-50'
const buttonClass='rounded-xl border border-slate-700 px-4 py-2 text-sm text-white disabled:opacity-50'
export default function MarketingCampaignHandoffPanel({organizationId,engagement,campaign,plan,snapshot,repository,canEdit,onAccessError=()=>{}}) {
  const submission=(snapshot.reviewSubmissions||[]).find(x=>x.plan_version_id===plan?.id)
  const brief=(snapshot.campaignBriefVersions||[]).find(x=>x.id===submission?.artifact_version_id)
  const approval=(snapshot.briefApprovals||[]).find(x=>x.artifact_version_id===brief?.id)
  const services=(snapshot.recipientServices||[]).filter(x=>x.engagement_id===engagement.id&&x.status==='active'&&x.service_catalog?.is_active&&['content','design'].includes(x.service_catalog?.department_id))
  const [serviceId,setServiceId]=useState(''),[workstreamId,setWorkstreamId]=useState('')
  const [title,setTitle]=useState(''),[output,setOutput]=useState('')
  const [preview,setPreview]=useState(false),[uncertain,setUncertain]=useState(false)
  const [confirmed,setConfirmed]=useState(null),[busy,setBusy]=useState(false),[error,setError]=useState('')
  const requestId=useRef(crypto.randomUUID())
  const target=[organizationId,engagement.id,engagement.project_id,campaign.id,plan?.id,brief?.id,brief?.content_checksum,approval?.id].join(':')
  const service=services.find(x=>x.id===serviceId)
  const workstreams=(snapshot.recipientWorkstreams||[]).filter(x=>x.project_id===engagement.project_id&&x.status==='active'&&x.department_id===service?.service_catalog?.department_id)
  const workstream=workstreams.find(x=>x.id===workstreamId)
  const ready=Boolean(canEdit&&engagement.project_id&&plan?.id&&brief?.id&&brief.content_checksum&&approval?.id&&service&&workstream&&title.trim()&&title.trim().length<=240&&output.trim()&&output.trim().length<=7500)
  useEffect(()=>{setServiceId('');setWorkstreamId('');setTitle(plan?.title?'Campaign creative: '+plan.title:'');setOutput(plan?.objective||'');setPreview(false);setUncertain(false);setConfirmed(null);setError('');requestId.current=crypto.randomUUID()},[target,plan?.title,plan?.objective])
  function edit(setter,value){if(uncertain||confirmed)return;setter(value);setPreview(false);requestId.current=crypto.randomUUID()}
  function payload(){return {projectId:engagement.project_id,engagementId:engagement.id,campaignId:campaign.id,requestId:requestId.current,planVersionId:plan.id,briefVersionId:brief.id,briefChecksum:brief.content_checksum,approvalId:approval.id,receivingServiceId:serviceId,receivingWorkstreamId:workstreamId,title:title.trim(),requestedOutput:output.trim()}}
  async function confirm(){if(!ready||!preview||busy||confirmed)return;setBusy(true);setError('');try{setConfirmed(await repository.confirmHandoff(payload()));setUncertain(false)}catch(reason){onAccessError(reason,{membershipMismatch:reason?.membershipMismatch===true});setUncertain(true);setError('Confirmation result is uncertain. Check exact status or retry with the same request ID.')}finally{setBusy(false)}}
  async function refresh(){setBusy(true);setError('');try{const row=await repository.getHandoff(requestId.current);if(!row){setUncertain(false);setError('No confirmed request exists for this ID. You may retry or edit.')}else{const x=payload();if(row.organization_id!==organizationId||row.project_id!==x.projectId||row.engagement_id!==x.engagementId||row.campaign_id!==x.campaignId||row.plan_version_id!==x.planVersionId||row.brief_version_id!==x.briefVersionId||row.brief_checksum!==x.briefChecksum||row.approval_id!==x.approvalId||row.receiving_service_id!==x.receivingServiceId||row.receiving_workstream_id!==x.receivingWorkstreamId||row.title!==x.title||row.requested_output!==x.requestedOutput)throw new Error('Request ID exists with different inputs');setConfirmed({request_id:row.request_id});setUncertain(false)}}catch(reason){onAccessError(reason,{membershipMismatch:reason?.membershipMismatch===true});setError(reason.message)}finally{setBusy(false)}}
  return <section className="mt-6 rounded-xl border border-emerald-900/50 p-5">
    <h3 className="font-semibold">Approved campaign brief · internal downstream request</h3>
    <p className="mt-2 text-xs text-slate-400">Records the exact approved brief and plan in N3. Creates no task, spend, provider action or publication.</p>
    {!approval?<p className="mt-3 text-xs text-amber-300">This plan has no approved exact campaign brief yet.</p>:<p className="mt-3 break-all text-xs text-emerald-300">Plan {plan.id} · approved brief {brief.id} · SHA-256 {brief.content_checksum}</p>}
    <div className="mt-4 grid gap-4 md:grid-cols-2">
      <label className="text-xs text-slate-400">Recipient service<select aria-label="Campaign handoff service" className={inputClass} value={serviceId} disabled={!approval||uncertain||Boolean(confirmed)||busy} onChange={e=>{edit(setServiceId,e.target.value);setWorkstreamId('')}}><option value="">Choose Content or Design service</option>{services.map(x=><option key={x.id} value={x.id}>{x.service_catalog.name}</option>)}</select></label>
      <label className="text-xs text-slate-400">Recipient workstream<select aria-label="Campaign handoff workstream" className={inputClass} value={workstreamId} disabled={!service||uncertain||Boolean(confirmed)||busy} onChange={e=>edit(setWorkstreamId,e.target.value)}><option value="">Choose matching project workstream</option>{workstreams.map(x=><option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
      <label className="text-xs text-slate-400">Request title<input aria-label="Campaign handoff title" className={inputClass} maxLength="240" value={title} disabled={!approval||uncertain||Boolean(confirmed)||busy} onInput={e=>edit(setTitle,e.target.value)}/></label>
      <label className="text-xs text-slate-400 md:col-span-2">Requested output<textarea aria-label="Campaign handoff output" className={inputClass+' min-h-24'} maxLength="7500" value={output} disabled={!approval||uncertain||Boolean(confirmed)||busy} onInput={e=>edit(setOutput,e.target.value)}/></label>
    </div>
    {preview&&ready&&<p className="mt-4 text-xs text-slate-300">Confirm request to {service.service_catalog.name} / {workstream.name} for brief {brief.id}. Existing work stays intact.</p>}
    {uncertain&&<p role="status" className="mt-3 text-xs text-amber-300">Inputs are locked while the exact outcome is uncertain.</p>}
    {confirmed&&<p role="status" className="mt-3 text-xs text-emerald-300">Confirmed N3 request {confirmed.request_id}.</p>}
    {error&&<p role="alert" className="mt-3 text-xs text-red-300">{error}</p>}
    <div className="mt-4 flex gap-3"><button type="button" className={buttonClass} disabled={!ready||busy||uncertain||Boolean(confirmed)} onClick={()=>setPreview(true)}>Preview request</button>{uncertain&&<button type="button" className={buttonClass} disabled={busy} onClick={refresh}>Refresh exact status</button>}<button type="button" className={buttonClass} disabled={!ready||!preview||busy||Boolean(confirmed)} onClick={confirm}>Send internal N3 request</button></div>
  </section>
}
