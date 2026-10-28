import {useCallback,useEffect,useMemo,useRef,useState} from 'react'
import {Link} from 'react-router-dom'
import {supabase} from '../lib/supabase.js'
import {contentStudio} from '../data/contentStudioRepository.js'
import {projectDeliveryContext,projectDeliveryIntent} from '../data/projectDeliveryContext.js'
import {createProjectContentJourneyRepository} from '../data/projectContentJourneyRepository.js'
import {createProjectWorkCommandRepository} from '../data/projectWorkCommandRepository.js'
import {appendWorkshopNavigation} from '../data/workshopNavigation.js'
import {projectContentRequestProposal} from '../data/projectContentRequestProposal.js'
import ProjectWorkActions from './ProjectWorkActions.jsx'
import ContentChatWriterPane from './ContentChatWriterPane.jsx'
import ContentLibraryPanel from './ContentLibraryPanel.jsx'
import './projectContentJourney.css'
const reader=createProjectContentJourneyRepository(supabase)
const commands=createProjectWorkCommandRepository(supabase)
const EMPTY=[]
export default function ProjectContentJourney({workspace,conversationId,actorId,messages=EMPTY,owner,busy=false,request,onChanged,repository=reader,studio:providedStudio,workCommands=commands,onStateChange}){
 const context=useMemo(()=>projectDeliveryContext(workspace),[workspace])
 const scope=useMemo(()=>({...context,conversationId,actorId}),[context,conversationId,actorId])
 const studio=useMemo(()=>providedStudio||contentStudio.forOrganization(context.organizationId),[providedStudio,context.organizationId])
 const [links,setLinks]=useState([]),[workId,setWorkId]=useState(''),[messageId,setMessageId]=useState(''),[data,setData]=useState(null),[handoffs,setHandoffs]=useState([]),[versionId,setVersionId]=useState(''),[error,setError]=useState(''),[loading,setLoading]=useState(false),[writerBusy,setWriterBusy]=useState(false),[dirty,setDirty]=useState(false),[tab,setTab]=useState('write'),[revision,setRevision]=useState(0),[binding,setBinding]=useState(false)
 const sequence=useRef(0),flight=useRef(false),alive=useRef(true),current=useRef(null)
 const recoveryKey=`anka:content-journey:${actorId}:${context.organizationId}:${context.projectId}:${conversationId}`
 const [pending,setPending]=useState(()=>{try{return JSON.parse(sessionStorage.getItem(recoveryKey)||'null')}catch{return {kind:'storage_unavailable'}}})
 const [serviceId,setServiceId]=useState(''),[linkReview,setLinkReview]=useState(null)
 const [proposal,setProposal]=useState(null)
 useEffect(()=>{onStateChange?.({dirty,busy:writerBusy||binding||Boolean(pending)});return()=>onStateChange?.({dirty:false,busy:false})},[dirty,writerBusy,binding,pending,onStateChange])
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;sequence.current++}},[])
 const works=context.records.filter(r=>r.kind==='engagement_work_item'&&r.department==='content')
 const work=works.find(r=>r.id===workId)
 const selectedLink=links.find(l=>l.work_item_id===workId)
 const human=messages.filter(m=>m.role==='user'&&m.author_id===actorId)
 const blocked=busy||loading||writerBusy||binding||Boolean(pending)||Boolean(error)
 current.current={blocked,workId,versionId:versionId||data?.navigationWorkRecord?.linked_artifact_version_id,serviceId,linkReview,messageId,owner}
 const refresh=useCallback(async()=>{setRevision(x=>x+1);await onChanged?.()},[onChanged])
 const stateChanged=useCallback(s=>{setWriterBusy(s.saving);setDirty(s.dirty)},[])
 useEffect(()=>{const token=++sequence.current;setLoading(true);setError('');setData(current=>current?.navigationWorkRecord?.id===workId?current:null);setHandoffs([])
  if(!conversationId)return
  Promise.all([repository.list(scope),workId?studio.load(context.engagementId,{workRecord:{kind:'engagement_work_item',id:workId}}):Promise.resolve(null)]).then(async([next,loaded])=>{
   if(token!==sequence.current||!alive.current)return
   if(loaded&&(loaded.engagement.organization_id!==context.organizationId||loaded.engagement.project_id!==context.projectId||loaded.navigationWorkRecord?.id!==workId))throw Error('Content work no longer belongs to this project')
   setLinks(next);setData(loaded);if(!workId&&next.length===1){setWorkId(next[0].work_item_id);setMessageId(next[0].source_message_id)}
   const id=versionId||loaded?.navigationWorkRecord?.linked_artifact_version_id
   const rows=id?await repository.handoffs(scope,id):[]
   if(token===sequence.current&&alive.current)setHandoffs(rows)
  }).catch(e=>{if(token===sequence.current&&alive.current)setError(e.message)}).finally(()=>{if(token===sequence.current&&alive.current)setLoading(false)})
  return()=>{sequence.current++}
 },[repository,studio,conversationId,context.organizationId,context.projectId,context.engagementId,workId,revision,versionId,scope])
 const version=data?.versions.find(v=>v.id===(versionId||data.navigationWorkRecord?.linked_artifact_version_id))
 const artifact=version&&data?.artifacts.find(a=>a.id===version.artifact_id)
 const reviewRepository=useMemo(()=>({...studio,loadLibrary:()=>studio.loadLibrary({projectId:context.projectId,engagementId:context.engagementId,artifactId:artifact?.id}),confirmContentHandoff:async input=>{
  if(!alive.current||current.current.blocked||pending||flight.current||busy||!owner||!selectedLink||input.p_artifact_version_id!==current.current.versionId||input.p_artifact_version_id!==version?.id)throw Error('Refresh the exact tracked Content version before handoff')
  flight.current=true
  try{sessionStorage.setItem(recoveryKey,JSON.stringify({kind:'handoff',requestId:input.p_request_id,versionId:version.id}));setPending({kind:'handoff',requestId:input.p_request_id,versionId:version.id});const result=await studio.confirmContentHandoff(input);sessionStorage.removeItem(recoveryKey);if(alive.current){setPending(null);await refresh()}return result}finally{flight.current=false}
 }}),[studio,context.projectId,context.engagementId,artifact?.id,pending,busy,owner,selectedLink,version?.id,recoveryKey,refresh])
 async function recover(){if(flight.current||busy||!pending||pending.kind==='storage_unavailable')return;flight.current=true;setBinding(true);setError('');try{const result=pending.kind==='handoff'?await repository.recoverHandoff(scope,pending.requestId):await workCommands.recover(scope,pending.requestId);if(!result)throw Error('Original outcome is still unknown. Keep this request and check again; no second write was sent.');sessionStorage.removeItem(recoveryKey);if(alive.current){setPending(null);setLinkReview(null);await refresh()}}catch(e){if(alive.current)setError(e.message)}finally{flight.current=false;if(alive.current)setBinding(false)}}
 async function applyLink(){const now=current.current;if(!alive.current||now.blocked||now.linkReview!==linkReview||now.workId!==work?.id||now.versionId!==version?.id||now.serviceId!==serviceId||blocked||flight.current||!linkReview||linkReview.workId!==work?.id||linkReview.versionId!==version?.id||linkReview.rowVersion!==work.rowVersion||linkReview.serviceId!==serviceId)return;flight.current=true;setBinding(true);setError('');const requestId=crypto.randomUUID();try{sessionStorage.setItem(recoveryKey,JSON.stringify({kind:'work',requestId}));setPending({kind:'work',requestId});await workCommands.apply({...scope,activeServiceId:serviceId},requestId,{action:'link_content_version',work_item_id:work.id,row_version:work.rowVersion,artifact_version_id:version.id});sessionStorage.removeItem(recoveryKey);if(alive.current){setPending(null);setLinkReview(null);await refresh()}}catch(e){if(alive.current)setError(e.message)}finally{flight.current=false;if(alive.current)setBinding(false)}}
 async function bind(){const now=current.current;if(!alive.current||now.blocked||now.workId!==work?.id||now.messageId!==messageId||!now.owner||blocked||flight.current||!owner||!work||!human.some(m=>m.id===messageId))return;flight.current=true;setBinding(true);setError('');try{await repository.bind(scope,messageId,work.id);if(alive.current)await refresh()}catch(e){if(alive.current)setError(e.message+' Refresh conversation links before retrying; the same work and saved message are retained.')}finally{flight.current=false;if(alive.current)setBinding(false)}}
 function chooseWork(id){if(blocked||dirty)return;setWorkId(id);setVersionId('');setTab('write')}
 const onSaved=useCallback(result=>{if(result?.version?.id){setVersionId(result.version.id);setTab('review')}},[])
 const suggested=projectDeliveryIntent(request?.text||human.at(-1)?.body||'')
 return <details className="project-content-journey" open={['content','review','design'].includes(suggested)||undefined}><summary>Content → review → Design journey</summary>
 <p>Continue in this conversation using the same project work and immutable output versions. Project actions require your explicit review; private exploration is not copied.</p>
 {['content','review','design'].includes(suggested)&&<p role="status">Suggested next step: {suggested==='content'?'choose or create Content work, then draft below':suggested==='review'?'select an exact saved version and review below':'confirm the exact approved Content handoff below'}. Your message has not executed an action.</p>}
 <button type="button" className="workspace-button" disabled={busy||loading||writerBusy||binding||dirty} onClick={refresh}>Refresh this journey</button>
 {owner&&human.length>0&&<button className="workspace-button" disabled={blocked||dirty} onClick={()=>setProposal(projectContentRequestProposal(human.at(-1),scope))}>Use saved request as a Content work proposal</button>}
 {proposal&&<p>Saved request selected for explicit project review. Choose an active Content service below, edit the title if needed, then review and Apply. No work has been created yet.</p>}
 {owner&&<ProjectWorkActions context={proposal?{...context,services:context.services.filter(s=>s.department==='content')}:context} proposal={proposal} busy={blocked||dirty} repository={workCommands} onChanged={refresh} onApplied={r=>{if(r?.work_item?.department_id==='content')chooseWork(r.work_item.id)}}/>}
 <label>Content work in this conversation<select className="workspace-input" value={workId} disabled={blocked||dirty} onChange={e=>chooseWork(e.target.value)}><option value="">Choose original Content work</option>{works.map(w=><option key={w.id} value={w.id}>{w.title}{links.some(l=>l.work_item_id===w.id)?' · tracked here':''}</option>)}</select></label>
 {!works.length&&<p>Create a reviewed Content work request above. If Content has no active service, review Services & pipeline plan first.</p>}
 {work&&!selectedLink&&owner&&<section><p>Explicitly add this work to the current conversation. Its original project records remain shared under their existing permissions.</p><label>Saved human request<select className="workspace-input" value={messageId} disabled={blocked} onChange={e=>setMessageId(e.target.value)}><option value="">Choose your saved request</option>{human.map(m=><option key={m.id} value={m.id}>{m.body?.slice(0,100)||'Saved request'}</option>)}</select></label>{!human.length&&<p>Save a human message in this conversation first; no AI response is required.</p>}<button className="workspace-button" disabled={blocked||!messageId} onClick={bind}>Track this work in this conversation</button></section>}
 {selectedLink&&<p>Following original Content work: {work?.title||'Work unavailable'}. Source request retained in this conversation.</p>}
 {error&&<p role="alert">{error} Refresh this journey to recheck current access before continuing.</p>}
 {pending&&<p role="alert">Recover the original {pending.kind==='handoff'?'handoff':'work action'} before another write. <button className="workspace-button" disabled={busy||binding||pending.kind==='storage_unavailable'} onClick={recover}>Recover original journey action</button></p>}
 {loading&&<p role="status">Reading current canonical work, versions and handoffs.</p>}
 {work&&data&&!error&&<><nav className="flex flex-wrap gap-2"><button className="workspace-button" disabled={blocked||dirty} onClick={()=>setTab('write')}>Draft or view Content</button><button className="workspace-button" disabled={blocked||dirty} onClick={()=>setTab('review')}>Review & explicit Design handoff</button>{work.workshop&&<Link className="workspace-button" to={work.workshop} onClick={e=>{if(blocked||dirty)e.preventDefault()}}>Open same work in Workshop</Link>}</nav>
 {tab==='write'&&owner&&<ContentChatWriterPane key={work.id} workspace={data} studio={studio} refresh={refresh} stale={busy||Boolean(error)||work.closed} refreshing={loading} onStateChange={stateChanged} onSaved={onSaved}/>}
 <label>Exact Content version<select className="workspace-input" disabled={blocked||dirty} value={version?.id||''} onChange={e=>{setVersionId(e.target.value);setTab('review')}}><option value="">Choose saved version</option>{data.versions.filter(v=>data.artifacts.some(a=>a.id===v.artifact_id&&a.artifact_type==='content')).map(v=><option key={v.id} value={v.id}>{data.artifacts.find(a=>a.id===v.artifact_id)?.title} · v{v.version_number}</option>)}</select></label>
 {version&&owner&&selectedLink&&work.linkedVersionId!==version.id&&!work.closed&&<section><p>Review linking this exact saved version to the original Content work. Ownership, status and approval stay separate.</p><label>Exact active Content service<select className="workspace-input" value={serviceId} disabled={blocked} onChange={e=>{setServiceId(e.target.value);setLinkReview(null)}}><option value="">Choose service</option>{context.services.filter(s=>s.department==='content').map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select></label><button className="workspace-button" disabled={blocked||!serviceId} onClick={()=>setLinkReview({workId:work.id,versionId:version.id,rowVersion:work.rowVersion,serviceId})}>Review exact result binding</button>{linkReview?.versionId===version.id&&linkReview.workId===work.id&&<><p>Bind {artifact?.title} v{version.version_number} to {work.title}.</p><button className="workspace-button" disabled={blocked} onClick={applyLink}>Apply exact result binding</button></>}</section>}
 {tab==='review'&&!pending&&(version&&artifact&&selectedLink?<ContentLibraryPanel key={version.id} repository={reviewRepository} initialArtifactId={artifact.id} initialVersionId={version.id} compact externalBusy={busy||writerBusy||binding}/>:<p>{!selectedLink?'Track the original work in this conversation first.':'Save a draft above or choose an exact saved Content version. Approval is attached only to that version.'}</p>)}
 <h3>Design progress and result</h3>{!selectedLink&&<p>Track the original work in this conversation to retain its journey reference.</p>}{!version&&<p>Select the exact Content version to read its confirmed handoffs.</p>}{version&&!handoffs.length&&<p>No confirmed handoff for this exact Content version. Review it, obtain authorized approval, choose the active Design service and workstream, then confirm the handoff above.</p>}
 {handoffs.map(h=><article key={h.link.request_id}><p>Internal handoff: {h.request?.status||'Current request unavailable'}. {h.work?`${h.work.title}: ${h.work.status}`:'No accessible downstream work was linked. Choose existing Design work when preparing a handoff; a handoff does not create work.'}</p>{h.version?<><h4>{h.artifact.title} · exact v{h.version.version_number}</h4><SavedDesignValue value={h.version.content}/><p>Saved Design result; work completion and approval remain separate.</p></>:<p>No exact saved result is linked to this downstream work yet. Continue the original work in Design Workshop, save its output and explicitly link that version, then refresh here.</p>}{context.workshops.find(w=>w.department==='design')?.path&&<Link className="workspace-button" to={appendWorkshopNavigation(context.workshops.find(w=>w.department==='design').path,{organizationId:context.organizationId,projectId:context.projectId,engagementId:context.engagementId,workRecord:h.work?{kind:h.link.work_kind,id:h.work.id}:undefined})}>Open in Design Workshop</Link>}</article>)}
 </>}
 </details>
}

function SavedDesignValue({value}){
 if(value==null)return <span>Not recorded</span>
 if(Array.isArray(value))return <ul>{value.map((v,i)=><li key={i}><SavedDesignValue value={v}/></li>)}</ul>
 if(typeof value==='object')return <dl>{Object.entries(value).map(([key,v])=><div key={key}><dt className="font-semibold">{key.replaceAll('_',' ')}</dt><dd className="whitespace-pre-wrap"><SavedDesignValue value={v}/></dd></div>)}</dl>
 return <span>{String(value)}</span>
}
