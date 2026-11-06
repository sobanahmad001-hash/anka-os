import {useCallback,useEffect,useMemo,useRef,useState} from 'react'
import {useOrganization} from '../context/OrganizationContext.jsx'
import {supabase} from '../lib/supabase.js'
import {createProjectChatNativeDesignRepository} from '../data/projectChatNativeDesignRepository.js'
import {createProjectChatActionRepository} from '../data/projectChatActionRepository.js'
import {createDesignWorkshopScope} from '../data/designWorkshopRepository.js'
import {createProjectAssetRelationsRepository} from '../data/projectAssetRelationsRepository.js'
import {createProjectStagePlanRepository} from '../data/projectStagePlanRepository.js'
import {websiteNative} from '../data/websiteNative.js'
import {projectWebsitePages} from '../data/projectWebsitePages.js'
import {designCapabilities} from '../data/designWorkshopContext.js'
import {chatDesignPrerequisites,currentDesignWork} from '../data/projectChatDesignContext.js'
import {workRecordPath} from '../data/workItemExperience.js'
import {websiteNativeLayout,prepareWebsiteNativeManifest,readWebsiteLayoutProposal,websiteLayoutPrompt} from '../../supabase/functions/_shared/websiteNativeDraft.js'
import {compileWebsiteNativeDesign} from '../data/websiteNativeDesign.js'
import DesignWebsiteLayoutControls from './DesignWebsiteLayoutControls.jsx'
import './projectChatDesignActions.css'

