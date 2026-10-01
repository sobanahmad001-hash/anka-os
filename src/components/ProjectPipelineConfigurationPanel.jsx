import _ProjectCampaignPlanningPanel from './ProjectCampaignPlanningPanel.jsx'
import _ProjectReportingBindingsPanel from './ProjectReportingBindingsPanel.jsx'
import _ProjectWebsitePagesPanel from './ProjectWebsitePagesPanel.jsx'
import {inspectPipelineStagePlan} from '../data/pipelineStageContracts.js'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useAuth } from '../context/AuthContext.jsx'
import { projectPipelineConfigurations } from '../data/projectPipelineConfigurations.js'
import { normalizeSelectedSteps, parseMicrousd, pipelineGroupView } from '../data/projectPipelineConfigurationsRepository.js'

const INPUT = 'w-full rounded-lg border border-[var(--anka-line)] bg-[var(--anka-surface)] px-3 py-2 text-sm text-[var(--anka-ink)] outline-none focus:border-[var(--anka-focus)]'
const money = micro => micro == null ? 'none' : '$' + (Number(micro) / 1000000).toFixed(2)
const summary = steps => steps?.length ? steps.map(step => step.key + ' ×' + step.quantity).join(', ') : 'none'

export default function ProjectPipelineConfigurationPanel(props) {
  const {user}=useAuth()
  return <ScopedProjectPipelineConfigurationPanel key={`${user?.id}:${props.organizationId}:${props.engagement.id}`} {...props} actorId={user?.id} />
}
// eslint-disable-next-line no-unused-vars -- JSX components are not counted by this lint configuration.
function ScopedProjectPipelineConfigurationPanel({ organizationId, engagement, services, membership, signal, actorId }) {
  const [records, setRecords] = useState({ available: [], publishedDefinitions: [], configurations: [], activations: [], groups: [] })
  const [publicationId, setPublicationId] = useState('')
  const [groupId,setGroupId]=useState(''),[groupName,setGroupName]=useState(''),[groupKind,setGroupKind]=useState('website'),[groupPreset,setGroupPreset]=useState(''),[groupReview,setGroupReview]=useState(null)
  const recoveryKey=`anka-pipeline-command:${actorId}:${organizationId}:${engagement.id}`
  const [pending,setPending]=useState(()=>{try { const value=JSON.parse(sessionStorage.getItem(recoveryKey)||'null');if (!value) return null;if (['group','configuration','activation'].includes(value.kind) && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value.requestId)) return value;return {kind:'unreadable',requestId:''} } catch {return {kind:'unreadable',requestId:''}}}); const flight=useRef(false),groupRequest=useRef('')
  const [quantities, setQuantities] = useState({})
  const [stageActions,setStageActions]=useState({}),[omissionReasons,setOmissionReasons]=useState({}),[stageValues,setStageValues]=useState({}),[stageArtifacts,setStageArtifacts]=useState([]),[artifactQuery,setArtifactQuery]=useState(''),[artifactPage,setArtifactPage]=useState({offset:0,has_more:false}),[artifactError,setArtifactError]=useState(''),[artifactLoading,setArtifactLoading]=useState(false)
  const artifactSequence=useRef(0),scopeActive=useRef(true)
  const [cost, setCost] = useState('0')
  const [creationReview,setCreationReview]=useState(null)
  const [preview, setPreview] = useState(null)
  const [acknowledged, setAcknowledged] = useState(false)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  let view
  try {view=pipelineGroupView(records,groupId)} catch (failure) {view={available:[],configurations:[],activations:[],error:failure.message}}
  const [childState,setChildState]=useState({groupId:'',website:false,marketing:false,resources:false})
  const childScope=useRef(childState)
  if(childScope.current.groupId!==groupId)childScope.current={groupId,website:false,marketing:false,resources:false}
  const childBlocked=childState.groupId===groupId&&(childState.website||childState.marketing||childState.resources)
  const nativeLocked=busy || Boolean(pending) || Boolean(view.error)
  const locked=nativeLocked || childBlocked

  const createRequest = useRef('')
  const activationRequest = useRef('')
  // Exact project-manager bindings are checked by the RPC, not inferred from an organization role.
  const canManage = Boolean(membership)
  const publication = view.available.find(row => row.id === publicationId)
  const definitionSteps = publication?.definition.steps || []
  const active = view.activations[0]
  const activeConfig = view.configurations.find(row => row.id === active?.configuration_id)
  const serviceIds = new Set(services.filter(row => ['planned', 'active'].includes(row.status)).map(row => row.service_id))
  const eligibleSteps = definitionSteps.filter(step => serviceIds.has(step.service_id))
  const aiSelected = eligibleSteps.some(step => (quantities[step.key] || stageActions[step.key]==='reuse') && ['ai_assisted', 'automatic'].includes(step.kind))
  const reviewSignature=JSON.stringify([actorId,organizationId,engagement.id,groupId,publicationId,publication?.definition,quantities,stageActions,omissionReasons,stageValues,stageArtifacts,cost,services,membership])
  const currentReviewSignature=useRef('');currentReviewSignature.current=reviewSignature
  const commandState=useRef(null);commandState.current={pending,locked,nativeLocked,busy,loading,preview,acknowledged,reviewSignature,groupSignature:JSON.stringify([groupName.trim(),groupKind,groupPreset]),configIds:view.configurations.map(row=>row.id)}

  const reportChildBusy=useCallback((slot,value)=>{const current=childScope.current;if(!scopeActive.current||signal?.aborted||current.groupId!==groupId||current[slot]===Boolean(value))return;const next={...current,[slot]:Boolean(value)};childScope.current=next;setChildState(next);if(commandState.current)commandState.current.locked=commandState.current.nativeLocked||next.website||next.marketing||next.resources},[groupId,signal])
  const reportWebsiteBusy=useCallback(value=>reportChildBusy('website',value),[reportChildBusy])
  const reportMarketingBusy=useCallback(value=>reportChildBusy('marketing',value),[reportChildBusy])
  const reportResourcesBusy=useCallback(value=>reportChildBusy('resources',value),[reportChildBusy])

  const refresh = useCallback(async () => {
    setCreationReview(null);setPreview(null); setAcknowledged(false); activationRequest.current = ''
    setLoading(true)
    try {
      const next = await projectPipelineConfigurations.list(organizationId, engagement.id, { signal })
      if (!signal?.aborted) {
        setRecords(next)
        setPending(current => {
          if (!current) return null
          const rows=current.kind==='group' ? next.groups : current.kind==='configuration' ? next.configurations : next.activations
          if ((rows || []).some(row => row.request_id===current.requestId && row[current.kind==='group' ? 'created_by' : current.kind==='configuration' ? 'configured_by' : 'activated_by']===actorId)) { sessionStorage.removeItem(recoveryKey); setNotice('Original command recovered from its immutable history. No second command was sent.'); return null }
          return current
        })
      }
    } catch (failure) {
      if (!signal?.aborted) setError(failure.message)
    } finally {
      if (!signal?.aborted) setLoading(false)
    }
  }, [organizationId, engagement.id, signal,recoveryKey,actorId])
  useEffect(() => { refresh() }, [refresh])
  async function searchArtifacts(offset=0) {
    if(signal?.aborted || commandState.current.locked || flight.current)return
    const attempt=++artifactSequence.current;setArtifactLoading(true);setArtifactError('');setCreationReview(null)
    try {const result=await projectPipelineConfigurations.listStageArtifacts?.(organizationId,engagement.id,{query:artifactQuery,offset,signal}) || {artifacts:[],offset,has_more:false}
      if(signal?.aborted || artifactSequence.current!==attempt)return
      setStageArtifacts(current=>[...new Map([...current,...result.artifacts].map(row=>[row.artifact_version_id,row])).values()]);setArtifactPage({offset:result.offset,has_more:result.has_more})
    } catch(failure){if(!signal?.aborted && artifactSequence.current===attempt)setArtifactError(failure.message)}
    finally {if(!signal?.aborted && artifactSequence.current===attempt)setArtifactLoading(false)}
  }
  useEffect(()=>{scopeActive.current=true;return()=>{scopeActive.current=false;artifactSequence.current++}},[])
  function editStage(setter,key,value){if(flight.current || commandState.current.locked || !scopeActive.current || signal?.aborted)return;createRequest.current='';setCreationReview(null);setter(current=>({...current,[key]:value}))}
  function changeStageAction(step,action){if(flight.current || commandState.current.locked || !scopeActive.current || signal?.aborted)return;editStage(setStageActions,step.key,action);setQuantities(current=>({...current,[step.key]:action==='run' ? current[step.key] || '1' : ''}))}
  function changeStageValue(stepKey,inputKey,value){if(flight.current || commandState.current.locked || !scopeActive.current || signal?.aborted)return;createRequest.current='';setCreationReview(null);setStageValues(current=>({...current,[stepKey]:{...current[stepKey],[inputKey]:value}}))}


  function persistPending(record) {
    if (!actorId) throw new Error('Current actor identity is required')
    const encoded=JSON.stringify(record)
    sessionStorage.setItem(recoveryKey,encoded)
    if (sessionStorage.getItem(recoveryKey)!==encoded) throw new Error('Scoped command recovery must be available before saving')
    setPending(record)
  }
  function clearPending() { sessionStorage.removeItem(recoveryKey);setPending(null) }
  function changeSelection(key, raw) {
    if(flight.current || commandState.current.locked || !scopeActive.current || signal?.aborted)return
    setCreationReview(null)
    createRequest.current = ''
    setQuantities(current => {
      const next = { ...current, [key]: raw }
      if (!definitionSteps.some(step => next[step.key] && ['ai_assisted', 'automatic'].includes(step.kind))) setCost('0')
      return next
    })
  }
  function changePublication(id) {
    if(flight.current || commandState.current.locked || !scopeActive.current || signal?.aborted)return
    setCreationReview(null)
    createRequest.current = ''
    setPublicationId(id)
    setQuantities({});setStageActions({});setOmissionReasons({});setStageValues({})
    setCost('0')
  }
  function inspectCreation(event) {
    event.preventDefault()
    if (flight.current || !scopeActive.current || signal?.aborted || commandState.current.locked || commandState.current.loading || !publication) return
    setCreationReview(null);setError('');setNotice('')
    try {
      const declared=definitionSteps.some(step=>step.stage_contract!==undefined)
      const stagePlan=inspectPipelineStagePlan(definitionSteps,quantities,stageActions,omissionReasons,stageValues,stageArtifacts)
      const selectedSteps = declared ? stagePlan.selectedSteps : normalizeSelectedSteps(definitionSteps, quantities)
      if (selectedSteps.some(selected => !serviceIds.has(definitionSteps.find(step => step.key === selected.key)?.service_id)))
        throw new TypeError('A selected service is not active in this project')
      const micro = parseMicrousd(cost)
      if ((aiSelected && micro === 0) || (!aiSelected && micro !== 0))
        throw new TypeError('AI-capable steps need a positive local limit; human-only plans use zero')
      setCreationReview({signature:reviewSignature,selectedSteps,micro,stagePlan,stageDecisions:declared ? stagePlan.decisions : undefined,definitionPublicationId:publicationId,pipelineGroupId:groupId||null})
    } catch (failure) {setError(failure.message)}
  }
  async function save() {
    if (flight.current || !scopeActive.current || signal?.aborted || commandState.current.locked || commandState.current.loading || !creationReview || !creationReview.stagePlan.ready || creationReview.signature!==currentReviewSignature.current || signal?.aborted) return
    flight.current=true
    setBusy(true); setError(''); setNotice('')
    try {
      const {selectedSteps,micro}=creationReview
      createRequest.current ||= crypto.randomUUID()
      persistPending({kind:'configuration',requestId:createRequest.current})
      const saved = await projectPipelineConfigurations.create({
        organizationId, engagementId: engagement.id, definitionPublicationId: creationReview.definitionPublicationId,pipelineGroupId:creationReview.pipelineGroupId,
        requestId: createRequest.current, selectedSteps,stageDecisions:creationReview.stageDecisions, maxAiCostMicrousd: micro,
      }, { signal })
      if (signal?.aborted) return
      createRequest.current = ''; clearPending();setCreationReview(null)
      setNotice('Configuration revision ' + (saved.group_revision || saved.revision) + ' saved as a draft. Review impact before activation.')
      await refresh()
    } catch (failure) {
      if (!signal?.aborted) {if (failure.knownRollback) clearPending();setError(failure.message)}
    } finally {
      flight.current=false
      if (!signal?.aborted) setBusy(false)
    }
  }
  async function review(configurationId) {
    if (flight.current || !scopeActive.current || signal?.aborted || commandState.current.locked || !commandState.current.configIds.includes(configurationId)) return
    flight.current=true
    setBusy(true); setError(''); setNotice('')
    setCreationReview(null);setPreview(null); setAcknowledged(false); activationRequest.current = ''
    try {
      const impact = await projectPipelineConfigurations.preview(organizationId, configurationId, { signal })
      if (!signal?.aborted) setPreview(impact)
    } catch (failure) {
      if (!signal?.aborted) {if (failure.knownRollback) clearPending();setError(failure.message)}
    } finally {
      flight.current=false
      if (!signal?.aborted) setBusy(false)
    }
  }
  async function activate() {
    if (flight.current || !scopeActive.current || signal?.aborted || commandState.current.locked || !preview || !commandState.current.acknowledged || commandState.current.preview?.configuration_id!==preview.configuration_id || commandState.current.preview?.impact_token_sha256!==preview.impact_token_sha256) return
    flight.current=true
    setBusy(true); setError(''); setNotice('')
    try {
      activationRequest.current ||= crypto.randomUUID()
      persistPending({kind:'activation',requestId:activationRequest.current})
      const result = await projectPipelineConfigurations.activate({
        organizationId, configurationId: preview.configuration_id, requestId: activationRequest.current,
        impactToken: preview.impact_token_sha256, acknowledged,
      }, { signal })
      if (signal?.aborted) return
      activationRequest.current = ''; clearPending()
      setPreview(null); setAcknowledged(false)
      setNotice('Pipeline configuration activated as version ' + (result.group_activation_number || result.activation_number) + '. Existing work and jobs remain intact.')
      await refresh()
    } catch (failure) {
      if (!signal?.aborted) {if (failure.knownRollback) clearPending();setError(failure.message)}
    } finally {
      flight.current=false
      if (!signal?.aborted) setBusy(false)
    }
  }
  async function createGroup() {
    if (flight.current || !scopeActive.current || signal?.aborted || commandState.current.locked || !groupReview || JSON.stringify([groupReview.name,groupReview.kind,groupReview.preset])!==commandState.current.groupSignature) return
    flight.current=true;setBusy(true);setError('');setNotice('')
    try {
      groupRequest.current ||= crypto.randomUUID()
      persistPending({kind:'group',requestId:groupRequest.current})
      const result=await projectPipelineConfigurations.createGroup({organizationId,engagementId:engagement.id,presetPublicationId:groupReview.preset,kind:groupReview.kind,name:groupReview.name,requestId:groupRequest.current},{signal})
      if (signal?.aborted) return
      clearPending();groupRequest.current='';setGroupReview(null)
      await refresh()
      if (!signal?.aborted) { setGroupId(result.group.id);setPublicationId('');setQuantities({});setStageActions({});setOmissionReasons({});setStageValues({});setCost('0');setCreationReview(null);setNotice('Independent '+result.group.name+' pipeline created. Choose steps and review activation separately.') }
    } catch (failure) { if (!signal?.aborted) {if (failure.knownRollback) clearPending();setError(failure.message)} }
    finally { flight.current=false;if (!signal?.aborted) setBusy(false) }
  }
  function chooseGroup(value) { if (commandState.current.locked || flight.current || !scopeActive.current || signal?.aborted) return;setGroupId(value);changePublication('');setPreview(null);setAcknowledged(false);activationRequest.current='' }
  const presets=[...new Map((records.publishedDefinitions || []).map(row => [row.definition.preset_publication_id,row.definition])).values()]
  return <section className="rounded-2xl border border-[var(--anka-line)] bg-[var(--anka-surface)] p-5" aria-labelledby="project-config-heading">
    <div className="flex items-start justify-between gap-3"><div>
      <h2 id="project-config-heading" className="font-semibold">Project pipeline configuration</h2>
      <p className="mt-1 text-xs text-[var(--anka-muted)]">Exact project managers and owner/admin may choose steps, review impact, and activate a draft. This does not start AI work.</p>
    </div><button type="button" onClick={()=>{const child=childScope.current;if(!flight.current&&!commandState.current.busy&&!child.website&&!child.marketing&&!child.resources&&!signal?.aborted&&scopeActive.current)void refresh()}} disabled={busy||childBlocked} className="text-xs text-[var(--anka-violet)] disabled:opacity-40">Refresh</button></div>
    {view.error && <p role="alert">{view.error}. No other pipeline was selected.</p>}
    {error && <p role="alert" className="mt-3 text-sm text-[var(--anka-danger)]">{error}</p>}
    {pending && <p role="status" className="mt-3 text-[var(--anka-warning)]">The original command needs history reconciliation. Refresh inspects its exact request; editing and new commands stay blocked.</p>}
    {notice && <p role="status" className="mt-3 text-sm text-[var(--anka-success)]">{notice}</p>}
    {loading ? <p className="mt-4 text-sm text-[var(--anka-muted)]">Loading project configurations…</p> : <>
      <label className="mt-4 block text-xs text-[var(--anka-muted)]">Pipeline
        <select aria-label="Pipeline selection" className={INPUT} value={groupId} disabled={locked} onChange={event=>chooseGroup(event.target.value)}>
          <option value="">Legacy · preserved existing history</option>
          {(records.groups || []).map(group=><option key={group.id} value={group.id}>{group.name} · {group.kind==='website' ? 'Website' : 'Marketing'}</option>)}
        </select>
      </label>
      <p className="mt-4 text-xs text-[var(--anka-muted)]">{activeConfig ? 'Active revision ' + (activeConfig.group_revision || activeConfig.revision) + ' · ' + summary(activeConfig.selected_steps) + ' · local AI limit ' + money(activeConfig.max_ai_cost_microusd) : 'No project configuration is active.'}</p>
      {view.configurations.length > 0 && <div className="mt-4 space-y-2">{view.configurations.map(row => {
        const activated = view.activations.some(item => item.configuration_id === row.id)
        return <div key={row.id} className="rounded-lg border border-[var(--anka-line)] p-3 text-xs text-[var(--anka-ink)]">
          <p>Revision {row.group_revision || row.revision} · {activated ? 'activated' : 'draft'} · {summary(row.selected_steps)}</p>
          <p className="mt-1 text-[var(--anka-muted)]">Local AI limit {money(row.max_ai_cost_microusd)}</p>
          {row.stage_review && <details className="mt-2"><summary>Reviewed stage sources and omissions</summary>{row.stage_review.decisions.filter(item=>['reuse','omit'].includes(item.action)).map(item=><p key={item.key}>{item.key}: {item.action==='omit' ? 'omitted · '+item.reason : 'satisfied by exact version '+item.artifact_version_id}</p>)}</details>}
          {canManage && !activated && <button type="button" disabled={locked} onClick={() => review(row.id)} className="mt-2 text-[var(--anka-violet)] disabled:opacity-40">Review activation impact</button>}
        </div>
      })}</div>}
      {preview && <div className="mt-4 rounded-lg border border-[var(--anka-warning)] bg-[var(--anka-warning-soft)] p-3 text-xs text-[var(--anka-ink)]">
        <h3 className="font-semibold text-[var(--anka-warning)]">Activation impact review</h3>
        <p className="mt-2">Current: {summary(preview.previous_selected_steps)} · {money(preview.previous_max_ai_cost_microusd)}</p>
        <p className="mt-1">New: {summary(preview.new_selected_steps)} · {money(preview.new_max_ai_cost_microusd)}</p>
        <p className="mt-1">Added: {preview.added_step_keys?.join(', ') || 'none'} · Removed: {preview.removed_step_keys?.join(', ') || 'none'}</p>
        <p className="mt-1">Existing jobs preserved: {preview.existing_jobs_preserved}. Existing work remains intact.</p>
        {preview.stage_review && <details className="mt-2"><summary>Exact reviewed stage decisions</summary>{preview.stage_review.decisions.map(item=><p key={item.key}>{item.key}: {item.action==='omit' ? 'omitted · '+item.reason : item.action==='reuse' ? 'existing approved version '+item.artifact_version_id : item.action==='run' ? 'included ×'+item.quantity : 'outside selected service scope'}</p>)}</details>}
        <label className="mt-3 flex items-start gap-2"><input type="checkbox" disabled={locked} checked={acknowledged} onChange={event => setAcknowledged(event.target.checked)} />I reviewed this exact impact and approve activation.</label>
        <button type="button" disabled={locked || !acknowledged} onClick={activate} className="mt-3 rounded-lg bg-[var(--anka-violet)] px-3 py-2 font-semibold text-[var(--anka-on-violet)] disabled:opacity-40">Activate reviewed configuration</button>
      </div>}
      {canManage && <fieldset disabled={locked}><form onSubmit={inspectCreation} className="mt-5 space-y-3 border-t border-[var(--anka-line)] pt-4">
        <h3 className="text-sm font-semibold">Draft a new revision</h3>
        <label className="block text-xs text-[var(--anka-muted)]">Published execution definition
          <select required className={INPUT} value={publicationId} onChange={event => changePublication(event.target.value)}>
            <option value="">Choose a definition</option>
            {view.available.map(row => <option key={row.id} value={row.id}>{row.definition.name} · v{row.definition.version_number}</option>)}
          </select>
        </label>
        {publication && <div className="space-y-3">{definitionSteps.map(step=>{const contract=step.stage_contract,action=stageActions[step.key] || (quantities[step.key] ? 'run' : 'outside_scope');const sources=stageArtifacts.filter(row=>row.artifact_type===contract?.artifact_type && row.output_type===contract?.output_type);return <fieldset key={step.key} className="space-y-2 rounded-lg border border-[var(--anka-line)] p-3 text-xs text-[var(--anka-ink)]">
          <legend className="px-1 font-medium">{step.label}</legend><p>{step.kind.replaceAll('_',' ')}{step.depends_on?.length ? ' · after '+step.depends_on.join(', ') : ''}{!serviceIds.has(step.service_id) ? ' · service unavailable' : ''}</p>
          {contract && <><p>Output: {contract.output_label}</p><label className="block">Stage decision<select aria-label={step.label+' decision'} className={INPUT} value={action} disabled={!serviceIds.has(step.service_id)} onChange={event=>changeStageAction(step,event.target.value)}><option value="outside_scope">Outside this pipeline's selected services</option><option value="run">Include work</option>{contract.optional && <option value="omit">Omit optional stage with reason</option>}{contract.reuse_allowed && step.kind!=='approval_gate' && <option value="reuse">Satisfied by an exact approved version</option>}</select></label></>}
          {(!contract || action==='run') && <label className="flex items-center justify-between gap-3">Quantity<input aria-label={step.label+' quantity'} type="number" min="1" max="50" placeholder="Off" disabled={!serviceIds.has(step.service_id)} className="w-16 shrink-0 rounded border border-[var(--anka-line)] bg-[var(--anka-surface)] p-1 text-[var(--anka-ink)]" value={quantities[step.key] ?? ''} onChange={event=>changeSelection(step.key,event.target.value)} /></label>}
          {action==='omit' && <label className="block">Omission reason<textarea aria-label={step.label+' omission reason'} className={INPUT} maxLength={1000} value={omissionReasons[step.key]||''} onChange={event=>editStage(setOmissionReasons,step.key,event.target.value)} /></label>}
          {action==='reuse' && <label className="block">Exact approved version<select aria-label={step.label+' approved version'} className={INPUT} value={stageValues[step.key]?.artifact_version_id||''} onChange={event=>changeStageValue(step.key,'artifact_version_id',event.target.value)}><option value="">Find and choose an approved version below</option>{sources.map(source=><option key={source.artifact_version_id} value={source.artifact_version_id}>{source.title} · v{source.version_number} · {source.artifact_version_id}</option>)}</select><span>Uses the existing immutable version. No new output, approval, delivery or provider request is created.</span></label>}
          {action==='run' && (contract?.required_inputs||[]).map(required=><label key={required.key} className="block">Required input: {required.label}{required.kind==='manual' ? <textarea aria-label={step.label+' input '+required.label} maxLength={1000} className={INPUT} value={stageValues[step.key]?.[required.key]||''} onChange={event=>changeStageValue(step.key,required.key,event.target.value)} /> : <select aria-label={step.label+' input '+required.label} className={INPUT} value={stageValues[step.key]?.[required.key]||''} onChange={event=>changeStageValue(step.key,required.key,event.target.value)}><option value="">Choose exact approved input</option>{stageArtifacts.filter(row=>row.artifact_type===required.artifact_type && row.output_type===required.output_type && (!['ai_assisted','automatic'].includes(step.kind) || row.ai_use_allowed===true)).map(source=><option key={source.artifact_version_id} value={source.artifact_version_id}>{source.title} · v{source.version_number} · {source.artifact_version_id}</option>)}</select>}</label>)}
        </fieldset>})}
        {definitionSteps.some(step=>step.stage_contract?.reuse_allowed || step.stage_contract?.required_inputs?.some(input=>input.kind==='approved_artifact')) && <section aria-label="Find approved stage sources" className="space-y-2 rounded-lg border border-[var(--anka-line)] p-3 text-xs"><label className="block">Find an approved artifact by title or exact version<input aria-label="Approved stage artifact search" maxLength={120} className={INPUT} value={artifactQuery} onChange={event=>{if(flight.current || commandState.current.locked || !scopeActive.current || signal?.aborted)return;setArtifactQuery(event.target.value)}} /></label><button type="button" className="workspace-button" disabled={artifactLoading} onClick={()=>searchArtifacts(0)}>Find approved versions</button>{artifactError && <p role="alert">{artifactError}</p>}<p>{artifactLoading ? 'Checking current project sources…' : stageArtifacts.length+' exact approved versions loaded. Confirmation rechecks their current approval.'}</p>{artifactPage.offset>0 && <button type="button" className="workspace-button" disabled={artifactLoading} onClick={()=>searchArtifacts(Math.max(0,artifactPage.offset-25))}>Previous source page</button>}{artifactPage.has_more && <button type="button" className="workspace-button" disabled={artifactLoading} onClick={()=>searchArtifacts(artifactPage.offset+25)}>Next source page</button>}</section>}
        </div>}
        <label className="block text-xs text-[var(--anka-muted)]">Local AI cost limit (USD)
          <input required inputMode="decimal" className={INPUT} value={cost} onChange={event => { if(flight.current || commandState.current.locked || !scopeActive.current || signal?.aborted)return;setCreationReview(null);createRequest.current = ''; setCost(event.target.value) }} disabled={!aiSelected} />
          <span className="mt-1 block text-[var(--anka-muted)]">{aiSelected ? 'A positive limit is required for AI-capable steps; this does not authorize provider use.' : 'Human-only plans use zero.'}</span>
        </label>
        <button type="submit" disabled={locked || !publication} className="rounded-lg bg-[var(--anka-violet)] px-3 py-2 text-xs font-semibold text-[var(--anka-on-violet)] disabled:opacity-40">Preview stages before creation</button>
      </form>
      {creationReview && creationReview.signature===reviewSignature && <section aria-label="Review pipeline stages" className="mt-4 space-y-3 rounded-lg border border-[var(--anka-line)] bg-[var(--anka-surface-raised)] p-3 text-sm">
        <h3 className="font-semibold">Review this exact draft</h3>
        <p>{view.group?.name || 'Legacy'} · {publication.definition.name} · v{publication.definition.version_number} · local AI limit {money(creationReview.micro)}</p>
        <ol className="space-y-3">{creationReview.stagePlan.rows.map(({step,contract,action,source,inputs})=>{const selected=creationReview.selectedSteps.find(item=>item.key===step.key);return <li key={step.key} className="rounded border border-[var(--anka-line)] p-2">
          <p className="font-medium">{step.label} · {action==='reuse' ? 'Satisfied by approved source' : action==='omit' ? 'Optional stage omitted' : selected ? `Included ×${selected.quantity}` : 'Outside this draft'}</p>
          <p>Dependencies: {step.depends_on?.join(', ') || 'none'}</p><p>Output: {contract?.output_label || 'not specified by this published definition.'}</p>
          {contract ? inputs.map(input=><p key={input.required.key} className={input.missing ? 'text-[var(--anka-warning)]' : ''}>{input.required.label}: {input.missing ? 'Missing or incompatible input' : input.source ? input.source.title+' · v'+input.source.version_number+' · '+input.source.artifact_version_id : input.value}</p>) : <p>Required inputs: not specified by this published definition. Review linked records before activation.</p>}
          {contract && action==='run' && !contract.required_inputs.length && <p>Required inputs: none declared.</p>}
          {action==='omit' && <p>Reason: {omissionReasons[step.key] || 'Missing omission reason'}</p>}
          {source && <p>{source.title} · exact v{source.version_number} · {source.artifact_version_id}</p>}
          {!serviceIds.has(step.service_id) && <p className="text-[var(--anka-warning)]">Missing eligible planned or active service.</p>}
        </li>})}</ol>
        {creationReview.stagePlan.errors.length>0 && <ul role="alert" className="space-y-1 text-[var(--anka-warning)]">{creationReview.stagePlan.errors.map((message,n)=><li key={n}>{message}</li>)}</ul>}
        <p>This saves a draft only. Activation, work planning, assignment and provider use require their separate reviews.</p>
        <button type="button" disabled={locked || !creationReview.stagePlan.ready} onClick={save} className="workspace-button workspace-button-primary">Confirm draft revision</button>
      </section>}</fieldset>}
      {canManage && <details className="mt-4 border-t border-[var(--anka-line)] pt-4"><summary>Create an independent pipeline</summary><fieldset disabled={locked} className="mt-3 space-y-3">
        <label className="block text-xs">Pipeline kind<select aria-label="Pipeline kind" className={INPUT} value={groupKind} onChange={event=>{setGroupKind(event.target.value);setGroupReview(null);groupRequest.current=''}}><option value="website">Website</option><option value="marketing">Marketing</option></select></label>
        <label className="block text-xs">Pipeline name<input aria-label="Pipeline name" className={INPUT} maxLength={80} value={groupName} onChange={event=>{setGroupName(event.target.value);setGroupReview(null);groupRequest.current=''}} /></label>
        <label className="block text-xs">Published preset<select aria-label="Independent pipeline preset" className={INPUT} value={groupPreset} onChange={event=>{setGroupPreset(event.target.value);setGroupReview(null);groupRequest.current=''}}><option value="">Choose an explicit published preset</option>{presets.map(definition=><option key={definition.preset_publication_id} value={definition.preset_publication_id}>{definition.name} · execution v{definition.version_number}</option>)}</select></label>
        <button type="button" className="workspace-button" disabled={!groupPreset || !groupName.trim()} onClick={()=>setGroupReview({name:groupName.trim(),kind:groupKind,preset:groupPreset})}>Review pipeline creation</button>
        {groupReview && <section aria-label="Review independent pipeline" className="rounded-lg border border-[var(--anka-line)] bg-[var(--anka-surface-raised)] p-3 space-y-2"><p>{groupReview.name} · {groupReview.kind==='website' ? 'Website' : 'Marketing'} · {presets.find(row=>row.preset_publication_id===groupReview.preset)?.name}</p><p>Preserves Legacy and other pipelines. Creates no work, activation, publication or provider request. Services and steps are selected in a separate draft.</p><button type="button" className="workspace-button workspace-button-primary" onClick={createGroup}>Confirm independent pipeline</button></section>}
      </fieldset></details>}
      {view.group?.kind==='website' && engagement.project_id && <_ProjectWebsitePagesPanel onNavigationBusyChange={reportWebsiteBusy} organizationId={organizationId} engagement={engagement} group={view.group} membership={membership} signal={signal} />}
      {view.group?.kind==='marketing' && engagement.project_id && <_ProjectCampaignPlanningPanel onNavigationBusyChange={reportMarketingBusy} organizationId={organizationId} engagement={engagement} group={view.group} membership={membership} signal={signal} /> }
      {['website','marketing'].includes(view.group?.kind) && engagement.project_id && <_ProjectReportingBindingsPanel onNavigationBusyChange={reportResourcesBusy} organizationId={organizationId} engagement={engagement} group={view.group} membership={membership} signal={signal} />}
      {!view.available.length && <p className="mt-4 text-xs text-[var(--anka-muted)]">This project has no matching published execution definition yet.</p>}
    </>}
  </section>
}
