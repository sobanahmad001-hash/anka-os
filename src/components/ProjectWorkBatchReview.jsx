import {useEffect, useRef, useState} from 'react'
import {supabase} from '../lib/supabase.js'
import {createProjectPipelineWorkBatchesRepository} from '../data/projectPipelineWorkBatchesRepository.js'

function initialProposal(context) {
  const slots = context.stages.filter(stage => stage.action === 'run').flatMap(stage =>
    Array.from({length:stage.quantity}, (_, index) => {
      const instance = index + 1
      const prior = context.prior_slots.find(row => row.key === stage.key && row.instance === instance)
      return prior
        ? {key:stage.key, instance, action:'use_existing', work_item_id:prior.work_item_id, row_version:prior.row_version}
        : {key:stage.key, instance, action:'create_missing'}
    }))
  return {version:1, slots, dependencies:[], asset_links:context.asset_options.length ? slots.map(({key, instance}) => ({key, instance, kind:context.partition.kind, id:context.partition.id})) : []}
}

export default function ProjectWorkBatchReview({scope, partition, configurations, pageName, linkedWorkId, workRecords=[], signal, onBusy, onChanged, repository}) {
  const api = useRef(null)
  api.current ??= repository || createProjectPipelineWorkBatchesRepository(supabase)
  const storageKey = ['anka-work-batch', scope.actorId, scope.organizationId, scope.projectId, scope.engagementId].join(':')
  const [pending, setPending] = useState(() => {
    try { return JSON.parse(sessionStorage.getItem(storageKey)) }
    catch { return {unreadable:true} }
  })
  const resumeKey = target => [storageKey, 'draft', target.kind, target.id, target.architecture_version_id || ''].join(':')
  const [savedDraft, setSavedDraft] = useState(() => {
    try { return JSON.parse(sessionStorage.getItem(resumeKey(partition))) }
    catch { return null }
  })
  const [configuration, setConfiguration] = useState('')
  const [context, setContext] = useState(null)
  const [proposal, setProposal] = useState(null)
  const [lastResult, setLastResult] = useState(null)
  const [reviewed, setReviewed] = useState(null)
  const [versionReview, setVersionReview] = useState(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const flight = useRef(false)
  const active = useRef(false)
  const current = useRef(null)
  current.current = reviewed
  useEffect(() => { active.current = true; return () => { active.current = false } }, [])
  useEffect(() => { onBusy?.(busy || Boolean(pending)); return () => onBusy?.(false) }, [busy, pending, onBusy])
  const live = () => active.current && !signal?.aborted
  async function run(fn, recovering = false) {
    if (flight.current || !live() || (!recovering && sessionStorage.getItem(storageKey))) return
    flight.current = true
    setBusy(true)
    setMessage('')
    try { await fn() } catch (error) { if (live()) setMessage(error.message) }
    finally { flight.current = false; if (live()) setBusy(false) }
  }
  async function inspect(next, config = configuration) {
    current.current = null
    setVersionReview(null)
    setReviewed(null)
    setProposal(next)
    const response = await api.current.review(scope, config, partition, next, {signal})
    if (live()) { setLastResult(response.review); setReviewed(response) }
  }
  async function refreshForReview() {
    setVersionReview(null)
    const ids = proposal.slots.flatMap(slot => [slot.work_item_id, slot.previous_work_item_id]).filter(Boolean)
    const source = await api.current.context(scope, configuration, partition, {signal, workItemIds:[...new Set(ids)]})
    if (!live()) return
    setContext(source)
    const changes = []
    const slots = proposal.slots.map(slot => {
      const replacement = slot.action === 'create_replacement'
      const id = replacement ? slot.previous_work_item_id : slot.work_item_id
      if (!id) return slot
      const card = source.work_options.find(row => row.id === id)
      if (!card) throw Error('The selected card is unavailable. Choose a current card to continue.')
      if (replacement && !source.prior_slots.some(prior => prior.key === slot.key && prior.instance === slot.instance && prior.work_item_id === id)) {
        throw Error('The previous card for this slot changed. Reopen the configuration to review its current card.')
      }
      const field = replacement ? 'previous_row_version' : 'row_version'
      if (slot[field] === card.row_version) return slot
      changes.push({key:slot.key, instance:slot.instance, from:slot[field], to:card.row_version, id})
      return {...slot, [field]:card.row_version}
    })
    if (changes.length) {
      setVersionReview({changes, proposal:{...proposal, slots}})
      return
    }
    await inspect(proposal)
  }
  async function load(id) {
    setVersionReview(null)
    setConfiguration(id)
    setLastResult(null)
    setContext(null)
    setReviewed(null)
    current.current = null
    setProposal(null)
    if (!id) return
    const source = await api.current.context(scope, id, partition, {signal, workItemIds:linkedWorkId ? [linkedWorkId] : []})
    if (!live()) return
    setContext(source)
    await inspect(initialProposal(source), id)
  }
  function clearPending() {
    sessionStorage.removeItem(storageKey)
    setPending(null)
  }
  async function save() {
    if (pending || !reviewed?.review.can_apply || reviewed !== current.current || sessionStorage.getItem(storageKey)) return
    const original = {scope, reviewed, requestId:crypto.randomUUID()}
    sessionStorage.setItem(storageKey, JSON.stringify(original))
    setPending(original)
    try {
      const receipt = await api.current.apply(original.reviewed, original.requestId)
      if (!receipt?.atomic || receipt.request_id !== original.requestId || receipt.project_id !== scope.projectId || receipt.engagement_id !== scope.engagementId || receipt.organization_id !== scope.organizationId) throw Error("Check the original save before continuing.")
      clearPending()
      if (live()) { setReviewed(null); current.current=null; setConfiguration(''); setContext(null); setProposal(null); setMessage('Work cards saved.'); onChanged?.() }
    } catch (error) {
      if (error.knownRollback) { clearPending(); current.current=null; if(live()) setReviewed(null) }
      throw error
    }
  }
  async function recover() {
    if (!pending?.requestId || !pending.scope || Object.keys(scope).some(key => scope[key] !== pending.scope[key])) throw Error('Return to the original project and account to recover this save.')
    const outcome = await api.current.recover(pending.scope, pending.requestId)
    if (!live()) return
    if (!['applied','not_applied'].includes(outcome?.status)) throw Error('The original save is still unverified.')
    const original = pending.reviewed
    if (outcome.status === "applied" && (!outcome.original_result?.atomic || outcome.original_result.request_id !== pending.requestId)) throw Error("Original receipt could not be verified.")
    current.current=null
    setReviewed(null)
    const originalPartition = original.draft.p_partition
    const samePartition = resumeKey(originalPartition) === resumeKey(partition)
    if (outcome.status === 'not_applied' && !samePartition) {
      sessionStorage.setItem(resumeKey(originalPartition), JSON.stringify(original.draft))
    }
    if (outcome.status === 'not_applied' && samePartition) {
      setVersionReview(null)
      setConfiguration(original.draft.p_configuration_id)
      const frozen = original.draft
      setProposal(frozen.p_proposal)
    } else { setConfiguration(''); setContext(null); setProposal(null) }
    clearPending()
    if(outcome.status==='applied')onChanged?.()
    setMessage(outcome.status === 'applied' ? 'Original work-card save recovered.' : samePartition ? 'Original save was not applied. Review the cards again.' : 'Original save was not applied. Reopen its work scope to restore the original choices.')
  }
  const result = reviewed?.review || (proposal && context ? lastResult : null)
  const locked = busy || Boolean(pending)
  async function chooseExisting(slot, workId) {
    current.current=null
    setReviewed(null)
    const chosenIds=proposal.slots.map(row=>row.work_item_id||row.previous_work_item_id).filter(Boolean)
    const source=await api.current.context(scope, configuration, partition, {signal,workItemIds:[...new Set([...chosenIds,workId])]})
    if(!live())return
    const card=source.work_options.find(row=>row.id===workId)
    if(!card)throw Error("The selected card is unavailable. Review the current Work list.")
    setContext(source)
    await editSlot(slot,{action:"use_existing",work_item_id:card.id,row_version:card.row_version})
  }
  function editSlot(slot, changes) {
    const next = {...proposal, slots:proposal.slots.map(row => row.key===slot.key && row.instance===slot.instance ? {...row,...changes} : row)}
    return inspect(next)
  }
  return <section aria-label="Work card review" className="workspace-card space-y-3 p-4" style={{overflowWrap:'anywhere'}}>
    <h3>Work cards for {pageName}</h3>
    {savedDraft && !pending && <button type="button" disabled={busy} onClick={()=>{setConfiguration(savedDraft.p_configuration_id);setProposal(savedDraft.p_proposal);setContext(null);setLastResult(null);setReviewed(null);current.current=null;setVersionReview(null);sessionStorage.removeItem(resumeKey(partition));setSavedDraft(null)}}>Restore original choices</button>}
    {pending ? <><p>The original save needs recovery.</p><button type="button" className="workspace-button" disabled={busy||pending.unreadable} onClick={()=>run(recover,true)}>Check original save</button></> :
      <label>Reviewed configuration<select aria-label="Work card configuration" disabled={locked} value={configuration} onChange={e=>run(()=>load(e.target.value))}><option value="">Choose a revision</option>{configurations.map(row=><option key={row.id} value={row.id}>Revision {row.group_revision||row.revision}</option>)}</select></label>}
    {!pending&&!configurations.length&&<p>No reviewed configuration is available for this work scope.</p>}
    {result && <>
      {!reviewed&&<p role="status">Showing the previous review. Review your current choices before saving.</p>}
      {result.slots.length===0&&<p>This revision adds or reuses no work cards.</p>}
      {['create_missing','create_replacement','use_existing'].map(action=>{
        const rows=result.slots.filter(row=>row.action===action)
        return rows.length>0 && <section key={action}><h4>{action==='use_existing'?'Existing cards to reuse':action==='create_replacement'?'Replacement cards':'New cards'} ({rows.length})</h4>{rows.map(slot=><article key={slot.key+':'+slot.instance} className="rounded border p-2"><strong>{slot.title} · {slot.instance}</strong>{slot.material_reason&&<p>{slot.material_reason}</p>}{(slot.work_item_id||slot.previous_work_item_id)&&<details><summary>Card reference</summary><p>{slot.work_item_id||slot.previous_work_item_id}</p><p>Version {slot.row_version||slot.previous_row_version}</p></details>}{action==='create_missing' && linkedWorkId && context.work_options.some(row=>row.id===linkedWorkId&&row.department_id===slot.department_id)&&<button type="button" disabled={locked} onClick={()=>run(()=>editSlot(slot,{action:'use_existing',work_item_id:linkedWorkId,row_version:context.work_options.find(row=>row.id===linkedWorkId).row_version}))}>Use the card linked to this page</button>}{action==='create_missing'&&workRecords.length>0&&<label>Use an existing card<select disabled={locked} value="" onChange={e=>run(()=>chooseExisting(slot,e.target.value))}><option value="">Choose a card</option>{workRecords.filter(row=>row.department_id===slot.department_id).map(row=><option key={row.id} value={row.id}>{row.title}</option>)}</select></label>}{action==='use_existing'&&context.prior_slots.some(row=>row.key===slot.key&&row.instance===slot.instance)&&<details><summary>Replace this card</summary><label>Reason for replacement<input maxLength={500} disabled={locked} onKeyDown={e=>{if(e.key==='Enter'&&e.currentTarget.value.trim()){const reason=e.currentTarget.value.trim();const prior=context.prior_slots.find(row=>row.key===slot.key&&row.instance===slot.instance);const slots=proposal.slots.map(row=>row.key===slot.key&&row.instance===slot.instance?{key:row.key,instance:row.instance,action:'create_replacement',previous_work_item_id:prior.work_item_id,previous_row_version:prior.row_version,material_reason:reason}:row);run(()=>inspect({...proposal,slots}))}}}/></label><small>Press Enter to review the replacement.</small></details>}</article>)}</section>
      })}
      {!!result.retained.length&&<details><summary>Retained cards ({result.retained.length})</summary>{result.retained.map(row=><p key={row.work_item_id}>{workRecords.find(card=>card.id===row.work_item_id)?.title||context?.stages.find(s=>s.key===row.key)?.label||row.key} · {row.instance} · {row.status}<small> · {row.work_item_id}</small></p>)}</details>}
      {result.blockers.map((block,index)=>{
        const predecessor=context?.stages.find(row=>row.key===block.depends_on_key)
        const target=context?.stages.find(row=>row.key===block.key)
        if(block.code==='dependency_mapping_required'&&predecessor)return <label key={index}>Prerequisite for {target?.label} · {block.instance}<select disabled={locked} value="" onChange={e=>{const value=e.target.value;run(()=>inspect({...proposal,dependencies:[...proposal.dependencies,{key:block.key,instance:block.instance,depends_on_key:block.depends_on_key,depends_on_instance:predecessor.action==='reuse'?null:Number(value)}]}))}}><option value="">Choose an exact prerequisite</option>{Array.from({length:predecessor.action==='reuse'?1:predecessor.quantity},(_,i)=><option key={i} value={i+1}>{predecessor.label} · {i+1}</option>)}</select></label>
        if(block.code==='changed_work_source')return <label key={index}>{block.reason}<input disabled={locked} aria-label="Reason for reusing this card" maxLength={500} onBlur={e=>{const value=e.target.value.trim();if(value)run(()=>editSlot(block,{material_reason:value}))}}/></label>
        return <p role="status" key={index}>{block.reason||block.code.replaceAll('_',' ')}</p>
      })}
      {proposal.dependencies.length>0&&<details><summary>Chosen prerequisites ({proposal.dependencies.length})</summary>{proposal.dependencies.map((mapping,index)=>{
        const predecessor=context.stages.find(stage=>stage.key===mapping.depends_on_key)
        const target=context.stages.find(stage=>stage.key===mapping.key)
        const used=proposal.dependencies.filter(row=>row.key===mapping.key&&row.instance===mapping.instance&&row.depends_on_key===mapping.depends_on_key)
        const available=Array.from({length:predecessor.quantity||0},(_,i)=>i+1).filter(instance=>!used.some(row=>row.depends_on_instance===instance))
        return <div key={index}><p>{target.label} · {mapping.instance} requires {predecessor.label} · {mapping.depends_on_instance||'approved output'}</p>
          <button type="button" disabled={locked} onClick={()=>run(()=>inspect({...proposal,dependencies:proposal.dependencies.filter((_,i)=>i!==index)}))}>Remove prerequisite</button>
          {available.length>0&&used[0]===mapping&&<label>Additional prerequisite<select value="" disabled={locked} onChange={event=>{const instance=Number(event.target.value);run(()=>inspect({...proposal,dependencies:[...proposal.dependencies,{...mapping,depends_on_instance:instance}]}))}}><option value="">Choose if needed</option>{available.map(instance=><option key={instance} value={instance}>{predecessor.label} · {instance}</option>)}</select></label>}
        </div>
      })}</details>}
      {(result.edges?.length>0||result.material_requirements?.length>0)&&<details><summary>Reviewed dependencies and source material</summary>{result.edges.map((edge,index)=><p key={index}>{edge.key} · {edge.instance} requires {edge.depends_on_key} · {edge.depends_on_instance}</p>)}{result.material_requirements.map((material,index)=><p key={index}>{material.key} · {material.instance} uses reviewed {material.depends_on_key} output.</p>)}</details>}
      <button type="button" className="workspace-button" disabled={locked||!reviewed||!result.can_apply} onClick={()=>run(save)}>Save reviewed work cards</button>
    </>}
    {versionReview && <section aria-label="Changed card versions"><h4>Review current card versions</h4>
      {versionReview.changes.map(change=><p key={change.key+change.instance}>{context.stages.find(stage=>stage.key===change.key)?.label||change.key} · {change.instance}: version {change.from} → {change.to}</p>)}
      <button type="button" disabled={locked} onClick={()=>run(()=>inspect(versionReview.proposal))}>Review with these versions</button>
    </section>}
    {!reviewed&&proposal&&!pending&&!versionReview&&<button type="button" disabled={busy} onClick={()=>run(refreshForReview)}>Review cards again</button>}
    {message&&<p role="status">{message}</p>}
  </section>
}