const EMPTY=[]
const observe=(promise,ms)=>{let timer;return Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Object.assign(Error('Result uncertain. Check the original Design request.'),{outcome:'unknown'})),ms)})]).finally(()=>clearTimeout(timer))}
export default function ProjectChatDesignActions(props){const {activeMembership}=useOrganization();return <ChatDesignActions {...props} canSave={designCapabilities(activeMembership).createDraft}/>}
export function ChatDesignActions({workspace,actorId,conversationId,messages=EMPTY,request,onRequestHandled,onStateChange,onChanged,onPrompt,disabled=false,signal,canSave=false,repository:injected,studio:injectedStudio,native:injectedNative,relations:injectedRelations,stages:injectedStages,pages:injectedPages,contentRepository:injectedContent,timeoutMs=15000}){
 const organizationId=workspace.project.organization_id,projectId=workspace.project.id,engagementId=workspace.engagement.id
 const scope=useMemo(()=>({organization_id:organizationId,project_id:projectId,conversation_id:conversationId}),[organizationId,projectId,conversationId])
 const nativeScope=useMemo(()=>({organizationId,projectId,engagementId}),[organizationId,projectId,engagementId])
 const key=`anka:chat-native-design:${actorId}:${organizationId}:${projectId}:${engagementId}:${conversationId}`
 const repository=useMemo(()=>injected||createProjectChatNativeDesignRepository(supabase),[injected])
 const contentRepository=useMemo(()=>injectedContent||createProjectChatActionRepository(supabase),[injectedContent])
 const studio=useMemo(()=>injectedStudio||createDesignWorkshopScope(organizationId,{signal}),[injectedStudio,organizationId,signal])
 const relations=useMemo(()=>injectedRelations||createProjectAssetRelationsRepository(supabase),[injectedRelations])
 const stages=useMemo(()=>injectedStages||createProjectStagePlanRepository(supabase),[injectedStages])
 const native=injectedNative||websiteNative,pages=injectedPages||projectWebsitePages
 const [receipts,setReceipts]=useState([]),[offset,setOffset]=useState(0),[more,setMore]=useState(false)
 const [editor,setEditor]=useState(null),[source,setSource]=useState(null),[layout,setLayout]=useState(null),[preview,setPreview]=useState(null),[proposal,setProposal]=useState(null)
 const [pageId,setPageId]=useState(''),[briefId,setBriefId]=useState(''),[siteId,setSiteId]=useState(''),[pageOffset,setPageOffset]=useState(0)
 const [busy,setBusy]=useState(false),[dirty,setDirty]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState(''),[replyId,setReplyId]=useState(''),[replyProposal,setReplyProposal]=useState(null)
 const [pending,setPending]=useState(()=>{try{const v=JSON.parse(sessionStorage.getItem(key)||'null');if(v&&(v.proposal?.identity?.organization_id!==organizationId||v.proposal.identity.project_id!==projectId||v.proposal.identity.conversation_id!==conversationId||v.proposal.context?.engagement_id!==engagementId))throw Error();return v}catch{return {unreadable:true}}})
 const alive=useRef(false),generation=useRef(0),flight=useRef(false),seen=useRef(null),current=useRef(null),root=useRef(null)
 current.current={disabled,pending,canSave}
 const valid=useCallback(token=>alive.current&&!signal?.aborted&&(token===undefined||token===generation.current),[signal])
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;generation.current++}},[])
 useEffect(()=>{onStateChange?.({busy:busy||Boolean(pending),dirty});return()=>onStateChange?.({busy:false,dirty:false})},[busy,pending,dirty,onStateChange])
 const locked=disabled||busy||Boolean(pending)
 async function run(fn,recovery=false){if(flight.current||!valid()||current.current.disabled||(!recovery&&current.current.pending))return;flight.current=true;setBusy(true);setError('');const token=++generation.current;try{return await fn(token)}catch(e){if(valid(token))setError(e.message)}finally{flight.current=false;if(valid(token))setBusy(false)}}
 const loadHistory=useCallback(async (next=0)=>{const token=generation.current,data=await repository.list(scope,{limit:25,offset:next,signal});if(valid(token)){const rows=data.items.filter(r=>r.actor_id===actorId&&r.engagement_id===engagementId);setReceipts(old=>next?[...old,...rows.filter(r=>!old.some(p=>p.request_id===r.request_id))]:rows);setMore(data.has_more);setOffset(next)}},[repository,scope,signal,valid,actorId,engagementId])
 useEffect(()=>{loadHistory().catch(e=>{if(valid())setError(e.message)})},[loadHistory,valid])
 async function originalHandoff(receipt){
  if(receipt?.kind!=='handoff_design'||receipt.status!=='handoff_recorded'||receipt.actor_id!==actorId||receipt.organization_id!==organizationId||receipt.project_id!==projectId||receipt.engagement_id!==engagementId||receipt.conversation_id!==conversationId)throw Error('Open an original Design handoff in this owned conversation.')
  if(!messages.some(m=>m.id===receipt.source_message_id&&m.conversation_id===conversationId&&m.role==='user'&&m.author_id===actorId))throw Error('Load the original human message before continuing Design.')
  const result=await contentRepository.recover({organizationId,projectId,conversationId,sourceMessageId:receipt.source_message_id,requestId:receipt.request_id})
  if(result.status!=='recorded'||result.receipt.request_id!==receipt.request_id||result.receipt.handoff?.receiving_work_item_id!==receipt.handoff.receiving_work_item_id||result.receipt.output.content_checksum!==receipt.output.content_checksum)throw Error('The original handoff could not be verified.')
  return result.receipt
 }
 async function openEditor(receipt,parent,token){
  const handoff=await originalHandoff(receipt)
  const [data,history]=await Promise.all([studio.load(engagementId,{workRecord:{kind:'engagement_work_item',id:handoff.handoff.receiving_work_item_id}}),native.workspace(nativeScope,{signal})])
  if(data.engagement?.id!==engagementId||data.engagement.organization_id!==organizationId||data.engagement.project_id!==projectId)throw Error('Design workspace changed.')
  const base=chatDesignPrerequisites(data,handoff,history,null),registered=await pages.list({...nativeScope,architectureVersionId:base.architectureId,offset:0,limit:25},{signal})
  const options=chatDesignPrerequisites(data,handoff,history,registered)
  const previous=parent?await repository.design({organization_id:organizationId,project_id:projectId,engagement_id:engagementId},parent.output.design_id,{signal}):null
  if(previous&&(previous.page_id!==parent.output.page_id||previous.version_number!==parent.output.version_number))throw Error('The exact parent draft is unavailable.')
  if(valid(token)){setEditor({handoff,data,history,options,registered,parent,previous});setPageId(options.pages.length===1?options.pages[0].page_id:'');setBriefId(options.briefs.length===1?options.briefs[0].id:'');setSiteId(options.sites.length===1?options.sites[0].id:'');setSource(null);setLayout(null);setPreview(null);setProposal(null);setDirty(false);setPageOffset(0);setNotice('');root.current?.focus()}
 }
 async function start(receipt,parent=null){return run(token=>openEditor(receipt,parent,token))}
 useEffect(()=>{if(request?.id&&seen.current!==request.id&&!locked&&!dirty){seen.current=request.id;void start(request.receipt).finally(()=>onRequestHandled?.(request.id))}},[request,locked,dirty]) // eslint-disable-line react-hooks/exhaustive-deps
 async function refreshPages(next){await run(async token=>{const registered=await pages.list({...nativeScope,architectureVersionId:editor.options.architectureId,offset:next,limit:25},{signal});if(valid(token)){const options=chatDesignPrerequisites(editor.data,editor.handoff,editor.history,registered);setEditor({...editor,registered,options});setPageOffset(next);setPageId(options.pages.length===1?options.pages[0].page_id:'')}})}
 async function loadSources(){await run(async token=>{onPrompt?.(null);
  if(!canSave||!editor||!pageId||!briefId||!siteId)throw Error('Select the registered page, confirmed receiving-Work brief and saved site settings.')
  const h=await originalHandoff(editor.handoff)
  const refs=await Promise.all([h.source_work.id,h.handoff.receiving_work_item_id].map(subjectId=>relations.read({...nativeScope,subjectKind:'engagement_work_item',subjectId},{signal})))
  let selection=h.selection
  if(selection){const unit=await stages.readPartition(nativeScope,{planId:selection.plan_id,groupId:selection.group_id,partition:selection.partition,signal});if(unit.state!=='current'||unit.plan_id!==selection.plan_id||unit.group_id!==selection.group_id||['kind','id','architecture_version_id'].some(k=>unit.partition?.[k]!==selection.partition[k]))throw Error('Original page or stage changed.');selection={...selection,context_sha256:unit.context_sha256}}
  const context={engagement_id:engagementId,selection,handoff_request_id:h.request_id,source_work:currentDesignWork(refs[0],h.source_work.id),receiving_work:currentDesignWork(refs[1],h.handoff.receiving_work_item_id),page_id:pageId,architecture_version_id:editor.options.architectureId,brief_version_id:briefId,site_version_id:siteId,direction_version_id:null,expected_parent_design_id:editor.parent?.output.design_id||null}
  const identity={...scope,source_message_id:h.source_message_id,request_id:crypto.randomUUID()},value=await repository.load(identity,context,{signal})
  const next=layout|| (editor.previous?{...websiteNativeLayout(value),...editor.previous.manifest.layout}:websiteNativeLayout(value))
  const compiled=await compileWebsiteNativeDesign(await prepareWebsiteNativeManifest(value,next))
  if(valid(token)){setSource({identity,context,value});setLayout(next);setPreview(compiled.preview);setProposal(null);setReplyProposal(null);setNotice('Exact approved copy and receiving Work loaded. Review the draft before saving.')}
 })}
 function edit(next){setLayout(next);setDirty(true);setProposal(null);setReplyProposal(null);setPreview(null)}
 async function review(){await run(async token=>{if(!source||!canSave)throw Error('Load exact Design sources first.');const fresh=await repository.load(source.identity,source.context,{signal});const next=await repository.prepare({...source.identity,request_id:crypto.randomUUID()},source.context,fresh,layout);const compiled=await compileWebsiteNativeDesign(next.manifest);if(valid(token)){setProposal(next);setPreview(compiled.preview)}})}
 async function accept(receipt,token){if(!valid(token))return;if(receipt.actor_id!==actorId||receipt.engagement_id!==engagementId)throw Error('Saved Design belongs to another actor or engagement.');sessionStorage.removeItem(key);setPending(null);setProposal(null);setDirty(false);setSource(null);setEditor(null);setLayout(null);setPreview(null);setReceipts(old=>[receipt,...old.filter(r=>r.request_id!==receipt.request_id)]);setNotice(`Design draft v${receipt.output.version_number} saved. Review remains separate.`);try{await onChanged?.()}catch(e){if(valid(token))setError('Design saved; workspace refresh failed. '+e.message)}}
 async function confirm(){await run(async token=>{if(!proposal||!canSave)return;const original={proposal,layout};sessionStorage.setItem(key,JSON.stringify(original));setPending(original);try{await accept(await observe(repository.confirm(proposal,{signal}),timeoutMs),token)}catch(e){if(valid(token)){if(e.knownRollback){sessionStorage.removeItem(key);setPending(null);setProposal(null)}else{setProposal(null)}}throw e}})}
 async function recover(){await run(async token=>{if(!pending?.proposal)throw Error('Original recovery identity is unavailable. Read saved Design history.');const result=await observe(repository.recover(pending.proposal.identity,{signal}),timeoutMs);if(result.status==='recorded')await accept(result.receipt,token);else if(valid(token))setNotice('No original receipt is visible. This does not permit resubmitting.')},true)}
 async function saved(receipt,revise=false){await run(async token=>{
  const value=await repository.design({organization_id:organizationId,project_id:projectId,engagement_id:engagementId},receipt.output.design_id,{signal})
  if(value.page_id!==receipt.output.page_id||value.version_number!==receipt.output.version_number)throw Error('Saved design differs from its original receipt.')
  if(revise){const h=await contentRepository.recover({organizationId,projectId,conversationId,sourceMessageId:receipt.source_message_id,requestId:receipt.handoff_request_id});if(h.status!=='recorded')throw Error('Original Design handoff is unavailable.');if(valid(token))await openEditor(h.receipt,receipt,token)}
  else if(valid(token)){setPreview(value.html_content);setNotice(`Saved draft v${receipt.output.version_number}`)}
 })}
 function discard(){setEditor(null);setSource(null);setLayout(null);setPreview(null);setProposal(null);setDirty(false);setReplyProposal(null)}
 const replies=messages.filter(m=>m.role==='assistant'&&m.status==='completed'&&m.conversation_id===conversationId)
 return <section className="chat-design-actions design-website-workspace" aria-label="Design actions in this conversation" ref={root} tabIndex={-1}>
  {error&&<p role="alert">{error}</p>}{notice&&<p role="status">{notice}</p>}
  {pending&&<article><h3>Check original Design save</h3><p>The original reviewed draft is retained. Checking never sends it again.</p><button disabled={busy||disabled||pending.unreadable} onClick={recover}>Check saved Design result</button><details><summary>Original reviewed draft</summary><pre>{JSON.stringify(pending.proposal?.manifest,null,2)}</pre></details></article>}
  {editor&&!pending&&<article><h3>{editor.parent?'Revise saved Design draft':'Continue Design'}</h3><p>Exact approved Content · v{editor.handoff.output.version_number}</p><a href={workRecordPath('engagement_work_item',editor.handoff.handoff.receiving_work_item_id)}>Open receiving Design Work</a>
   {!source&&<fieldset disabled={locked||!canSave}><legend>Design prerequisites</legend>
    <label>Registered page<select value={pageId} onChange={e=>setPageId(e.target.value)}><option value="">Choose exact handed-off page</option>{editor.options.pages.map(p=><option key={p.page_id} value={p.page_id}>{p.source?.title||p.source?.page_key}</option>)}</select></label>
    {!editor.options.pages.length&&<p>The handed-off page is not on this loaded page of registered sources.</p>}
    <button disabled={!pageOffset} onClick={()=>refreshPages(Math.max(0,pageOffset-25))}>Previous registered pages</button><button disabled={pageOffset+25>=editor.registered.counts.filtered_total} onClick={()=>refreshPages(pageOffset+25)}>Next registered pages</button>
    <label>Confirmed Website brief<select value={briefId} onChange={e=>setBriefId(e.target.value)}><option value="">Choose receiving Work brief</option>{editor.options.briefs.map(b=><option key={b.id} value={b.id}>{b.content.title} · v{b.version_number}</option>)}</select></label>
    {!editor.options.briefs.length&&<p>Save and explicitly confirm a Website brief for this receiving Design Work and service in its existing Design controls, then refresh.</p>}
    <label>Site settings version<select value={siteId} onChange={e=>setSiteId(e.target.value)}><option value="">Choose saved site settings</option>{editor.options.sites.map(s=><option key={s.id} value={s.id}>{s.site.title} · v{s.version_number}</option>)}</select></label>
    {!editor.options.sites.length&&<p>Save project site settings in the existing Website Design controls, then refresh. No setup is created automatically.</p>}
    <button onClick={()=>start(editor.handoff,editor.parent)}>Refresh prerequisites</button><button disabled={!pageId||!briefId||!siteId} onClick={loadSources}>Load exact Design sources</button>
   </fieldset>}
   {source&&!proposal&&<DesignWebsiteLayoutControls context={source.value} layout={layout} locked={locked||!canSave} onChange={edit}>
    <button disabled={dirty} onClick={()=>onPrompt?.({id:crypto.randomUUID(),conversationId,text:'Suggest a responsive layout for this exact approved page. Keep the copy unchanged; I will review it.',layoutContext:{binding_key:source.value.review_sha256,instructions:websiteLayoutPrompt(source.value.review_sha256,layout)}})}>Draft layout request in Chat</button><label>Saved Chat layout reply<select value={replyId} onChange={e=>{setReplyId(e.target.value);setReplyProposal(null)}}><option value="">Choose a saved reply</option>{replies.map(r=><option key={r.id} value={r.id}>Reply · {r.id.slice(0,8)}</option>)}</select></label>
    <button disabled={!replyId} onClick={()=>run(async token=>{const proposed=readWebsiteLayoutProposal(replies.find(r=>r.id===replyId)?.body,source.value.review_sha256,layout.sections.map(s=>s.source_key));const next={...layout,...proposed};await prepareWebsiteNativeManifest(source.value,next);if(valid(token))setReplyProposal(next)})}>Review saved layout reply</button>
    <button onClick={loadSources}>Refresh exact sources</button><button onClick={review}>Review Design draft</button>
   </DesignWebsiteLayoutControls>}
   {replyProposal&&<article><h4>Review proposed layout</h4><p>{replyProposal.template} · {replyProposal.sections.length} sections. Exact approved copy is preserved.</p><button disabled={locked} onClick={()=>edit(replyProposal)}>Apply reviewed layout</button></article>}
   {proposal&&<article aria-label="Review Design save"><h4>Review Design draft</h4><p>{proposal.manifest.content.title} · {proposal.manifest.layout.template}</p><p>{proposal.context.expected_parent_design_id?'New revision of the explicitly selected saved draft.':'New native Website draft.'}</p><button className="chat-design-confirm" disabled={locked||!canSave} onClick={confirm}>Confirm Design save</button><button disabled={locked} onClick={()=>setProposal(null)}>Edit reviewed Design</button><details><summary>Exact reviewed sources</summary><pre>{JSON.stringify(proposal.context,null,2)}</pre></details></article>}
   <button disabled={locked} onClick={discard}>Discard Design edits</button>
  </article>}
  {preview&&<section><h3>Design preview</h3><p>Saved or reviewed draft · review remains separate.</p><iframe sandbox="" title="Project Chat Design preview" srcDoc={preview}/></section>}
  {receipts.map(r=><article key={r.request_id} aria-label="Saved Design result"><h3>Design draft saved · v{r.output.version_number}</h3><p>Receiving Work remains separate from draft review and completion.</p><a href={workRecordPath('engagement_work_item',r.receiving_work.id)}>Open receiving Design Work</a><button disabled={locked||dirty} onClick={()=>saved(r)}>Preview exact saved Design</button><button disabled={locked||dirty||!canSave} onClick={()=>saved(r,true)}>Revise this Design draft</button><button onClick={()=>document.getElementById('chat-message-'+r.source_message_id)?.scrollIntoView({block:'center'})}>View original message</button><details><summary>Original Design receipt</summary><pre>{JSON.stringify(r,null,2)}</pre></details></article>)}
  {more&&<button disabled={locked} onClick={()=>run(()=>loadHistory(offset+25),true)}>Load earlier Design results</button>}
 </section>
}
