import {useCallback,useEffect,useMemo,useRef,useState} from 'react'
import {supabase} from '../lib/supabase.js'
import {createProjectChatActionRepository} from '../data/projectChatActionRepository.js'
import {createContentStudioScope} from '../data/contentStudioRepository.js'
import {createProjectStagePlanRepository} from '../data/projectStagePlanRepository.js'
import {createProjectAssetRelationsRepository} from '../data/projectAssetRelationsRepository.js'
import {newContentWriterDraft,contentWriterFormFromVersion,serializeContentWriter,architectureVersions,architecturePages} from '../data/contentWriter.js'
import {workRecordPath} from '../data/workItemExperience.js'
import ArtifactApprovalPanel from './ArtifactApprovalPanel.jsx'
import ProjectChatContentEditor from './ProjectChatContentEditor.jsx'
import './projectChatContentActions.css'

const relation=v=>Array.isArray(v)?v[0]:v
const EMPTY=[]
const uniqueId=rows=>rows.length===1?rows[0].id:''
function observe(promise,timeoutMs){let timer;return Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Object.assign(Error('The result is uncertain. Check the original saved result before another action.'),{outcome:'unknown'})),timeoutMs)})]).finally(()=>clearTimeout(timer))}

// UI state only: canonical receipts are read from the action repository. Session storage
// holds only an unresolved original proposal, never an alternate output/history store.
export default function ProjectChatContentActions({workspace,conversationId,actorId,messages=EMPTY,request,onRequestHandled,selection=null,signal,disabled=false,onStateChange,onChanged,onContinueDesign,repository:providedRepository,studio:providedStudio,stages:providedStages,relations:providedRelations,timeoutMs=15000}){
 const organizationId=workspace.project.organization_id,projectId=workspace.project.id,engagementId=workspace.engagement.id
 const scope=useMemo(()=>({organizationId,projectId,conversationId}),[organizationId,projectId,conversationId])
 const identityKey=[actorId,organizationId,projectId,engagementId,conversationId].join(':')
 const recoveryKey='anka:chat-content-action:'+identityKey
 const repository=useMemo(()=>providedRepository||createProjectChatActionRepository(supabase),[providedRepository])
 const studio=useMemo(()=>providedStudio||createContentStudioScope(organizationId,{signal}),[providedStudio,organizationId,signal])
 const stages=useMemo(()=>providedStages||createProjectStagePlanRepository(supabase),[providedStages])
 const relations=useMemo(()=>providedRelations||createProjectAssetRelationsRepository(supabase),[providedRelations])
 const [receipts,setReceipts]=useState([]),[hasMore,setHasMore]=useState(false),[offset,setOffset]=useState(0)
 const [editor,setEditor]=useState(null),[form,setForm]=useState(newContentWriterDraft),[data,setData]=useState(null)
 const [sourceWorkId,setSourceWorkId]=useState(''),[serviceId,setServiceId]=useState(''),[workTitle,setWorkTitle]=useState(''),[workDescription,setWorkDescription]=useState('')
 const [aiAllowed,setAiAllowed]=useState(false),[summary,setSummary]=useState('')
 const [slotOptions,setSlotOptions]=useState([]),[slotKey,setSlotKey]=useState(''),[slotDependencies,setSlotDependencies]=useState({})
 const [proposal,setProposal]=useState(null),[review,setReview]=useState(null),[handoff,setHandoff]=useState(null)
 const [receiverService,setReceiverService]=useState(''),[receiverStream,setReceiverStream]=useState(''),[receiverWork,setReceiverWork]=useState(''),[receiverTitle,setReceiverTitle]=useState(''),[receiverDescription,setReceiverDescription]=useState(''),[note,setNote]=useState('')
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('')
 const [pending,setPending]=useState(()=>{try{const p=JSON.parse(sessionStorage.getItem(recoveryKey)||'null');if(p&&(p.identity?.organizationId!==organizationId||p.identity?.projectId!==projectId||p.identity?.conversationId!==conversationId||p.action?.engagement_id!==engagementId))throw Error();return p}catch{return {unreadable:true}}})
 const live=useRef(false),flight=useRef(false),generation=useRef(0),seenRequest=useRef(null),current=useRef(null),root=useRef(null)
 current.current={identityKey,disabled,selection,workspace,editor,proposal,pending}
 const alive=()=>live.current&&!signal?.aborted&&current.current.identityKey===identityKey
 const same=token=>alive()&&token===generation.current
 const dirty=Boolean(editor||handoff||proposal)
 const focusMode=pending?'Original Content action recovery':proposal?'Confirm reviewed Content action':editor?'Prepare Content':handoff?'Prepare Design handoff':review?'Review exact saved Content':null
 useEffect(()=>{if(!focusMode)return;const target=root.current?.querySelector?.(`[aria-label="${focusMode}"]`);target?.focus?.({preventScroll:true});target?.scrollIntoView?.({block:'nearest'})},[focusMode])
 useEffect(()=>{live.current=true;return()=>{live.current=false;generation.current++}},[])
 useEffect(()=>{onStateChange?.({busy,dirty});return()=>onStateChange?.({busy:false,dirty:false})},[busy,dirty,onStateChange])
 const addReceipt=receipt=>setReceipts(rows=>[receipt,...rows.filter(r=>r.request_id!==receipt.request_id)])
 const loadReceipts=useCallback(async(start=0)=>{
  const token=generation.current
  const page=await observe(repository.list(scope,{limit:25,offset:start}),timeoutMs)
  if(!same(token))return
  const rows=page.items.filter(r=>r.engagement_id===engagementId&&r.actor_id===actorId)
  setReceipts(old=>start?[...old,...rows.filter(r=>!old.some(x=>x.request_id===r.request_id))]:rows)
  setOffset(start+page.items.length);setHasMore(page.has_more)
 // Scope-keyed parent remounts this controller; reads never alter editor/proposals.
 // eslint-disable-next-line react-hooks/exhaustive-deps
 },[repository,scope,engagementId,actorId,timeoutMs])
 useEffect(()=>{loadReceipts().catch(e=>{if(alive())setError('Content action history is unavailable. '+e.message)})},[loadReceipts]) // eslint-disable-line react-hooks/exhaustive-deps
 async function run(fn,{recovery=false}={}){
  if(flight.current||!alive()||current.current.disabled||(!recovery&&pending))return
  flight.current=true;setBusy(true);setError('');const token=++generation.current
  try{await fn(token)}catch(e){if(same(token))setError(e.message)}finally{flight.current=false;if(same(token))setBusy(false)}
 }
 function invalidate(){setProposal(null);setNotice('')}
 function edit(key,value){setForm(f=>({...f,[key]:value,...(key==='source_architecture_version_id'?{target_page_key:''}:{})}));invalidate()}
 async function loadWriter(workId){
  const loaded=await observe(studio.load(engagementId,workId?{workRecord:{kind:'engagement_work_item',id:workId}}:{}),timeoutMs)
  if(loaded.engagement.id!==engagementId||loaded.engagement.project_id!==projectId||loaded.engagement.organization_id!==organizationId)throw Error('Content workspace changed. Reopen the original project.')
  return loaded
 }
 const eligibleContentServices=loaded=>(loaded?.contentServices||[]).filter(s=>s.organization_id===organizationId&&s.engagement_id===engagementId&&s.status==='active'&&relation(s.service_catalog)?.department_id==='content'&&relation(s.service_catalog)?.is_active===true)
 const designServices=library=>(library?.downstreamServices||[]).filter(s=>s.organization_id===organizationId&&s.engagement_id===engagementId&&s.status==='active'&&relation(s.service_catalog)?.department_id==='design'&&relation(s.service_catalog)?.is_active===true)
 const designStreams=library=>(library?.downstreamWorkstreams||[]).filter(w=>w.organization_id===organizationId&&w.project_id===projectId&&w.department_id==='design'&&w.status==='active')
 async function selectedPageDefaults(pinned,loaded){
  if(pinned?.partition.kind!=='website_page')return {}
  const unit=await stages.readPartition({organizationId,projectId,engagementId},{planId:pinned.plan_id,groupId:pinned.group_id,partition:pinned.partition,signal})
  const versions=architectureVersions(loaded).filter(v=>v.id===pinned.partition.architecture_version_id)
  const page=unit.page,version=versions.length===1?versions[0]:null
  if(unit.state!=='current'||unit.plan_id!==pinned.plan_id||unit.group_id!==pinned.group_id||['kind','id','architecture_version_id'].some(k=>unit.partition?.[k]!==pinned.partition[k])||page?.id!==pinned.partition.id||!version||page.architecture_artifact_id!==version.artifact_id||architecturePages(version).filter(p=>p.page_key===page.page_key).length!==1)throw Error('The exact registered page or architecture is unavailable. Refresh that page; no other page was selected.')
  return {source_architecture_version_id:version.id,target_page_key:page.page_key}
 }
 async function freshSelection(pinned){
  if(pinned===null)return null
  const partition=await stages.readPartition({organizationId,projectId,engagementId},{planId:pinned.plan_id,groupId:pinned.group_id,partition:pinned.partition,signal})
  if(partition.state!=='current'||partition.plan_id!==pinned.plan_id||partition.group_id!==pinned.group_id||['kind','id','architecture_version_id'].some(key=>partition.partition?.[key]!==pinned.partition[key])||!partition.steps.some(s=>s.phase===pinned.phase))throw Error('The original page or stage changed. Review its exact context again.')
  return {...pinned,context_sha256:partition.context_sha256}
 }
 async function readStageSlots(pinned){
  if(!pinned)return []
  const stageScope={organizationId,projectId,engagementId}
  const [header,partition]=await Promise.all([stages.read(stageScope,{signal}),stages.readPartition(stageScope,{planId:pinned.plan_id,groupId:pinned.group_id,partition:pinned.partition,signal})])
  if(header.plan_id!==pinned.plan_id||partition.state!=='current')throw Error('The selected plan is unavailable for creating Work.')
  const group=header.groups.find(g=>g.id===pinned.group_id)
  return partition.steps.filter(s=>s.phase===pinned.phase&&s.action==='run'&&group?.steps.some(p=>p.key===s.key&&p.department_id==='content')).flatMap(s=>s.items.filter(i=>i.work_required&&i.work_item_id===null&&i.missing_work===false).map(i=>({key:s.key,instance:i.instance,label:s.label||s.key,dependencies:(s.depends_on||[]).map(key=>({key,items:(partition.steps.find(p=>p.key===key)?.items||[]).filter(item=>item.work_item_id&&!item.missing_work)}))})))
 }
 async function startWriter(messageId,receipt=null){
  await run(async token=>{
   const human=messages.find(m=>m.id===messageId&&m.role==='user'&&m.author_id===actorId&&m.conversation_id===conversationId)
   if(!human)throw Error('Load the original message in this conversation before preparing Content.')
   const pinned=receipt?receipt.selection:selection
   if(pinned===undefined)throw Error('The original stage selection is unavailable. Read the saved action again before editing.')
   const loaded=await loadWriter(receipt?.source_work.id)
   const slots=await readStageSlots(pinned)
   let version=null
   if(receipt){version=loaded.versions.find(v=>v.id===receipt.output.artifact_version_id&&v.artifact_id===receipt.output.artifact_id&&v.content_checksum===receipt.output.content_checksum);if(!version)throw Error('The exact saved Content version is unavailable. No newer version was substituted.')}
   const pageDefaults=version?{}:await selectedPageDefaults(pinned,loaded)
   if(!same(token))return
   setData(loaded);setEditor({messageId,base:receipt?.output||null,classification:version?.data_classification||'internal',selection:pinned?structuredClone(pinned):null})
   setForm(version?contentWriterFormFromVersion(version):{...newContentWriterDraft(),output_type:pinned?.partition.kind==='website_page'?'website_page_copy':'custom_text',...pageDefaults})
   setSourceWorkId(receipt?.source_work.id||'');setServiceId(uniqueId(eligibleContentServices(loaded)));setWorkTitle('');setWorkDescription('');setSummary('');setAiAllowed(version?.ai_use_allowed===true);setReview(null);setHandoff(null);setProposal(null);setSlotOptions(slots);setSlotKey('');setSlotDependencies({})
  })
 }
 useEffect(()=>{
  if(!request?.id||seenRequest.current===request.id||busy||disabled||pending)return
  seenRequest.current=request.id
  startWriter(request.sourceMessageId).finally(()=>onRequestHandled?.(request.id))
 // Only explicit events open an editor; normal Send never confirms an action.
 // eslint-disable-next-line react-hooks/exhaustive-deps
 },[request?.id,busy,disabled,pending])
 const works=(workspace.engagementWorkItems||[]).filter(w=>w.organization_id===organizationId&&w.project_id===projectId&&w.engagement_id===engagementId&&!w.deleted_at)
 const contentWorks=works.filter(w=>w.department_id==='content')
 const contentServices=eligibleContentServices(data)
 const designWorks=receipt=>works.filter(w=>w.department_id==='design'&&w.id!==receipt.source_work.id&&!['done','completed','cancelled'].includes(w.status)&&Number.isSafeInteger(w.row_version)&&w.row_version>0)
 async function prepareSave(){await run(async token=>{
  if(!editor||!sourceWorkId||!serviceId)throw Error('Choose the Content service and source Work before review.')
  const loaded=await loadWriter(sourceWorkId==='new'?null:sourceWorkId)
  const work=loaded.navigationWorkRecord
  if(sourceWorkId!=='new'&&(work?.id!==sourceWorkId||work?.department_id!=='content'))throw Error('The source Content Work is unavailable.')
  if(!eligibleContentServices(loaded).some(s=>s.id===serviceId))throw Error('The selected Content service is unavailable.')
  const content=serializeContentWriter(form,loaded.versions,{preserveBody:true})
  const selected=await freshSelection(editor.selection)
  let stageSlot=null
  if(sourceWorkId==='new'&&selected){
   const slots=await readStageSlots(selected),chosen=slotKey?slots.find(s=>s.key+':'+s.instance===slotKey):slots.length===1?slots[0]:null
   if(!chosen)throw Error('Choose one eligible missing Content slot. Lost Work and missing prerequisites cannot be created here.')
   stageSlot={step_key:chosen.key,instance:chosen.instance,dependencies:chosen.dependencies.map(dep=>{const item=dep.items.length===1?dep.items[0]:dep.items.find(i=>String(i.instance)===slotDependencies[dep.key]);if(!item)throw Error('Choose an existing prerequisite instance for '+dep.key);return {step_key:dep.key,instance:item.instance}})}
  }
  const action={version:1,kind:'save_content',engagement_id:engagementId,selection:selected,source_work:sourceWorkId==='new'?{id:null,title:workTitle,description:workDescription,...(stageSlot?{stage_slot:stageSlot}:{})}:{id:sourceWorkId,row_version:work.row_version},active_service_id:serviceId,artifact_id:editor.base?.artifact_id||null,expected_parent_version_id:editor.base?.artifact_version_id||null,content,change_summary:summary,ai_use_allowed:aiAllowed,data_classification:editor.classification}
  const next=await repository.prepare({...scope,sourceMessageId:editor.messageId,requestId:crypto.randomUUID()},action)
  if(same(token)){setProposal(next);setData(loaded);setNotice('Review the exact text and target before saving.')}
 })}
 async function readExact(receipt){
  const library=await observe(studio.loadLibrary({projectId,engagementId,artifactId:receipt.output.artifact_id}),timeoutMs)
  const version=library.versions.find(v=>v.id===receipt.output.artifact_version_id&&v.artifact_id===receipt.output.artifact_id&&v.content_checksum===receipt.output.content_checksum)
  if(!version)throw Error('The exact saved version is unavailable. No newer version was substituted.')
  return {receipt,library,version,approval:library.approvals.find(a=>a.artifact_version_id===version.id)||null}
 }
 async function openReview(receipt){await run(async token=>{const value=await readExact(receipt);if(same(token)){setReview(value);setEditor(null);setHandoff(null);setProposal(null)}})}
 async function refreshReview(){const prior=review;if(!prior)return;const token=generation.current;const next=await readExact(prior.receipt);if(same(token))setReview(next);await onChanged?.()}
 async function openHandoff(receipt){await run(async token=>{
  const value=await readExact(receipt)
  if(!value.approval)throw Error('Approve this exact Content version before preparing a Design handoff.')
  if(receipt.selection===undefined)throw Error('The original stage selection is unavailable. Read this saved action again before handoff.')
  const candidates=designWorks(receipt).filter(w=>!w.linked_page_key||w.linked_page_key===value.version.content?.target_page_key)
  let defaultWork=''
  if(candidates.length===1){
   const candidate=candidates[0],read=id=>observe(relations.read({organizationId,projectId,subjectKind:'engagement_work_item',subjectId:id},{signal}),timeoutMs)
   try{
    const [sourceLinks,receiverLinks]=await Promise.all([read(receipt.source_work.id),read(candidate.id)])
    const pinned=receipt.selection?.partition,assets=['website_page','campaign_asset'].includes(pinned?.kind)?[{kind:pinned.kind,id:pinned.id}]:sourceLinks.assets
    if(sourceLinks.subject?.id===receipt.source_work.id&&receiverLinks.subject?.id===candidate.id&&receiverLinks.subject.row_version===candidate.row_version&&Array.isArray(assets)&&Array.isArray(receiverLinks.assets)&&receiverLinks.assets.every(a=>assets.some(s=>s.kind===a.kind&&s.id===a.id)))defaultWork=candidate.id
   }catch{/* Unavailable relationship evidence leaves the existing explicit chooser; no inferred default. */}
  }
  if(same(token)){setHandoff({...value,selection:receipt.selection?structuredClone(receipt.selection):null});setReview(null);setEditor(null);setProposal(null);setReceiverService(uniqueId(designServices(value.library)));setReceiverStream(uniqueId(designStreams(value.library)));setReceiverWork(defaultWork);setReceiverTitle('');setReceiverDescription('');setNote('')}
 })}
 async function prepareHandoff(){await run(async token=>{
  if(!handoff||!receiverService||!receiverStream||!receiverWork)throw Error('Choose the receiving Design service, workstream and Work.')
  const value=await readExact(handoff.receipt),loaded=await loadWriter(handoff.receipt.source_work.id)
  if(!value.approval)throw Error('The exact approval is no longer available.')
  const source=loaded.navigationWorkRecord
  if(source?.linked_artifact_version_id!==value.version.id)throw Error('The source Work now links another version. Review its exact output before handoff.')
  if(!designServices(value.library).some(s=>s.id===receiverService)||!designStreams(value.library).some(w=>w.id===receiverStream))throw Error('The receiving Design service or workstream changed. Review current choices.')
  const receiver=designWorks(handoff.receipt).find(w=>w.id===receiverWork)
  if(receiverWork!=='new'&&(!receiver||receiver.linked_page_key&&receiver.linked_page_key!==value.version.content?.target_page_key))throw Error('Choose current receiving Design Work.')
  const action={version:1,kind:'handoff_design',engagement_id:engagementId,selection:await freshSelection(handoff.selection),source_work:{id:source.id,row_version:source.row_version},artifact_version_id:value.version.id,content_checksum:value.version.content_checksum,approval_id:value.approval.id,receiving_service_id:receiverService,receiving_workstream_id:receiverStream,receiving_work:receiverWork==='new'?{id:null,title:receiverTitle,description:receiverDescription}:{id:receiver.id,row_version:receiver.row_version},recipient_note:note}
  const next=await repository.prepare({...scope,sourceMessageId:handoff.receipt.source_message_id,requestId:crypto.randomUUID()},action)
  if(same(token)){setProposal(next);setHandoff({...handoff,...value})}
 })}
 async function acceptReceipt(receipt,token){
  if(!same(token))return
  sessionStorage.removeItem(recoveryKey)
  addReceipt(receipt);setPending(null);setProposal(null);setEditor(null);setHandoff(null);setNotice(receipt.status==='content_saved'?'Content saved. Review this exact version next.':'Design handoff recorded. Receiving Work is linked below.')
  try{if(receipt.status==='content_saved'){const value=await readExact(receipt);if(same(token))setReview(value)}await onChanged?.()}catch(e){if(same(token))setError('The action is recorded. '+e.message)}
 }
 async function confirm(){
  if(!proposal)return
  await run(async token=>{
   const original=proposal
   sessionStorage.setItem(recoveryKey,JSON.stringify(original));setPending(original)
   try{const receipt=await observe(repository.confirm(original),timeoutMs);await acceptReceipt(receipt,token)}
   catch(e){if(same(token)){if(e.outcome==='unknown'){setEditor(null);setHandoff(null);setProposal(null)}else{sessionStorage.removeItem(recoveryKey);setPending(null);setProposal(null)}throw e}}
  })
 }
 async function recover(){await run(async token=>{
  if(!pending||pending.unreadable)throw Error('Original recovery details are unavailable in this tab. Read the saved action history; do not submit another action.')
  const result=await observe(repository.recover(pending.identity),timeoutMs)
  if(!same(token))return
  if(result.status==='recorded')await acceptReceipt(result.receipt,token)
  else setNotice('No saved receipt is visible yet. This observation does not permit resubmitting. Check the original result again.')
 },{recovery:true})}
 const locked=disabled||busy||Boolean(pending)
 const sourceMessages=editor?messages.filter(m=>m.id===editor.messageId||m.role==='assistant'&&m.status==='completed'&&m.in_reply_to_message_id===editor.messageId):[]
 const selectedSlot=slotOptions.find(s=>s.key+':'+s.instance===slotKey)||(slotOptions.length===1?slotOptions[0]:null)
 return <section ref={root} className="chat-content-actions" aria-label="Content actions in this conversation">
  {(error||notice)&&<div className="chat-content-card">{error&&<p role="alert">{error}</p>}{notice&&<p role="status">{notice}</p>}</div>}
  {pending&&<article tabIndex={-1} className="chat-content-card" aria-label="Original Content action recovery"><h3>Check the original Content action</h3><p>The draft and original request are retained. Checking does not submit again.</p><details><summary>Original reviewed action</summary><pre>{JSON.stringify(pending.action||{},null,2)}</pre></details><button type="button" disabled={busy||disabled||pending.unreadable} onClick={recover}>Check saved result</button><button type="button" disabled={busy||disabled} onClick={()=>run(()=>loadReceipts(),{recovery:true})}>Read saved action history</button></article>}
  {editor&&!proposal&&<article tabIndex={-1} className="chat-content-card" aria-label="Prepare Content"><h3>{editor.base?'Edit exact saved Content':'Prepare Content from this message'}</h3><p>Save an unapproved version and link its Content Work. Your Chat message stays unchanged.</p>
   <ProjectChatContentEditor form={form} data={data} disabled={locked} onChange={edit} sourceMessages={sourceMessages} onCopy={body=>edit('body',body)}/>
   <fieldset disabled={locked}><label>Content service<select aria-label="Content service" value={serviceId} onChange={e=>{setServiceId(e.target.value);invalidate()}}><option value="">Choose active Content service</option>{contentServices.map(s=><option key={s.id} value={s.id}>{relation(s.service_catalog)?.name||relation(workspace.activeServices?.find(service=>service.id===s.id)?.service_catalog)?.name||'Content service'}</option>)}</select></label>
   <label>Source Content Work<select aria-label="Source Content Work" value={sourceWorkId} onChange={e=>{setSourceWorkId(e.target.value);invalidate()}}><option value="">Choose source Work</option><option value="new">Create new Content Work</option>{contentWorks.map(w=><option key={w.id} value={w.id}>{w.title}</option>)}{sourceWorkId&&sourceWorkId!=='new'&&!contentWorks.some(w=>w.id===sourceWorkId)&&<option value={sourceWorkId}>Saved Content Work · {sourceWorkId}</option>}</select></label>
   {sourceWorkId==='new'&&<><label>New Content Work title<input value={workTitle} onChange={e=>{setWorkTitle(e.target.value);invalidate()}}/></label><label>Work description<textarea value={workDescription} onChange={e=>{setWorkDescription(e.target.value);invalidate()}}/></label></>}
   {sourceWorkId==='new'&&editor.selection&&<><label>Content stage slot<select aria-label="Content stage slot" value={slotKey||(selectedSlot?selectedSlot.key+':'+selectedSlot.instance:'')} onChange={e=>{setSlotKey(e.target.value);setSlotDependencies({});invalidate()}}><option value="">Choose missing Content slot</option>{slotOptions.map(s=><option key={s.key+':'+s.instance} value={s.key+':'+s.instance}>{s.label} · instance {s.instance}</option>)}</select></label>{!slotOptions.length&&<p>No eligible missing Content slot. Existing or lost Work is not replaced here.</p>}{selectedSlot?.dependencies.map(dep=><label key={dep.key}>Existing prerequisite · {dep.key}<select value={dep.items.length===1?String(dep.items[0].instance):slotDependencies[dep.key]||''} onChange={e=>{setSlotDependencies(v=>({...v,[dep.key]:e.target.value}));invalidate()}}><option value="">Choose existing prerequisite instance</option>{dep.items.map(i=><option key={i.instance} value={String(i.instance)}>Instance {i.instance} · {i.work_item_id}</option>)}</select></label>)}</>}
   <label>Change summary<input maxLength={1000} value={summary} onChange={e=>{setSummary(e.target.value);invalidate()}}/></label><label><input type="checkbox" checked={aiAllowed} onChange={e=>{setAiAllowed(e.target.checked);invalidate()}}/>Allow future AI use of this saved Content</label>
   <button type="button" onClick={prepareSave}>Review Content save</button><button type="button" onClick={()=>{setEditor(null);setProposal(null)}}>Discard Content edits</button></fieldset>
  </article>}
  {review&&!pending&&<article tabIndex={-1} className="chat-content-card chat-content-review" aria-label="Review exact saved Content"><h3>Review Content · version {review.version.version_number}</h3><pre>{review.version.content?.body||'Saved Content body unavailable'}</pre><p>Review submission and sign-off are separate from final approval.</p><fieldset disabled={disabled||busy}><ArtifactApprovalPanel key={review.version.id} version={review.version} approval={review.approval} theme="violet" requestLabel="Submit exact version for review" onSingleApprove={()=>studio.approveArtifact(review.version.id)} onChanged={refreshReview}/></fieldset><button type="button" disabled={locked} onClick={()=>openReview(review.receipt)}>Refresh exact review</button>{review.approval&&<button type="button" disabled={locked} onClick={()=>openHandoff(review.receipt)}>Prepare Design handoff</button>}</article>}
  {handoff&&!proposal&&<article tabIndex={-1} className="chat-content-card" aria-label="Prepare Design handoff"><h3>Send approved Content to Design</h3><p>Content v{handoff.version.version_number} · {works.find(w=>w.id===handoff.receipt.source_work.id)?.title||'Source Content Work'}</p><fieldset disabled={locked}>
   <label>Receiving Design service<select aria-label="Receiving Design service" value={receiverService} onChange={e=>{setReceiverService(e.target.value);invalidate()}}><option value="">Choose Design service</option>{designServices(handoff.library).map(s=><option key={s.id} value={s.id}>{relation(s.service_catalog)?.name||s.id}</option>)}</select></label>
   <label>Receiving Design workstream<select aria-label="Receiving Design workstream" value={receiverStream} onChange={e=>{setReceiverStream(e.target.value);invalidate()}}><option value="">Choose Design workstream</option>{designStreams(handoff.library).map(w=><option key={w.id} value={w.id}>{w.name}</option>)}</select></label>
   <label>Receiving Design Work<select aria-label="Receiving Design Work" value={receiverWork} onChange={e=>{setReceiverWork(e.target.value);invalidate()}}><option value="">Choose receiving Work</option><option value="new">Create new Design Work</option>{designWorks(handoff.receipt).filter(w=>!w.linked_page_key||w.linked_page_key===handoff.version.content?.target_page_key).map(w=><option key={w.id} value={w.id}>{w.title}</option>)}</select></label>
   {receiverWork==='new'&&<><label>New Design Work title<input value={receiverTitle} onChange={e=>{setReceiverTitle(e.target.value);invalidate()}}/></label><label>New Design Work description<textarea value={receiverDescription} onChange={e=>{setReceiverDescription(e.target.value);invalidate()}}/></label></>}<label>Recipient note<textarea maxLength={4000} value={note} onChange={e=>{setNote(e.target.value);invalidate()}}/></label><button type="button" onClick={prepareHandoff}>Review Design handoff</button><button type="button" onClick={()=>{setHandoff(null);setProposal(null)}}>Cancel handoff</button></fieldset>
  </article>}
  {proposal&&<article tabIndex={-1} className="chat-content-card" aria-label="Confirm reviewed Content action"><h3>{proposal.action.kind==='save_content'?'Review Content save':'Review Design handoff'}</h3>{proposal.action.kind==='save_content'?<><p>{proposal.action.content.working_title}</p><p>Content service: {relation(contentServices.find(s=>s.id===proposal.action.active_service_id)?.service_catalog)?.name||relation(workspace.activeServices?.find(s=>s.id===proposal.action.active_service_id)?.service_catalog)?.name||proposal.action.active_service_id}</p>{proposal.action.content.output_type==='website_page_copy'&&<p>Page: {proposal.action.content.target_page_key} · structure v{data?.versions.find(v=>v.id===proposal.action.content.source_architecture_version_id)?.version_number}</p>}<pre>{proposal.action.content.body}</pre><p>{proposal.action.source_work.id?'Link existing Content Work':'Create Content Work'} · {proposal.action.source_work.title||works.find(w=>w.id===proposal.action.source_work.id)?.title||'Selected Content Work'}</p></>:<><p>Approved exact Content version: {proposal.action.artifact_version_id}</p><p>Source Content Work: {works.find(w=>w.id===proposal.action.source_work.id)?.title||proposal.action.source_work.id}</p><p>Receiving service: {relation(handoff?.library.downstreamServices.find(s=>s.id===proposal.action.receiving_service_id)?.service_catalog)?.name||proposal.action.receiving_service_id}</p><p>Receiving workstream: {handoff?.library.downstreamWorkstreams.find(w=>w.id===proposal.action.receiving_workstream_id)?.name||proposal.action.receiving_workstream_id}</p><p>Receiving Design Work: {works.find(w=>w.id===proposal.action.receiving_work.id)?.title||proposal.action.receiving_work.id||'Create '+proposal.action.receiving_work.title}</p></>}<details><summary>Exact reviewed action</summary><pre>{JSON.stringify(proposal.action,null,2)}</pre></details><button type="button" disabled={locked} onClick={()=>setProposal(null)}>Edit reviewed action</button><button type="button" className="chat-content-confirm" disabled={locked} onClick={confirm}>{proposal.action.kind==='save_content'?'Confirm Content save':'Confirm Design handoff'}</button></article>}
  {receipts.map(r=><article tabIndex={-1} className="chat-content-card" key={r.request_id} aria-label={r.status==='content_saved'?'Saved Content result':'Recorded Design handoff'}><h3>{r.status==='content_saved'?'Content saved':'Design handoff recorded'} · v{r.output.version_number}</h3><p>{r.status==='content_saved'?'Saved version; review and approval remain separate.':'Internal handoff recorded; Design execution remains separate.'}</p><a href={workRecordPath('engagement_work_item',r.source_work.id)}>Open source Content Work</a>{r.handoff&&<a href={workRecordPath('engagement_work_item',r.handoff.receiving_work_item_id)}>Open receiving Design Work</a>}{r.handoff&&onContinueDesign&&<button type="button" disabled={locked||dirty} onClick={()=>onContinueDesign(r)}>Continue Design</button>}<button type="button" disabled={locked||dirty} onClick={()=>openReview(r)}>Review exact saved version</button>{r.status==='content_saved'&&<button type="button" disabled={locked||dirty} onClick={()=>startWriter(r.source_message_id,r)}>Edit saved version</button>}<button type="button" onClick={()=>{const message=document.getElementById("chat-message-"+r.source_message_id);if(message){message.scrollIntoView({block:"center"});message.focus?.()}else setError("Load earlier messages to view this action’s original message.")}}>View original message</button><details><summary>Original message and receipt</summary><dl><dt>Original message</dt><dd>{r.source_message_id}</dd><dt>Exact output version</dt><dd>{r.output.artifact_version_id}</dd><dt>Original request</dt><dd>{r.request_id}</dd>{r.handoff&&<><dt>Internal handoff</dt><dd>{r.handoff.request_id}</dd></>}</dl></details></article>)}
  {hasMore&&<button type="button" disabled={busy||disabled} onClick={()=>run(()=>loadReceipts(offset),{recovery:true})}>Load earlier Content actions</button>}
 </section>
}
