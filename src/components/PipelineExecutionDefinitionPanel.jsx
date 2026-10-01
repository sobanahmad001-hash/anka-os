import {STAGE_ARTIFACT_TYPES} from '../data/pipelineStageContracts.js'
import { useCallback, useEffect, useRef, useState } from 'react'

import {useAuth} from '../context/AuthContext.jsx'

import { pipelineExecutionDefinitions } from '../data/pipelineExecutionDefinitions.js'

const INPUT = 'w-full rounded-lg border border-[var(--anka-line)] bg-[var(--anka-surface)] px-3 py-2 text-sm text-[var(--anka-ink)] outline-none focus:border-violet-500/60'
const EMPTY_STEP = () => ({ key: '', label: '', kind: 'human', service_id: '', department_id: '', depends_on: [] })
const KINDS = [
  ['human', 'Human'], ['ai_assisted', 'AI-assisted'],
  ['automatic', 'Automatic'], ['approval_gate', 'Approval gate'],
]

export default function PipelineExecutionDefinitionPanel(props) {
  const {user}=useAuth()
  return <DefinitionEditor key={`${props.organizationId}/${user?.id}/${props.membership?.role}/${props.membership?.departmentId}`} {...props} actorId={user?.id} />
}

function DefinitionEditor({ organizationId, catalog, services, membership, signal, actorId }) {
  const [records, setRecords] = useState({ definitions: [], approvals: [], publications: [] })
  const [presetId, setPresetId] = useState('')
  const [name, setName] = useState('')
  const [steps, setSteps] = useState([EMPTY_STEP()])
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const recoveryKey=`anka:pipeline-definition:${organizationId}:${actorId}:v1`
  const [pendingRequest,setPendingRequest]=useState(()=>{try{const saved=sessionStorage.getItem(recoveryKey);return /^[0-9a-f-]{36}$/i.test(saved || '') ? saved : ''}catch{return ''}})
  const requestId = useRef(pendingRequest)
  const command = useRef({active:true,busy:false,unknown:Boolean(pendingRequest)})
  useEffect(()=>{command.current.active=true;const current=command.current;return ()=>{current.active=false}},[])
  function canEdit(){return command.current.active && !signal?.aborted && !command.current.busy && !command.current.unknown}
  function beginCommand(){if(!canEdit())return false;command.current.busy=true;setBusy(true);return true}
  const role = membership?.role
  const canDraft = Boolean(actorId) && ['system_owner', 'operations_admin', 'department_manager'].includes(role)
  const canPublish = ['system_owner', 'operations_admin'].includes(role)
  const publishedPreset = (catalog.publications || []).find(row => row.id === presetId)
  const eligibleServices = (catalog.selections || [])
    .filter(row => row.pipeline_template_version_id === publishedPreset?.pipeline_template_version_id)
    .map(row => services.find(service => service.id === row.service_id))
    .filter(service => service?.is_active)
  const serviceById = new Map(eligibleServices.map(service => [service.id, service]))

  const refresh = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const next = await pipelineExecutionDefinitions.list(organizationId, { signal })
      if (command.current.active && !signal?.aborted) {
        setRecords(next)
        const recovered=command.current.unknown && next.definitions.find(row=>row.request_id===requestId.current && row.created_by===actorId)
        if(recovered){sessionStorage.removeItem(recoveryKey);command.current.unknown=false;requestId.current='';setPendingRequest('');setName('');setSteps([EMPTY_STEP()]);setNotice(`Original execution definition v${recovered.version_number} recovered. Approval and publication remain separate.`)}
      }
    } catch (failure) {
      if (command.current.active && !signal?.aborted) setError(failure.message)
    } finally {
      if (command.current.active && !signal?.aborted) setLoading(false)
    }
  }, [organizationId, signal,actorId,recoveryKey])

  useEffect(() => { refresh() }, [refresh])

  function changePreset(value) {
    if(!canEdit())return
    requestId.current = ''
    setPresetId(value)
    setSteps([EMPTY_STEP()])
  }

  function changeStep(index, field, value) {
    if(!canEdit())return
    requestId.current = ''
    setSteps(current => {
      const priorKey = current[index].key
      return current.map((step, position) => {
        if (position !== index) {
          return field === 'key' && position > index
            ? { ...step, depends_on: step.depends_on.map(key => key === priorKey ? value : key) }
            : step
        }
        if (field === 'service_id') return {
          ...step, service_id: value, department_id: serviceById.get(value)?.department_id || '',
        }
        if(field==='kind' && value==='approval_gate' && step.stage_contract?.reuse_allowed){const {artifact_type:_type,output_type:_output,...contract}=step.stage_contract;return {...step,kind:value,stage_contract:{...contract,reuse_allowed:false}}}
        return { ...step, [field]: value }
      })
    })
  }

  function removeStep(index) {
    if(!canEdit())return
    requestId.current = ''
    setSteps(current => current.filter((_, position) => position !== index)
      .map(step => ({ ...step, depends_on: step.depends_on.filter(key => key !== current[index].key) })))
  }

  async function create(event) {
    event.preventDefault()
    if(!beginCommand())return
    requestId.current ||= crypto.randomUUID()
    setBusy(true); setError(''); setNotice('')
    try {
      try{sessionStorage.setItem(recoveryKey,requestId.current)}catch{throw new TypeError('Save cannot start until this browser can retain its recovery request.')}
      const result = await pipelineExecutionDefinitions.create({
        organizationId, presetPublicationId: presetId, requestId: requestId.current, name, steps,
      }, { signal })
      if (!command.current.active || signal?.aborted) return
      setNotice(`Execution definition v${result.version_number} saved. Department approval and publication are separate.`)
      sessionStorage.removeItem(recoveryKey)
      requestId.current = ''
      setName('')
      setSteps([EMPTY_STEP()])
      await refresh()
    } catch (failure) {
      if (command.current.active && !signal?.aborted) {
        const known=failure instanceof TypeError || /^[0-9A-Z]{5}$/.test(failure.code || '')
        if(known){try{sessionStorage.removeItem(recoveryKey)}catch{/* No command was started if retention failed. */}requestId.current=''}
        else{command.current.unknown=true;setPendingRequest(requestId.current)}
        setError(known ? failure.message : 'The original save outcome is unknown. Refresh reads its exact request; editing and another save stay blocked.')
      }
    } finally {
      command.current.busy=false
      if (command.current.active && !signal?.aborted) setBusy(false)
    }
  }

  async function act(action, definitionId) {
    if(!beginCommand())return
    setBusy(true); setError(''); setNotice('')
    try {
      if (action === 'approve') {
        await pipelineExecutionDefinitions.approve({
          definitionId, departmentId: membership.departmentId,
        }, { signal })
        setNotice('Exact execution definition approval recorded.')
      } else {
        await pipelineExecutionDefinitions.publish(definitionId, { signal })
        setNotice('Exact execution definition published. Project activation remains separate.')
      }
      if (command.current.active && !signal?.aborted) await refresh()
    } catch (failure) {
      if (command.current.active && !signal?.aborted) setError(failure.message)
    } finally {
      command.current.busy=false
      if (command.current.active && !signal?.aborted) setBusy(false)
    }
  }

  return <section className="mt-7 rounded-2xl border border-[var(--anka-line)] bg-[var(--anka-surface)] p-5" aria-labelledby="execution-definitions-heading">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><h2 id="execution-definitions-heading" className="font-semibold">Pipeline execution steps</h2>
        <p className="mt-1 text-xs text-[var(--anka-muted)]">Define ordered work separately from service presets. Saving or publishing never starts a run.</p></div>
      <button type="button" onClick={refresh} disabled={busy} className="rounded-lg border border-[var(--anka-line)] px-3 py-2 text-xs font-semibold disabled:opacity-40">Refresh</button>
    </div>
    {error && <p role="alert" className="mt-3 text-sm text-red-300">{error}</p>}
    {pendingRequest && <p role="status" className="mt-3 break-all text-sm text-[var(--anka-muted)]">Unresolved original save request: {pendingRequest}. Refresh checks its exact immutable record without another write.</p>}
    {notice && <p role="status" className="mt-3 text-sm text-emerald-300">{notice}</p>}
    {loading ? <p className="mt-4 text-sm text-[var(--anka-muted)]">Loading execution definitions…</p>
      : <div className="mt-4 space-y-2">
        {records.definitions.length === 0 && <p className="text-sm text-[var(--anka-muted)]">No execution definitions yet. Existing presets remain service selections only.</p>}
        {records.definitions.map(definition => {
          const published = records.publications.some(row => row.definition_id === definition.id)
          const departments = [...new Set(definition.steps.map(step => step.department_id))]
          const signed = new Set(records.approvals.filter(row => row.definition_id === definition.id).map(row => row.department_id))
          const preset = catalog.publications?.find(row => row.id === definition.preset_publication_id)
          const presetName = catalog.versions?.find(row => row.id === preset?.pipeline_template_version_id)?.name || 'Published preset'
          return <article key={definition.id} className="rounded-xl border border-[var(--anka-line)] bg-[var(--anka-surface-raised)] p-3 text-sm">
            <p className="font-medium">{definition.name} · v{definition.version_number} <span className="text-xs text-[var(--anka-muted)]">{published ? 'Published' : 'Draft'}</span></p>
            <p className="mt-1 text-xs text-[var(--anka-muted)]">{presetName} · {definition.steps.length} ordered steps · {definition.steps_sha256.slice(0, 12)}</p>
            <ol className="mt-2 list-decimal space-y-1 pl-5 text-xs text-[var(--anka-ink)]">{definition.steps.map(step =>
              <li key={step.key}>{step.label} · {step.kind.replaceAll('_', ' ')} · {step.department_id}{step.depends_on.length ? ` · after ${step.depends_on.join(', ')}` : ''}</li>)}</ol>
            <p className="mt-2 text-xs text-[var(--anka-muted)]">Head signoffs: {departments.map(department => `${department} ${signed.has(department) ? 'recorded' : 'pending'}`).join(' · ')}. Current roles are rechecked at publication.</p>
            {!published && <div className="mt-3 flex gap-2">
              {role === 'department_manager' && departments.includes(membership.departmentId) && <button type="button" disabled={busy || Boolean(pendingRequest)} onClick={() => act('approve', definition.id)} className="rounded-lg border border-violet-500/40 px-3 py-1.5 text-xs text-[var(--anka-accent)] disabled:opacity-40">Approve for {membership.departmentId}</button>}
              {canPublish && <button type="button" disabled={busy || Boolean(pendingRequest)} onClick={() => act('publish', definition.id)} className="rounded-lg bg-violet-500 px-3 py-1.5 text-xs text-white disabled:opacity-40">Publish exact version</button>}
            </div>}
          </article>
        })}
      </div>}
    {canDraft && <form onSubmit={create} className="mt-6 border-t border-[var(--anka-line)] pt-5"><fieldset disabled={busy || Boolean(pendingRequest)} className="space-y-4">
      <h3 className="text-sm font-semibold">Draft an immutable execution version</h3>
      <label className="block text-xs text-[var(--anka-muted)]">Published service preset
        <select aria-label="Definition published preset" required className={INPUT} value={presetId} onChange={event => changePreset(event.target.value)}>
          <option value="">Choose a published preset</option>
          {(catalog.publications || []).map(preset => {
            const version = catalog.versions?.find(row => row.id === preset.pipeline_template_version_id)
            return <option key={preset.id} value={preset.id}>{version?.name || 'Preset'} · v{version?.version_number || '?'}</option>
          })}
        </select>
      </label>
      <label className="block text-xs text-[var(--anka-muted)]">Execution version name
        <input aria-label="Execution version name" required maxLength={160} className={INPUT} value={name} onChange={event => { if(!canEdit())return;requestId.current = ''; setName(event.target.value) }} />
      </label>
      <div className="space-y-3">{steps.map((step, index) => <fieldset key={index} className="rounded-xl border border-[var(--anka-line)] p-3">
        <legend className="px-1 text-xs font-semibold text-[var(--anka-accent)]">Step {index + 1}</legend>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-xs text-[var(--anka-muted)]">Key<input aria-label={`Step ${index+1} key`} required pattern="[a-z][a-z0-9_]*" maxLength={64} className={INPUT} value={step.key} onChange={event => changeStep(index, 'key', event.target.value)} placeholder="draft_copy" /></label>
          <label className="text-xs text-[var(--anka-muted)]">Label<input aria-label={`Step ${index+1} label`} required maxLength={160} className={INPUT} value={step.label} onChange={event => changeStep(index, 'label', event.target.value)} placeholder="Draft copy" /></label>
          <label className="text-xs text-[var(--anka-muted)]">Kind<select aria-label={`Step ${index+1} kind`} className={INPUT} value={step.kind} onChange={event => changeStep(index, 'kind', event.target.value)}>{KINDS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          <label className="text-xs text-[var(--anka-muted)]">Service<select aria-label={`Step ${index+1} service`} required className={INPUT} value={step.service_id} onChange={event => changeStep(index, 'service_id', event.target.value)}><option value="">Choose a selected service</option>{eligibleServices.map(service => <option key={service.id} value={service.id}>{service.name} · {service.department_id}</option>)}</select></label>
        </div>
        {index > 0 && <div className="mt-3 text-xs text-[var(--anka-muted)]">Depends on earlier steps<div className="mt-1 flex flex-wrap gap-3">{steps.slice(0, index).filter(prior => prior.key).map(prior => <label key={prior.key} className="flex items-center gap-1"><input type="checkbox" checked={step.depends_on.includes(prior.key)} onChange={event => changeStep(index, 'depends_on', event.target.checked ? [...step.depends_on, prior.key] : step.depends_on.filter(key => key !== prior.key))} />{prior.label || prior.key}</label>)}</div></div>}
        <label className="mt-3 flex items-center gap-2 text-xs"><input aria-label={`Step ${index+1} declare output and inputs`} type="checkbox" checked={Boolean(step.stage_contract)} disabled={busy || Boolean(pendingRequest)} onChange={event=>changeStep(index,'stage_contract',event.target.checked ? {optional:false,output_label:'',reuse_allowed:false,required_inputs:[]} : undefined)} />Declare stage output and required inputs</label>
        {step.stage_contract && <fieldset disabled={busy || Boolean(pendingRequest)} className="mt-3 space-y-3 rounded-lg border border-[var(--anka-line)] bg-[var(--anka-surface)] p-3 text-[var(--anka-ink)]">
          <label className="block text-xs">Expected output<input aria-label={`Step ${index+1} expected output`} required maxLength={300} className={INPUT} value={step.stage_contract.output_label} onChange={event=>changeStep(index,'stage_contract',{...step.stage_contract,output_label:event.target.value})} /></label>
          <label className="flex items-center gap-2 text-xs"><input aria-label={`Step ${index+1} optional stage`} type="checkbox" checked={step.stage_contract.optional} onChange={event=>changeStep(index,'stage_contract',{...step.stage_contract,optional:event.target.checked})} />Optional stage · omission requires a reason and cannot bypass required dependencies</label>
          {step.kind!=='approval_gate' && <label className="flex items-center gap-2 text-xs"><input aria-label={`Step ${index+1} allow approved source`} type="checkbox" checked={step.stage_contract.reuse_allowed} onChange={event=>{const {artifact_type:_type,output_type:_output,...contract}=step.stage_contract;changeStep(index,'stage_contract',{...contract,reuse_allowed:event.target.checked,...(event.target.checked ? {artifact_type:'content',output_type:''} : {})})}} />An exact approved artifact version may satisfy this stage</label>}
          {step.stage_contract.reuse_allowed && <div className="grid gap-3 sm:grid-cols-2"><label className="text-xs">Output artifact type<select className={INPUT} value={step.stage_contract.artifact_type} onChange={event=>changeStep(index,'stage_contract',{...step.stage_contract,artifact_type:event.target.value})}>{STAGE_ARTIFACT_TYPES.map(type=><option key={type} value={type}>{type.replaceAll('_',' ')}</option>)}</select></label><label className="text-xs">Exact output type<input aria-label={`Step ${index+1} exact output type`} required maxLength={64} pattern="[a-z][a-z0-9_]*" className={INPUT} value={step.stage_contract.output_type} placeholder="blog_article" onChange={event=>changeStep(index,'stage_contract',{...step.stage_contract,output_type:event.target.value})} /></label></div>}
          {step.stage_contract.required_inputs.map((input,position)=><div key={position} className="space-y-2 rounded border border-[var(--anka-line)] p-2">
            <div className="grid gap-2 sm:grid-cols-2">{['key','label'].map(field=><label key={field} className="text-xs">Input {field}<input required maxLength={field==='key' ? 64 : 160} pattern={field==='key' ? '[a-z][a-z0-9_]*' : undefined} className={INPUT} value={input[field]} onChange={event=>changeStep(index,'stage_contract',{...step.stage_contract,required_inputs:step.stage_contract.required_inputs.map((item,n)=>n===position ? {...item,[field]:event.target.value} : item)})} /></label>)}</div>
            <label className="block text-xs">Input source<select className={INPUT} value={input.kind} onChange={event=>{const {artifact_type:_type,output_type:_output,...prior}=input;changeStep(index,'stage_contract',{...step.stage_contract,required_inputs:step.stage_contract.required_inputs.map((item,n)=>n===position ? {...prior,kind:event.target.value,...(event.target.value==='approved_artifact' ? {artifact_type:'content',output_type:''} : {})} : item)})}}><option value="manual">Manual value</option><option value="approved_artifact">Exact approved artifact version</option></select></label>
            {input.kind==='approved_artifact' && <div className="grid gap-2 sm:grid-cols-2"><label className="text-xs">Input artifact type<select className={INPUT} value={input.artifact_type} onChange={event=>changeStep(index,'stage_contract',{...step.stage_contract,required_inputs:step.stage_contract.required_inputs.map((item,n)=>n===position ? {...item,artifact_type:event.target.value} : item)})}>{STAGE_ARTIFACT_TYPES.map(type=><option key={type} value={type}>{type.replaceAll('_',' ')}</option>)}</select></label><label className="text-xs">Exact input output type<input required maxLength={64} pattern="[a-z][a-z0-9_]*" className={INPUT} value={input.output_type} onChange={event=>changeStep(index,'stage_contract',{...step.stage_contract,required_inputs:step.stage_contract.required_inputs.map((item,n)=>n===position ? {...item,output_type:event.target.value} : item)})} /></label></div>}
            <button type="button" className="workspace-button" onClick={()=>changeStep(index,'stage_contract',{...step.stage_contract,required_inputs:step.stage_contract.required_inputs.filter((_,n)=>n!==position)})}>Remove required input</button>
          </div>)}
          <button type="button" className="workspace-button" disabled={step.stage_contract.required_inputs.length>=8} onClick={()=>changeStep(index,'stage_contract',{...step.stage_contract,required_inputs:[...step.stage_contract.required_inputs,{key:'',label:'',kind:'manual'}]})}>Add required input</button>
          <p className="text-xs text-[var(--anka-muted)]">These declarations belong to this exact immutable definition. Current department approvals and publication are required before project use. Existing definitions retain unspecified metadata.</p>
        </fieldset>}
        {steps.length > 1 && <button type="button" onClick={() => removeStep(index)} className="mt-3 text-xs text-rose-300">Remove step</button>}
      </fieldset>)}</div>
      <div className="flex gap-2"><button type="button" disabled={steps.length >= 50} onClick={() => { if(!canEdit())return;requestId.current = ''; setSteps(current => [...current, EMPTY_STEP()]) }} className="rounded-lg border border-[var(--anka-line)] px-3 py-2 text-xs disabled:opacity-40">Add step</button>
        <button type="submit" disabled={busy || !presetId || !eligibleServices.length} className="rounded-lg bg-violet-500 px-4 py-2 text-xs font-semibold disabled:opacity-40">{busy ? 'Saving…' : 'Save draft version'}</button></div>
    </fieldset></form>}
  </section>
}