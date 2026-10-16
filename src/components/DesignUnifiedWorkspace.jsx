import {useCallback,useEffect,useMemo,useRef,useState} from 'react'
import {useAuth} from '../context/AuthContext.jsx'
import {useOrganization} from '../context/OrganizationContext.jsx'
import {designWorkshop} from '../data/designWorkshopRepository.js'
import {designCapabilities} from '../data/designWorkshopContext.js'
import {creativeBriefForContext,latestBriefVersion} from '../data/designCreativeBriefs.js'
import {eligibleDesignVersions} from '../data/designChatTools.js'
import DesignCreativeBriefWorkspace from './DesignCreativeBriefWorkspace.jsx'
import DesignUnifiedMediaComposer from './DesignUnifiedMediaComposer.jsx'
import './designUnifiedWorkspace.css'

// Coordinates presentation only. Canonical repositories retain authority, revisions and receipts.
export default function DesignUnifiedWorkspace({engagement=null,onNavigationBusyChange,children}) {
 const {user}=useAuth(),{activeOrganizationId,scopeRevision,activeMembership,requestSignal}=useOrganization()
 return <ScopedDesignUnifiedWorkspace key={`${user?.id}:${activeOrganizationId}:${scopeRevision}:${engagement?.id||'private'}`} engagement={engagement} userId={user?.id} organizationId={activeOrganizationId} membership={activeMembership} signal={requestSignal} onNavigationBusyChange={onNavigationBusyChange}>{children}</ScopedDesignUnifiedWorkspace>
}
function ScopedDesignUnifiedWorkspace({engagement,userId,organizationId,membership,signal,onNavigationBusyChange,children}){
 const privateMode=!engagement,capabilities=designCapabilities(membership)
 const studio=useMemo(()=>designWorkshop.forOrganization(organizationId,{signal}),[organizationId,signal])
 const [mode,setMode]=useState('image'),[preparing,setPreparing]=useState(false),[workspace,setWorkspace]=useState(null),[records,setRecords]=useState(null),[serviceId,setServiceId]=useState(''),[briefId,setBriefId]=useState(''),[conversation,setConversation]=useState(null)
 const [open,setOpen]=useState(false),[tab,setTab]=useState('preview'),[notice,setNotice]=useState(''),[busy,setBusy]=useState(''),[dirty,setDirty]=useState(false),[mediaBusy,setMediaBusy]=useState(false),[editorRevision,setEditorRevision]=useState(0)
 const [scopeAborted,setScopeAborted]=useState(Boolean(signal?.aborted))
 useEffect(()=>{const stop=()=>setScopeAborted(true);signal?.addEventListener('abort',stop,{once:true});return()=>signal?.removeEventListener('abort',stop)},[signal])
 const alive=useRef(true),flight=useRef(false),privateValidator=useRef(null),briefSelection=useRef(null)
 const [generatedJobs,setGeneratedJobs]=useState([])
 const hasUnsavedDraft=dirty
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
 const locked=Boolean(busy||mediaBusy)
 useEffect(()=>{onNavigationBusyChange?.(locked||hasUnsavedDraft);return()=>onNavigationBusyChange?.(false)},[locked,hasUnsavedDraft,onNavigationBusyChange])
 useEffect(()=>{if(!locked&&!hasUnsavedDraft)return;const guard=e=>{e.preventDefault();if(e.type==='beforeunload')e.returnValue=''};window.addEventListener('beforeunload',guard);window.addEventListener('anka:organization-change',guard);return()=>{window.removeEventListener('beforeunload',guard);window.removeEventListener('anka:organization-change',guard)}},[locked,hasUnsavedDraft])
 const services=(workspace?.designServices||[]).filter(s=>s.status==='active'&&(Array.isArray(s.service_catalog)?s.service_catalog[0]:s.service_catalog)?.department_id==='design')
 const brief=privateMode?(workspace?.creativeBriefs||[]).find(b=>b.id===briefId&&b.visibility==='private'&&b.created_by===userId):creativeBriefForContext(workspace?.creativeBriefs,organizationId,engagement.id,serviceId)
 const latest=latestBriefVersion(brief,workspace?.creativeBriefVersions)
 const confirmed=(workspace?.creativeBriefVersions||[]).find(v=>v.id===brief?.frozen_version_id&&v.creative_brief_id===brief?.id)
 const readyToPrepare=Boolean(confirmed&&latest?.id===confirmed.id&&!dirty&&!locked)
 const panelRef=useRef(null)
 const versions=privateMode?[]:eligibleDesignVersions(workspace,{organizationId,projectId:engagement.project_id,engagementId:engagement.id})
 async function save(input){
  if(flight.current||!current()||!capabilities.createDraft)return false
  flight.current=true;setBusy('save-brief');setNotice('')
  try{const result=await studio.saveCreativeBrief(input);if(!current())return false;await refresh();if(privateMode&&result?.brief?.id)setBriefId(result.brief.id);setDirty(false);setPreparing(false);setNotice('Draft version saved. This is not business approval.');return result}
  catch(e){if(current())setNotice(e.message||'Save unavailable; your edits remain here.');return false}
  finally{flight.current=false;if(current())setBusy('')}
 }
 async function useBrief(input){
  if(flight.current||hasUnsavedDraft||!current()||!capabilities.createDraft)return
  flight.current=true;setBusy('freeze-brief');setNotice('')
  try{
   const identity=[input.creative_brief_id,input.creative_brief_version_id].join(':')
   if(briefSelection.current?.identity!==identity)briefSelection.current={identity,input,operationKey:crypto.randomUUID(),frozen:null}
   const selection=briefSelection.current
   if(!selection.frozen)selection.frozen=await studio.freezeCreativeBrief(selection.input)
   if(!current())return
   if(!privateMode){
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
 const onConversationChange=useCallback((value,validate)=>{privateValidator.current=validate;setConversation(value)},[])
 const toolbar=<div className="design-unified-toolbar"><button type="button" disabled={locked} onClick={()=>{if(locked)return;setPreparing(false);panelRef.current?.scrollIntoView({block:'nearest'});panelRef.current?.focus()}}>Edit brief</button><button type="button" aria-expanded={open} onClick={()=>setOpen(!open)}>{open?'Hide output':'Output'}</button>{confirmed&&<span className="design-brief-chip">Confirmed brief · v{confirmed.version_number}</span>}</div>
 const editor=<div hidden={preparing} className="design-unified-editor">
  <h3>Editable brief</h3><p>Discuss ideas in chat and edit the brief here. Chat suggestions are not applied automatically.</p>
  {privateMode?<label>Existing brief<select aria-label="Existing private brief" value={briefId} disabled={dirty||locked} onChange={e=>setBriefId(e.target.value)}><option value="">Create brief here</option>{(workspace?.creativeBriefs||[]).filter(b=>b.visibility==='private'&&b.created_by===userId).map(b=><option key={b.id} value={b.id}>{latestBriefVersion(b,workspace.creativeBriefVersions)?.content?.title||'Untitled brief'}</option>)}</select></label>:<label>Design service<select aria-label="Design brief service" value={serviceId} disabled={dirty||locked} onChange={e=>setServiceId(e.target.value)}><option value="">Choose an active service</option>{services.map(s=><option key={s.id} value={s.id}>{(Array.isArray(s.service_catalog)?s.service_catalog[0]:s.service_catalog)?.name||'Design service'}</option>)}</select></label>}
  {workspace&&(privateMode||serviceId)?<DesignCreativeBriefWorkspace outputTypeLabel="Design category" useBriefLabel="Confirm this version" key={editorRevision} workspace={workspace} activeServiceId={serviceId} visibility={privateMode?'private':'official'} selectedPrivateBriefId={briefId} busy={busy} canSave={capabilities.createDraft} onSave={save} onFreeze={useBrief} onDirtyChange={setDirty}/>:<p role="status">{workspace?'Select the service this brief belongs to.':'Loading available Design references…'}</p>}
  {dirty&&<button type="button" disabled={locked} onClick={()=>{setEditorRevision(x=>x+1);setDirty(false)}}>Discard unsaved brief edits</button>}
 </div>
 const media=<aside className="design-conversation-brief" aria-label="Design brief and execution" ref={panelRef} tabIndex={-1}>
  <header><h2>Brief</h2><p>{confirmed?`Confirmed v${confirmed.version_number}${latest?.id!==confirmed.id?' · newer draft needs confirmation':''}`:'No version confirmed yet'}{dirty?' · unsaved edits':''}</p></header>
  <div className="design-brief-panel-scroll">
  {editor}
  <div className="design-output-choice"><label>Output<select aria-label="Design output type" value={mode} disabled={locked} onChange={e=>{if(locked)return;setMode(e.target.value);setPreparing(false)}}><option value="image">Image · static</option><option value="motion">Motion image · animate an original</option><option value="video">Video · from the brief</option></select></label><p>{mode==='motion'?'Uses a saved original image from this context, with your explicit permission to transfer it.':'Uses the exact brief version you confirm. Choosing an output does not generate anything.'}</p></div>
  {!preparing?<><button type="button" disabled={!readyToPrepare} onClick={()=>setPreparing(true)}>Prepare generation</button>{!readyToPrepare&&<p>Save your edits and confirm the latest exact version before preparing generation.</p>}</>:<><button type="button" disabled={locked} onClick={()=>setPreparing(false)}>Back to editable brief</button>{readyToPrepare||mediaBusy?<DesignUnifiedMediaComposer key={JSON.stringify([mode,brief?.id,brief?.frozen_version_id,serviceId,conversation?.id])} studio={studio} mode={mode==='motion'?'video':mode} outputKind={mode} organizationId={organizationId} userId={userId} context={privateMode?{kind:'private',id:conversation?.id}:{kind:'engagement',id:engagement.id,service_id:serviceId}} brief={brief} signal={signal} onBusyChange={setMediaBusy} onEditBrief={()=>setPreparing(false)} onOutput={job=>{setGeneratedJobs(current=>[job,...current.filter(value=>value.id!==job.id)]);setOpen(true);setTab('preview')}}/>:<p>Brief changed. Return to the editor and confirm the intended version.</p>}</>}
  {notice&&<p role="status">{notice}</p>}
  </div>
 </aside>
 const starters=<div className="design-empty-starters" aria-label="Design starters"><p>Discuss the purpose, audience and visual direction. Keep the brief beside this conversation up to date.</p><button type="button" disabled={locked} onClick={()=>{if(locked)return;setPreparing(false);panelRef.current?.scrollIntoView({block:'nearest'});panelRef.current?.focus()}}>Start with the editable brief</button></div>
 const bridge={mode:'chat',toolbar,toolbarTarget:null,starters,media:null,onConversationChange}
 const assets=privateMode?(records?.jobs||[]):(workspace?.mediaAssets||[])
 if(scopeAborted)return <p role="status">Organization access changed. Reopen Design in your current organization.</p>
 return <div className={`design-unified-workspace design-conversation-workspace${open?' output-open':''}`}><div className="design-unified-chat">{children(bridge)}</div>{media}{open&&<aside className="design-unified-output" aria-label="Design output"><header><h2>Output preview</h2><button type="button" onClick={()=>setOpen(false)}>Close output</button></header><div role="tablist" aria-label="Output view">{['preview','brief','versions'].map(value=><button type="button" role="tab" aria-selected={tab===value} key={value} onClick={()=>setTab(value)}>{value[0].toUpperCase()+value.slice(1)}</button>)}</div><div role="tabpanel">{tab==='brief'?latest?<><h3>{latest.content.title}</h3><p>{latest.content.purpose}</p><p>{latest.content.instructions}</p><small>Saved draft v{latest.version_number}{confirmed?.id===latest.id ? ' · confirmed for generation, not business approval' : ' · not the confirmed generation version'}</small><button type="button" disabled={locked} onClick={()=>{if(locked)return;setPreparing(false);panelRef.current?.focus()}}>Edit brief</button></>:<p>No brief selected. Create a brief in this conversation workspace.</p>:tab==='versions'?<>{(workspace?.creativeBriefVersions||[]).filter(v=>v.creative_brief_id===brief?.id).map(v=><p key={v.id}>{v.content.title} · v{v.version_number}</p>)}{versions.map(v=><p key={v.id}>{v.content?.title||'Direction'} · v{v.version_number}</p>)}{!latest&&!versions.length&&<p>No saved versions in this context.</p>}</>:<>{generatedJobs.filter(job=>job.request?.creative_brief_version_id===brief?.frozen_version_id).flatMap(job=>(job.outputs||[]).map(output=><figure key={output.id}>{output.mime_type.startsWith('image/')?<img src={output.signed_url} alt="Generated original"/>:<video controls src={output.signed_url}/>}<figcaption>Saved original</figcaption></figure>))}{assets.filter(a=>!privateMode||a.creative_brief_version_id===brief?.frozen_version_id).map(a=><figure key={a.id}>{a.signed_url&&a.media_type==='image'?<img src={a.signed_url} alt={a.prompt||'Saved Design output'}/>:null}<figcaption>{a.media_type||'Image'} · {a.status}</figcaption></figure>)}{!assets.length&&!generatedJobs.length&&<p>Your generated output will appear here.</p>}</>}</div></aside>}</div>
}
