import DesignWebsiteWorkspace from './DesignWebsiteWorkspace.jsx'
import {useCallback,useEffect,useMemo,useRef,useState} from 'react'
import {useAuth} from '../context/AuthContext.jsx'
import {useOrganization} from '../context/OrganizationContext.jsx'
import {designWorkshop} from '../data/designWorkshopRepository.js'
import {designCapabilities} from '../data/designWorkshopContext.js'
import {creativeBriefForContext,latestBriefVersion} from '../data/designCreativeBriefs.js'
import {eligibleDesignVersions} from '../data/designChatTools.js'
import DesignCreativeBriefWorkspace from './DesignCreativeBriefWorkspace.jsx'
import DesignAssetUpload from './DesignAssetUpload.jsx'
import {officialDesignImageSources} from '../data/designAttachmentSources.js'
import DesignUnifiedMediaComposer from './DesignUnifiedMediaComposer.jsx'
import './designUnifiedWorkspace.css'
import DesignGeneratedConversationResults from './DesignGeneratedConversationResults.jsx'
import DesignGeneratedMediaResult from './DesignGeneratedMediaResult.jsx'
import {createGeneratedOriginalAccess} from '../data/designGeneratedOriginal.js'

// Coordinates presentation only. Canonical repositories retain authority, revisions and receipts.
export default function DesignUnifiedWorkspace({engagement=null,onNavigationBusyChange,children}) {
 const {user}=useAuth(),{activeOrganizationId,scopeRevision,activeMembership,requestSignal}=useOrganization()
 return <ScopedDesignUnifiedWorkspace key={`${user?.id}:${activeOrganizationId}:${scopeRevision}:${engagement?.id||'private'}`} engagement={engagement} userId={user?.id} organizationId={activeOrganizationId} membership={activeMembership} signal={requestSignal} onNavigationBusyChange={onNavigationBusyChange}>{children}</ScopedDesignUnifiedWorkspace>
}
function ScopedDesignUnifiedWorkspace({engagement,userId,organizationId,membership,signal,onNavigationBusyChange,children}){
 const privateMode=!engagement,capabilities=designCapabilities(membership)
 const studio=useMemo(()=>designWorkshop.forOrganization(organizationId,{signal}),[organizationId,signal])
 const [websiteMode,setWebsiteMode]=useState(false),[websiteDirty,setWebsiteDirty]=useState(false),[websiteBusy,setWebsiteBusy]=useState(false),[websiteMessages,setWebsiteMessages]=useState([]),[websitePrompt,setWebsitePrompt]=useState(null)
 const [mode,setMode]=useState('image'),[preparing,setPreparing]=useState(false),[workspace,setWorkspace]=useState(null),[records,setRecords]=useState(null),[serviceId,setServiceId]=useState(''),[briefId,setBriefId]=useState(''),[conversation,setConversation]=useState(null)
 const [briefOpen,setBriefOpen]=useState(false),[briefSummary,setBriefSummary]=useState(null)
 const [open,setOpen]=useState(false),[tab,setTab]=useState('preview'),[notice,setNotice]=useState(''),[busy,setBusy]=useState(''),[dirty,setDirty]=useState(false),[mediaBusy,setMediaBusy]=useState(false),[editorRevision,setEditorRevision]=useState(0)
 const [attachmentsOpen,setAttachmentsOpen]=useState(false),[attachmentTarget,setAttachmentTarget]=useState(null),[uploadOpen,setUploadOpen]=useState(false)
 const attachmentPanel=useRef(null),attachmentButton=useRef(null)
 const [receiptRefreshBlocked,setReceiptRefreshBlocked]=useState(false)
 const [scopeAborted,setScopeAborted]=useState(Boolean(signal?.aborted))
 useEffect(()=>{const stop=()=>setScopeAborted(true);signal?.addEventListener('abort',stop,{once:true});return()=>signal?.removeEventListener('abort',stop)},[signal])
 const alive=useRef(true),flight=useRef(false),privateValidator=useRef(null),briefSelection=useRef(null)
 const [generatedJobs,setGeneratedJobs]=useState([]),[preferredInput,setPreferredInput]=useState(null),[focusedGenerated,setFocusedGenerated]=useState(null)
 const selectedConversationIdentity=useRef(''),conversationRef=useRef(conversation);conversationRef.current=conversation
 const originalAccess=useMemo(()=>createGeneratedOriginalAccess({studio,organizationId,userId,signal}),[studio,organizationId,userId,signal])
 const hasUnsavedDraft=dirty||websiteDirty
 const current=useCallback(()=>alive.current&&!signal?.aborted,[signal])
 useEffect(()=>{alive.current=true;return()=>{alive.current=false}},[])
 const refresh=useCallback(async()=>{
  const data=privateMode?await studio.loadPrivateBriefs(userId):await studio.load(engagement.id)
  if(!current())return
  if(privateMode){setRecords(data);setWorkspace({engagement:{id:'',organization_id:organizationId,brand_id:null},creativeBriefs:data.briefs,creativeBriefVersions:data.versions,creativeBriefSources:data.sources,identitySystemVersions:[],versions:data.sourceVersions})}
  else if(data.engagement?.id===engagement.id&&data.engagement?.organization_id===organizationId)setWorkspace(data)
  else throw Error('Design context changed. Reload this conversation.')
 },[privateMode,studio,userId,engagement,organizationId,current])
 useEffect(()=>{refresh().catch(()=>{if(current())setNotice('Design references could not be loaded. Chat remains available.')})},[refresh,current])
 const locked=Boolean(busy||mediaBusy||receiptRefreshBlocked||websiteBusy)
 useEffect(()=>{onNavigationBusyChange?.(locked||hasUnsavedDraft);return()=>onNavigationBusyChange?.(false)},[locked,hasUnsavedDraft,onNavigationBusyChange])
 useEffect(()=>{if(!locked&&!hasUnsavedDraft)return;const guard=e=>{e.preventDefault();if(e.type==='beforeunload')e.returnValue=''};window.addEventListener('beforeunload',guard);window.addEventListener('anka:organization-change',guard);return()=>{window.removeEventListener('beforeunload',guard);window.removeEventListener('anka:organization-change',guard)}},[locked,hasUnsavedDraft])
 const services=(workspace?.designServices||[]).filter(s=>s.status==='active'&&(Array.isArray(s.service_catalog)?s.service_catalog[0]:s.service_catalog)?.department_id==='design')
 const brief=privateMode?(workspace?.creativeBriefs||[]).find(b=>b.id===briefId&&b.visibility==='private'&&b.created_by===userId):creativeBriefForContext(workspace?.creativeBriefs,organizationId,engagement.id,serviceId)
 const latest=latestBriefVersion(brief,workspace?.creativeBriefVersions)
 const confirmed=(workspace?.creativeBriefVersions||[]).find(v=>v.id===brief?.frozen_version_id&&v.creative_brief_id===brief?.id)
 const generationContextReady=Boolean(conversation?.id&&conversation.owner_id===userId&&conversation.organization_id===organizationId&&conversation.department_id==='design'&&conversation.state==='active'&&(privateMode?(conversation.context_kind==='department_private'&&!conversation.project_id&&!conversation.engagement_id):(conversation.context_kind==='department_project'&&conversation.project_id===engagement.project_id&&conversation.engagement_id===engagement.id)))
 const preparationNotice=generationContextReady?'Save your edits and confirm the latest exact version before preparing generation.':'Choose an existing saved Design chat from history, or send a message to save a new chat. Your selected brief remains saved.'
 const readyToPrepare=Boolean(!websiteMode&&generationContextReady&&confirmed&&latest?.id===confirmed.id&&!dirty&&!locked)
 const panelRef=useRef(null),editorRef=useRef(null),briefButton=useRef(null),briefPresentation=useRef(null)
 briefPresentation.current={locked,current}
 function openBrief(){if(!current()||locked)return;setPreparing(false);setBriefOpen(true)}
 useEffect(()=>{
  const node=panelRef.current;if(!node||!briefOpen||scopeAborted)return
  const previous=document.activeElement,returnButton=briefButton.current
  function position(){
   const root=node.closest?.('.design-unified-workspace'),composer=root?.querySelector?.('.direct-chat-composer, .department-chat-footer')
   const height=window.visualViewport?.height||window.innerHeight||800,rect=composer?.getBoundingClientRect?.()
   const top=Math.max(16,Math.min(root?.getBoundingClientRect?.().top||88,height-240))
   const bottom=rect&&rect.top>top+180&&rect.top<height?height-rect.top+12:20
   node.style?.setProperty?.('--brief-float-top',`${top}px`);node.style?.setProperty?.('--brief-float-bottom',`${bottom}px`)
  }
  position();try{node.showPopover?.()}catch{/* Fixed-position fallback keeps the same mounted editor. */}node.focus?.()
  const escape=event=>{if(event.key!=='Escape'||event.defaultPrevented||event.target?.closest?.('dialog[open]'))return;event.preventDefault();event.stopPropagation();if(!briefPresentation.current.locked)setBriefOpen(false)}
  document.addEventListener?.('keydown',escape);window.addEventListener?.('resize',position);window.addEventListener?.('scroll',position,true);window.visualViewport?.addEventListener?.('resize',position)
  const observer=typeof ResizeObserver==='function'?new ResizeObserver(position):null
  const composer=node.closest?.('.design-unified-workspace')?.querySelector?.('.direct-chat-composer, .department-chat-footer');if(composer)observer?.observe(composer)
  return()=>{document.removeEventListener?.('keydown',escape);window.removeEventListener?.('resize',position);window.removeEventListener?.('scroll',position,true);window.visualViewport?.removeEventListener?.('resize',position);observer?.disconnect();try{if(node.matches?.(':popover-open'))node.hidePopover?.()}catch{/* Scope teardown already hides the panel. */}if(previous?.isConnected)previous.focus?.();else returnButton?.focus?.()}
 },[briefOpen,scopeAborted])
 const versions=privateMode?[]:eligibleDesignVersions(workspace,{organizationId,projectId:engagement.project_id,engagementId:engagement.id})
 async function save(input){
  if(flight.current||!current()||!capabilities.createDraft)return false
  flight.current=true;setBusy('save-brief');setNotice('')
  try{const result=await studio.saveCreativeBrief(input);if(!current())return false;await refresh();if(privateMode&&result?.brief?.id)setBriefId(result.brief.id);setDirty(false);setPreparing(false);setNotice('Draft version saved. This is not business approval.');return result}
  catch(e){if(current())setNotice(e.message||'Save unavailable; your edits remain here.');return false}
  finally{flight.current=false;if(current())setBusy('')}
 }
 async function useBrief(input){
  if(flight.current||dirty||!current()||!capabilities.createDraft)return
  flight.current=true;setBusy('freeze-brief');setNotice('')
  try{
   const identity=[input.creative_brief_id,input.creative_brief_version_id].join(':')
   if(briefSelection.current?.identity!==identity)briefSelection.current={identity,input,operationKey:crypto.randomUUID(),frozen:null}
   const selection=briefSelection.current
   if(!selection.frozen)selection.frozen=await studio.freezeCreativeBrief(selection.input)
   if(!current())return
   if(!privateMode&&!websiteMode){
    const frozen=selection.frozen?.brief
    if(!frozen?.id||frozen.frozen_version_id!==input.creative_brief_version_id)throw Error('Saved brief confirmation could not be verified.')
    const result=await studio.createManualDirection({creative_brief_id:frozen.id,creative_brief_version_id:frozen.frozen_version_id,expected_revision:frozen.revision,operation_key:selection.operationKey,engagement_id:engagement.id,engagement_service_id:serviceId})
    if(!current())return
    if(!result?.version?.id||result.version.creative_brief_version_id!==frozen.frozen_version_id)throw Error('Saved direction could not be verified. Retry this selection to recover it.')
   }
   await refresh();setOpen(true);setTab('brief');setNotice('Exact saved brief selected. Draft only; no business approval or generation was performed.');briefSelection.current=null
  }
  catch(e){if(current())setNotice(e.message||'Brief selection unavailable.')}
  finally{flight.current=false;if(current())setBusy('')}
 }
 const onConversationChange=useCallback((value,validate)=>{privateValidator.current=validate;conversationRef.current=value;const identity=JSON.stringify([value?.id,value?.owner_id,value?.organization_id,value?.state,value?.project_id,value?.engagement_id]);if(selectedConversationIdentity.current!==identity){selectedConversationIdentity.current=identity;setGeneratedJobs([]);setFocusedGenerated(null);setWebsiteMessages([]);setWebsitePrompt(null);setOpen(false);setBriefOpen(false);setPreparing(false)}setConversation(value);setPreferredInput(previous=>previous?.conversationId===value?.id?previous:null)},[])
 function originalInScope(job){const context=job?.request?.context;return current()&&job?.request?.organization_id===organizationId&&(privateMode?context?.kind==='private'&&context.id===conversation?.id:context?.kind==='engagement'&&context.id===engagement.id)}
 function openGeneratedOutput(job){if(!originalInScope(job))return;setFocusedGenerated(job);setOpen(true);setTab('preview')}
 function receiveGenerated(job,ready=false){if(conversationRef.current?.id!==conversation?.id||!originalInScope(job))return;if(job.conversation_id===conversation?.id)setGeneratedJobs(rows=>[job,...rows.filter(row=>row.id!==job.id)]);else if(ready)openGeneratedOutput(job)}
 const generatedMedia=<DesignGeneratedConversationResults key={JSON.stringify([conversation?.id,conversation?.owner_id])} studio={studio} access={originalAccess} organizationId={organizationId} userId={userId} conversation={conversation} signal={signal} liveJobs={generatedJobs} onOpenOutput={openGeneratedOutput}/>

 const officialImages=privateMode?[]:officialDesignImageSources(workspace,organizationId,engagement.id)
 async function uploadAsset(input){
  if(flight.current||!current()||privateMode||locked||!capabilities.createDraft||!serviceId||!services.some(s=>s.id===serviceId))throw Error('Choose an active authorized Design service before uploading.')
  if(input.engagement_id!==engagement.id||input.brand_id!==workspace?.engagement?.brand_id)throw Error('Upload context changed.')
  flight.current=true;setBusy('asset-upload');setNotice('')
  try{
   const result=await studio.uploadAssetVersion(input)
   if(!current())return
   if(!result?.version?.id||result.version.organization_id!==organizationId||result.asset?.engagement_id!==engagement.id||result.asset?.brand_id!==input.brand_id)throw Error('Upload readback could not be verified. Keep this selection and recover the same upload.')
   await refresh()
   if(current()){setUploadOpen(false);setNotice('Project image saved as an unapproved version. Select it in the brief or as an animation input. Nothing was sent to a model.')}
   return result
  }finally{flight.current=false;if(current())setBusy('')}
 }
 useEffect(()=>{const panel=attachmentPanel.current;if(attachmentsOpen){panel?.showPopover?.();panel?.focus()}else if(panel?.matches?.(':popover-open'))panel.hidePopover?.()},[attachmentsOpen])
 const onUseImage=(source,purpose)=>{
  if(locked||!source?.id||!/^[a-f0-9]{64}$/.test(source?.checksum||'')||!['private_attachment','design_asset_version'].includes(source.kind)||!['motion','image'].includes(purpose))return
  if(source.kind==='private_attachment'&&(!privateMode||purpose!=='motion'||!generationContextReady))return
  if(source.kind==='design_asset_version'&&!officialImages.some(item=>item.id===source.id&&item.checksum===source.checksum))return
  setAttachmentsOpen(false);setPreferredInput({source,purpose,conversationId:conversation?.id});setMode(purpose);setPreparing(false);setBriefOpen(true);setNotice('Starting image chosen. Confirm the intended brief version, then Prepare generation and review exact image transfer consent. Nothing was sent.');panelRef.current?.scrollIntoView({block:'nearest'});panelRef.current?.focus()
 }
 const attachControl=<button ref={attachmentButton} type="button" disabled={locked} aria-label="Attach files" aria-expanded={attachmentsOpen} onClick={()=>setAttachmentsOpen(!attachmentsOpen)}><span aria-hidden="true">📎</span> Attach</button>
 const toolbar=<div className="design-unified-toolbar"><button type="button" disabled={locked} onClick={()=>{if(locked)return;openBrief()}}>Edit brief</button><button type="button" aria-expanded={open} onClick={()=>setOpen(!open)}>{open?'Hide output':'Output'}</button>{confirmed&&<span className="design-brief-chip">Confirmed brief · v{confirmed.version_number}</span>}</div>
 const editor=<div hidden={preparing} className="design-unified-editor">
  <h3>Editable brief</h3><p>Discuss ideas in chat and edit the brief here. Sending includes this editable brief. Chat saves an updated, unapproved draft when appropriate; your newer manual edits are preserved.</p>
  {privateMode?<label>Existing brief<select aria-label="Existing private brief" value={briefId} disabled={dirty||locked} onChange={e=>setBriefId(e.target.value)}><option value="">Create brief here</option>{(workspace?.creativeBriefs||[]).filter(b=>b.visibility==='private'&&b.created_by===userId).map(b=><option key={b.id} value={b.id}>{latestBriefVersion(b,workspace.creativeBriefVersions)?.content?.title||'Untitled brief'}</option>)}</select></label>:<label>Design service<select aria-label="Design brief service" value={serviceId} disabled={dirty||locked} onChange={e=>setServiceId(e.target.value)}><option value="">Choose an active service</option>{services.map(s=><option key={s.id} value={s.id}>{(Array.isArray(s.service_catalog)?s.service_catalog[0]:s.service_catalog)?.name||'Design service'}</option>)}</select></label>}
  {workspace&&(privateMode||serviceId)?<DesignCreativeBriefWorkspace ref={editorRef} outputTypeLabel="Design category" useBriefLabel="Confirm this version" key={editorRevision} workspace={workspace} activeServiceId={serviceId} visibility={privateMode?'private':'official'} selectedPrivateBriefId={briefId} busy={busy} canSave={capabilities.createDraft} onSave={save} onFreeze={useBrief} onDirtyChange={setDirty} onSummaryChange={setBriefSummary}/>:<p role="status">{workspace?'Select the service this brief belongs to.':'Loading available Design references…'}</p>}
  {dirty&&<button type="button" disabled={locked} onClick={()=>{setEditorRevision(x=>x+1);setDirty(false)}}>Discard unsaved brief edits</button>}
 </div>
 const composerAttachments=<section ref={attachmentPanel} tabIndex={-1} popover="manual" data-open={attachmentsOpen} className="design-attachments design-composer-attachments" aria-label="Design attachments" onKeyDown={event=>{if(event.key==='Escape'&&!locked&&!event.target.closest?.('dialog')){event.preventDefault();setAttachmentsOpen(false);attachmentButton.current?.focus()}}}>
   <div hidden={!attachmentsOpen}><header><h3>Attachments</h3><button type="button" disabled={locked} onClick={()=>{setAttachmentsOpen(false);attachmentButton.current?.focus()}}>Close attachments</button></header>
   <p>Choose how a file will be used. Adding a reference does not generate media or confirm a brief.</p>
   {privateMode?<p>Private files stay in this owner-only Design conversation. Uploaded images are chat references. Ready PNG/JPEG originals can also be selected separately for animation with explicit transfer consent.</p>:<>
    <label>Project image service<select aria-label="Project image service" disabled={dirty||locked} value={serviceId} onChange={event=>{setServiceId(event.target.value);setPreferredInput(null)}}><option value="">Choose an active service</option>{services.map(s=><option key={s.id} value={s.id}>{(Array.isArray(s.service_catalog)?s.service_catalog[0]:s.service_catalog)?.name||'Design service'}</option>)}</select></label>
    <h4>Project image</h4><p>Upload an official PNG version for this engagement. It can be selected as a brief reference or a starting image for animation. PNG only, up to 10 MiB.</p>
    <button type="button" disabled={locked||!workspace||!capabilities.createDraft||!services.some(s=>s.id===serviceId)} onClick={()=>setUploadOpen(true)}>Upload project PNG</button>
    {!serviceId&&<p>Choose a Design service below before uploading a project image.</p>}
    {uploadOpen&&workspace&&<DesignAssetUpload workspace={workspace} contextKey={`${organizationId}:${engagement.id}:${serviceId}`} canUpload={capabilities.createDraft&&!locked} busy={busy} onUpload={uploadAsset} onClose={()=>{if(!locked)setUploadOpen(false)}}/>}

    <h4>Chat source files</h4><p>For a saved project conversation, use PDF, DOCX, TXT or Markdown as text sources, or PNG/JPEG as reference-only files. Text use requires explicit consent; upload alone never sends a chat.</p>
    <p>Chat files need a saved conversation. A new conversation is saved on its first explicit Send.</p>
   </>}
   </div>
    {officialImages.length>0&&<ul hidden={!attachmentsOpen} aria-label="Project image originals">{officialImages.map(image=><li key={image.id}><strong>{image.label}</strong><p>Saved project original · not automatically sent.</p><button type="button" disabled={locked} onClick={()=>onUseImage(image,'image')}>Use for image-guided still</button><button type="button" disabled={locked} onClick={()=>onUseImage(image,'motion')}>Animate selected image</button></li>)}</ul>}
   {preferredInput&&<p className="design-selected-input">Starting image: {preferredInput.source.label} · {preferredInput.purpose==='motion'?'animation':'image-guided still'} · transfer permission still required</p>}
   <div ref={setAttachmentTarget}/><div hidden={!attachmentsOpen}>
   <details><summary>File support and limits</summary><p>DOCX extracts main-document text only, without OCR; embedded images are not interpreted. Text is limited to 16,000 characters per file and 24,000 per turn, with no silent truncation. PDF reads up to 20 pages of text only; encrypted or interactive PDFs and external resources are rejected. Scanned documents/OCR and legacy DOC are unsupported. MP4/MOV originals up to 20 MiB can be saved as separate owner-private video references in an existing chat. Videos are never sent to AI. Saved video references do not enable video analysis or editing. Images attached to chat remain references. Private PNG/JPEG uploads may be selected separately for animation, with exact original checks and separate Higgsfield transfer consent; they are not image-guided still-generation inputs.</p></details>
   </div>
  </section>
 const media=<aside id="design-floating-brief" popover="manual" hidden={!briefOpen} className="design-conversation-brief design-brief-float" role="dialog" aria-modal="false" aria-labelledby="design-floating-brief-title" aria-label="Design brief and execution" ref={panelRef} tabIndex={-1}>
  <header><div><h2 id="design-floating-brief-title">Brief</h2><p>{confirmed?`Confirmed v${confirmed.version_number}${latest?.id!==confirmed.id?' · newer draft needs confirmation':''}`:'No version confirmed yet'}{dirty?' · unsaved edits':''}</p></div><button type="button" disabled={locked} aria-label="Close brief" onClick={()=>{if(!locked)setBriefOpen(false)}}>Close</button></header>
  <div className="design-brief-panel-scroll">
  {editor}
  <div hidden={websiteMode}><div className="design-output-choice"><label>Output<select aria-label="Design output type" value={mode} disabled={locked} onChange={e=>{if(locked)return;setMode(e.target.value);setPreparing(false)}}><option value="image">Image · static</option><option value="motion">Motion image · animate an original</option><option value="video">Video · from the brief</option></select></label><p>{mode==='motion'?'Uses a saved original image from this context, with your explicit permission to transfer it.':'Uses the exact brief version you confirm. Choosing an output does not generate anything.'}</p></div>
  {!preparing?<><button type="button" disabled={!readyToPrepare} onClick={()=>setPreparing(true)}>Prepare generation</button>{!readyToPrepare&&<p role="status">{preparationNotice}</p>}</>:<><button type="button" disabled={locked} onClick={()=>setPreparing(false)}>Back to editable brief</button>{readyToPrepare||mediaBusy?<DesignUnifiedMediaComposer canManagePricing={['system_owner','operations_admin'].includes(membership?.role)} key={JSON.stringify([mode,brief?.id,brief?.frozen_version_id,serviceId,conversation?.id])} studio={studio} conversationId={conversation?.id} onRequestChange={job=>receiveGenerated(job)} onViewOutput={openGeneratedOutput} preferredInput={preferredInput} officialImages={officialImages} mode={mode==='motion'?'video':mode} outputKind={mode} organizationId={organizationId} userId={userId} context={privateMode?{kind:'private',id:conversation?.id}:{kind:'engagement',id:engagement.id,service_id:serviceId}} brief={brief} signal={signal} onBusyChange={setMediaBusy} onEditBrief={()=>setPreparing(false)} onOutput={job=>receiveGenerated(job,true)}/>:<p role="status">{generationContextReady?'Brief changed. Return to the editor and confirm the intended version.':preparationNotice}</p>}</>}
  </div>{websiteMode&&<p>Confirm the exact Website brief, then choose its page and Content version in Website design.</p>}
  {notice&&<p role="status">{notice}</p>}
  </div>
 </aside>
 const refreshReceiptStatus=async()=>{try{await refresh();if(current()){setReceiptRefreshBlocked(false);setNotice('Saved brief status refreshed. Review the intended version before continuing.')}}catch{if(current())setNotice('Saved brief status remains unavailable. Your edits are preserved.')}}
 const starters=<div className="design-empty-starters" aria-label="Design starters"><p>Discuss the purpose, audience and visual direction. Keep the brief in this conversation up to date.</p><button type="button" disabled={locked} onClick={()=>{if(locked)return;openBrief()}}>Start with the editable brief</button></div>
 const captureBriefForSend=()=>{
  if(!current()||locked||!editorRef.current)throw Error('Choose a Design brief context before sending.')
  return editorRef.current.captureForChat()
 }
 const applyBriefReceipt=async(sent,receipt)=>{
  if(!current()||!receipt)return
  const adopted=editorRef.current?.adoptChatResult(sent,receipt)
  if(receipt.status==='saved'){
   setReceiptRefreshBlocked(true);setPreparing(false)
   if(adopted){if(privateMode)setBriefId(receipt.result.brief.id);setDirty(false);setNotice('Chat saved an unapproved brief draft. Confirm its exact version before generation.')}
   else setNotice('Chat saved a draft; your newer manual edits remain unchanged. Review the saved version before continuing.')
   try{await refresh();if(current())setReceiptRefreshBlocked(false)}catch{if(current())setNotice('Saved draft refresh failed. Reload saved brief status before continuing.')}
  }else if(receipt.status==='question_only')setNotice('Chat needs more detail; the brief was not changed.')
  else if(receipt.status==='conflict'){setReceiptRefreshBlocked(true);setNotice('The saved brief changed. Your edits remain; review the newer version before continuing.');try{await refresh();if(current())setReceiptRefreshBlocked(false)}catch{if(current())setNotice('Saved draft refresh failed. Reload saved brief status before continuing.')}}
  else if(receipt.status==='pending')setNotice('Brief update is pending. Recover this send; do not send it again.')
  else if(receipt.status==='invalid')setNotice('The reply did not contain a valid brief update. Your draft is unchanged.')
 }
 const onConversationMessages=useCallback((value,items)=>{if(value?.id&&value.id===conversationRef.current?.id)setWebsiteMessages(items.filter(message=>message.conversation_id===value.id))},[])
 const bridge={onConversationMessages,draftSuggestion:websitePrompt,captureBriefForSend,applyBriefReceipt,mode:'chat',toolbar,attachControl,composerAttachments,attachmentsOpen,onUseImage,attachmentTarget,toolbarTarget:null,starters,media:null,generatedMedia,generatedConversationId:conversation?.id,onConversationChange}
 const summary=briefSummary?.briefId===(brief?.id||'')&&briefSummary?.serviceId===(serviceId||'')?briefSummary:null
 const briefCard=<button ref={briefButton} type="button" className="design-brief-summary" aria-label="Open Design brief" aria-haspopup="dialog" aria-controls="design-floating-brief" aria-expanded={briefOpen} disabled={locked} onClick={openBrief}>
  <span className="design-brief-summary-label">Brief</span><strong>{summary?.title||latest?.content?.title||'Shape your brief'}</strong>
  <span>{dirty?'Unsaved edits':latest?`Draft v${latest.version_number}`:'Unsaved brief'}{confirmed?` · Confirmed v${confirmed.version_number}`:' · Not confirmed'}</span>
  <small>{busy==='save-brief'?'Saving…':summary?.error?'Save needs attention':summary?.conflict?'Review version conflict':summary?summary.missing?`${summary.missing} details to complete`:'Details complete':'Open to review details'} · {briefOpen?'Editor open':'Open editor'}</small>
 </button>
 const websitePanel=websiteMode?(privateMode?<section aria-label="Private Website concepts"><p>Use this private chat to explore ideas. Choose a project in Design to bind a registered page, saved copy and official Website draft. Private ideas are never transferred automatically.</p></section>:workspace?<DesignWebsiteWorkspace workspace={workspace} brief={brief} confirmed={confirmed} dirtyBrief={dirty} organizationId={organizationId} userId={userId} engagement={engagement} signal={signal} messages={websiteMessages} onPrompt={value=>setWebsitePrompt(value?{...value,conversationId:conversationRef.current?.id||null}:null)} onDirtyChange={setWebsiteDirty} onBusyChange={setWebsiteBusy} disabled={Boolean(busy||mediaBusy||receiptRefreshBlocked)} canSave={capabilities.createDraft}/>:<p>Loading project Website sources…</p>):null
 const assets=privateMode?(records?.jobs||[]):(workspace?.mediaAssets||[])
 if(scopeAborted)return <p role="status">Organization access changed. Reopen Design in your current organization.</p>
 return <div className={`design-unified-workspace design-conversation-workspace${open?' output-open':''}`}><div className="design-unified-chat"><div className="design-website-mode-selector" aria-label="Design mode"><button type="button" aria-pressed={!websiteMode} disabled={locked||hasUnsavedDraft} onClick={()=>{if(!locked&&!hasUnsavedDraft){setWebsiteMode(false);setWebsitePrompt(null);setPreparing(false)}}}>Marketing creative</button><button type="button" aria-pressed={websiteMode} disabled={locked||hasUnsavedDraft} onClick={()=>{if(!locked&&!hasUnsavedDraft){setWebsiteMode(true);setPreparing(false)}}}>Website design</button></div>{briefCard}{websitePanel}{children(bridge)}{receiptRefreshBlocked&&<button type="button" onClick={refreshReceiptStatus}>Reload saved brief status</button>}</div>{media}{open&&<aside className="design-unified-output" aria-label="Design output"><header><h2>Output preview</h2><button type="button" onClick={()=>setOpen(false)}>Close output</button></header><div role="tablist" aria-label="Output view">{['preview','brief','versions'].map(value=><button type="button" role="tab" aria-selected={tab===value} key={value} onClick={()=>setTab(value)}>{value[0].toUpperCase()+value.slice(1)}</button>)}</div><div role="tabpanel">{tab==='brief'?latest?<><h3>{latest.content.title}</h3><p>{latest.content.purpose}</p><p>{latest.content.instructions}</p><small>Saved draft v{latest.version_number}{confirmed?.id===latest.id ? ' · confirmed for generation, not business approval' : ' · not the confirmed generation version'}</small><button type="button" disabled={locked} onClick={()=>{if(locked)return;openBrief()}}>Edit brief</button></>:<p>No brief selected. Create a brief in this conversation workspace.</p>:tab==='versions'?<>{(workspace?.creativeBriefVersions||[]).filter(v=>v.creative_brief_id===brief?.id).map(v=><p key={v.id}>{v.content.title} · v{v.version_number}</p>)}{versions.map(v=><p key={v.id}>{v.content?.title||'Direction'} · v{v.version_number}</p>)}{!latest&&!versions.length&&<p>No saved versions in this context.</p>}</>:<>{(focusedGenerated?[focusedGenerated]:generatedJobs.filter(job=>job.request?.creative_brief_version_id===brief?.frozen_version_id)).map(job=><DesignGeneratedMediaResult key={job.id} job={job} access={originalAccess} organizationId={organizationId} conversationId={job.chat_binding==='explicit'?job.conversation_id:null} signal={signal} large/>)}{assets.filter(a=>!privateMode||a.creative_brief_version_id===brief?.frozen_version_id).map(a=><figure key={a.id}>{a.signed_url&&a.media_type==='image'?<img src={a.signed_url} alt={a.prompt||'Saved Design output'}/>:null}<figcaption>{a.media_type||'Image'} · {a.status}</figcaption></figure>)}{!assets.length&&!generatedJobs.length&&<p>Your generated output will appear here.</p>}</>}</div></aside>}</div>
}
