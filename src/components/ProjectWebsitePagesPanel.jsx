import _WebsitePageSeoObservationsPanel from './WebsitePageSeoObservationsPanel.jsx'
import {useEffect,useRef,useState} from 'react'
import _WebsitePageEditor from './WebsitePageEditor.jsx'
import {useAuth} from '../context/AuthContext.jsx'
import {projectWebsitePages} from '../data/projectWebsitePages.js'
import {projectPipelineConfigurations} from '../data/projectPipelineConfigurations.js'
const INPUT='w-full rounded-lg border border-[var(--anka-line)] bg-[var(--anka-surface)] px-3 py-2 text-sm text-[var(--anka-ink)] focus:border-[var(--anka-focus)]'
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const title=value=>value?.replaceAll('_',' ') || 'planned'
export default function ProjectWebsitePagesPanel(props){
 const {user}=useAuth(),requestScope=useRef({signal:props.signal,revision:0})
 if(requestScope.current.signal!==props.signal)requestScope.current={signal:props.signal,revision:requestScope.current.revision+1}
 if(props.group?.kind!=='website' || !props.engagement?.project_id)return null
 return <ScopedWebsitePages key={[user?.id,props.organizationId,props.engagement.project_id,props.engagement.id,props.group.id,requestScope.current.revision,props.membership?.role,props.membership?.departmentId,props.membership?.status,props.membership?.memberKind].join(':')} {...props} actorId={user?.id} />
}
// eslint-disable-next-line no-unused-vars -- JSX component is consumed above.
function ScopedWebsitePages({organizationId,engagement,group,actorId,signal}){
 const scope={organizationId,projectId:engagement.project_id},recoveryKey=`anka:website-page-operation:${actorId}:${organizationId}:${engagement.project_id}:v1`
 const [pending,setPending]=useState(()=>{try{const v=JSON.parse(sessionStorage.getItem(recoveryKey)||'null');return v && UUID.test(v.requestId || '') ? v : v ? {requestId:''} : null}catch{return {requestId:''}}})
 const [query,setQuery]=useState(''),[sources,setSources]=useState([]),[sourcePage,setSourcePage]=useState({offset:0,has_more:false}),[versionId,setVersionId]=useState('')
 const [search,setSearch]=useState(''),[stateFilter,setStateFilter]=useState(''),[parentFilter,setParentFilter]=useState(''),[offset,setOffset]=useState(0),[data,setData]=useState(null)
 const [selected,setSelected]=useState([]),[review,setReview]=useState(null),[history,setHistory]=useState(null),[error,setError]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false),[editor,setEditor]=useState(null),[seo,setSeo]=useState(null),[seoBlocked,setSeoBlocked]=useState(false)
 const alive=useRef(true),flight=useRef(false),sequence=useRef(0),latest=useRef(null)
 latest.current={versionId,search,stateFilter,parentFilter,offset,pending,busy,signal,review,selected,data,query,editor,seo,seoBlocked}
 const allowed=()=>alive.current && !latest.current.signal?.aborted
 const locked=()=>Boolean(latest.current.editor) || latest.current.seoBlocked || !allowed() || flight.current || latest.current.busy || Boolean(latest.current.pending)
 const setWorking=value=>{latest.current.busy=value;setBusy(value)}
 useEffect(()=>()=>{alive.current=false;sequence.current+=1},[])
 async function findSources(pageOffset=0){
  if(locked())return;const seq=++sequence.current;setWorking(true);setError('');
  try{const result=await projectPipelineConfigurations.listStageArtifacts(organizationId,engagement.id,{query:latest.current.query,offset:pageOffset,signal});if(allowed() && seq===sequence.current){setSources(current=>{const exact=result.artifacts.filter(row=>row.artifact_type==='website_architecture'),chosen=current.find(row=>row.artifact_version_id===latest.current.versionId);return chosen && !exact.some(row=>row.artifact_version_id===chosen.artifact_version_id) ? [chosen,...exact] : exact});setSourcePage(result)}}catch(cause){if(allowed() && seq===sequence.current)setError(cause.message)}finally{if(allowed() && seq===sequence.current)setWorking(false)}
 }
 async function load(value={}){
  if(!allowed())return;const current={...latest.current,...value},seq=++sequence.current;
  if(!current.versionId){setData(null);return}setWorking(true);setError('');
  try{const result=await projectWebsitePages.list({...scope,architectureVersionId:current.versionId,search:current.search,publicationState:current.stateFilter || null,parentPageKey:current.parentFilter || null,offset:current.offset,limit:25},{signal});if(allowed() && seq===sequence.current)setData(result)}catch(cause){if(allowed() && seq===sequence.current){setData(null);setError(cause.message)}}finally{if(allowed() && seq===sequence.current)setWorking(false)}
 }
 function chooseVersion(value){if(locked())return;sequence.current+=1;setVersionId(value);setSeo(null);setSelected([]);setReview(null);setHistory(null);setData(null);setOffset(0);setSearch('');setStateFilter('');setParentFilter('');setNotice('');void load({versionId:value,offset:0,search:'',stateFilter:'',parentFilter:''})}
 function changeFilter(name,value){if(locked())return;setReview(null);setOffset(0);({search:setSearch,stateFilter:setStateFilter,parentFilter:setParentFilter}[name])(value);void load({[name]:value,offset:0})}
 function toggle(key){if(locked())return;setReview(null);setSelected(current=>current.includes(key) ? current.filter(value=>value!==key) : current.length<150 ? [...current,key] : current)}
 async function preview(all=false){
  if(locked() || !latest.current.versionId)return;flight.current=true;setWorking(true);setError('');const original=latest.current.versionId;let pageKeys=[...latest.current.selected]
  try{
   if(all){pageKeys=[];for(let pos=0;pos<(latest.current.data?.counts.total || 0);pos+=100){const batch=await projectWebsitePages.list({...scope,architectureVersionId:original,offset:pos,limit:100},{signal});if(!allowed() || latest.current.versionId!==original)return;pageKeys.push(...batch.pages.map(row=>row.source.page_key))}}
   const result=await projectWebsitePages.preview({...scope,architectureVersionId:original,pageKeys},{signal});if(allowed() && latest.current.versionId===original)setReview({architectureVersionId:original,pageKeys,preview:result})
  }catch(cause){if(allowed())setError(cause.message)}finally{flight.current=false;if(allowed())setWorking(false)}
 }
 async function confirmRegistration(){
  if(locked() || !review || latest.current.review!==review || review.architectureVersionId!==latest.current.versionId)return;flight.current=true;setWorking(true);setError('');const snapshot=review,operation={requestId:crypto.randomUUID()}
  try{
   // Persist only the original UUID before dispatch; an unknown outcome blocks every new command.
   sessionStorage.setItem(recoveryKey,JSON.stringify(operation));latest.current.pending=operation;setPending(operation)
   const result=await projectWebsitePages.register({...scope,architectureVersionId:snapshot.architectureVersionId,pageKeys:snapshot.pageKeys,reviewSha256:snapshot.preview.review_sha256,requestId:operation.requestId,confirmed:true},{signal})
   if(allowed()){sessionStorage.removeItem(recoveryKey);latest.current.pending=null;setPending(null);setSelected([]);setReview(null);setNotice(`${result.pages.length} page identities confirmed. Canonical work and assignments are preserved.`);await load()}
  }catch(cause){if(allowed()){if(cause.knownRollback){sessionStorage.removeItem(recoveryKey);latest.current.pending=null;setPending(null);setReview(null)}setError(cause.message)}}finally{flight.current=false;if(allowed())setWorking(false)}
 }
 async function recover(){
  if(!allowed() || flight.current || !UUID.test(latest.current.pending?.requestId || ''))return;flight.current=true;setWorking(true);setError('');
  try{const command=await projectWebsitePages.recover({...scope,requestId:latest.current.pending.requestId},{signal});if(allowed()){if(!command){setError('The original operation is not yet visible. Keep its saved key and check again.');return}sessionStorage.removeItem(recoveryKey);latest.current.pending=null;setPending(null);setReview(null);setSelected([]);setEditor(null);setNotice('Recovered the original confirmed operation. No command was repeated.');await load()}}catch(cause){if(allowed())setError(cause.message)}finally{flight.current=false;if(allowed())setWorking(false)}
 }
 async function inspect(row){if(locked() || !row.page_id)return;const seq=++sequence.current;setWorking(true);setError('');try{const result=await projectWebsitePages.history({...scope,pageId:row.page_id},{signal});if(allowed() && seq===sequence.current)setHistory(result)}catch(cause){if(allowed() && seq===sequence.current)setError(cause.message)}finally{if(allowed() && seq===sequence.current)setWorking(false)}}
 function openSeo(row){if(locked()||!row.page_id||!latest.current.data?.pages.includes(row))return;const next={row,versionId:latest.current.versionId};latest.current.seo=next;setSeo(next);setHistory(null);setReview(null)}
 async function openEditor(row){
  if(locked() || !row.page_id)return;const seq=++sequence.current;setWorking(true);setError('');
  try{const result=await projectWebsitePages.editor({...scope,pageId:row.page_id,architectureVersionId:latest.current.versionId},{signal});if(allowed() && seq===sequence.current){setReview(null);setHistory(null);setSeo(null);setEditor(result)}}catch(cause){if(allowed() && seq===sequence.current)setError(cause.message)}finally{if(allowed() && seq===sequence.current)setWorking(false)}
 }
 const editorActive=context=>allowed() && latest.current.editor===context && latest.current.versionId===context.reference.artifact_version_id && !flight.current && !latest.current.pending && !latest.current.busy
 async function lookupEditor(value){
  const original=latest.current.editor;if(!editorActive(original))return;const seq=++sequence.current;setWorking(true);setError('');
  try{const result=await projectWebsitePages.editor({...scope,pageId:original.page.id,architectureVersionId:original.reference.artifact_version_id,...value},{signal});if(allowed() && seq===sequence.current && latest.current.editor===original)setEditor(result)}catch(cause){if(allowed() && seq===sequence.current)setError(cause.message)}finally{if(allowed() && seq===sequence.current)setWorking(false)}
 }
 async function confirmEditor(snapshot){
  const context=snapshot.context;if(!editorActive(context))return;flight.current=true;setWorking(true);setError('');const operation={requestId:crypto.randomUUID()}
  try{
   sessionStorage.setItem(recoveryKey,JSON.stringify(operation));latest.current.pending=operation;setPending(operation)
   await projectWebsitePages[snapshot.kind]({...scope,pageId:context.page.id,architectureVersionId:context.reference.artifact_version_id,expectedRevision:context.expected_revision,expectedLinkNumber:context.expected_link_number,operations:snapshot.operations,trackedPageId:snapshot.trackedPageId,requestId:operation.requestId,confirmed:true},{signal})
   if(allowed()){sessionStorage.removeItem(recoveryKey);latest.current.pending=null;setPending(null);setEditor(null);setNotice(snapshot.kind==='saveOperations' ? 'Page implementation revision saved. Canonical work and original path are preserved.' : 'Explicit SEO observation link saved. Historical links are preserved.');await load()}
  }catch(cause){if(allowed()){if(cause.knownRollback){sessionStorage.removeItem(recoveryKey);latest.current.pending=null;setPending(null)}setError(cause.message)}}finally{flight.current=false;if(allowed())setWorking(false)}
 }
 const isLocked=busy || Boolean(pending) || Boolean(editor) || seoBlocked,count=data?.counts,source=sources.find(row=>row.artifact_version_id===versionId)
 return <section aria-label="Website pages" className="mt-5 space-y-4 rounded-xl border border-[var(--anka-line)] bg-[var(--anka-surface)] p-4 text-[var(--anka-ink)]">
  <header><h3 className="font-semibold">Website pages · {group.name}</h3><p className="mt-1 text-xs text-[var(--anka-muted)]">Choose an approved architecture version. Page identities stay stable across approved revisions; recording a live URL never publishes a website.</p></header>
  {error && <p role="alert" className="text-sm text-[var(--anka-danger)]">{error}</p>}{notice && <p role="status" className="text-sm text-[var(--anka-success)]">{notice}</p>}
  {pending && <section aria-label="Recover original Website operation" className="rounded-lg border border-[var(--anka-warning)] p-3 text-sm"><p>{pending.requestId ? 'The original operation needs reconciliation. New commands stay blocked.' : 'The original saved key is unreadable. Restore its exact operation UUID before confirming new changes.'}</p><button type="button" className="workspace-button mt-2" disabled={busy || !pending.requestId} onClick={recover}>Check original operation</button></section>}
  <fieldset disabled={isLocked} className="grid gap-3 sm:grid-cols-[1fr_auto]">
   <details open={!versionId} className="sm:col-span-2"><summary className="cursor-pointer text-xs text-[var(--anka-muted)]">Find an approved architecture</summary><div className="mt-2 grid gap-3 sm:grid-cols-[1fr_auto]"><label className="text-xs">Search approved sources<input aria-label="Website architecture search" className={INPUT} maxLength={120} value={query} onChange={event=>{if(!locked())setQuery(event.target.value)}} /></label><button type="button" onClick={()=>findSources(0)} className="workspace-button self-end">Find approved architectures</button></div></details>
   <label className="text-xs sm:col-span-2">Exact approved version<select aria-label="Website approved architecture" className={INPUT} value={versionId} onChange={event=>chooseVersion(event.target.value)}><option value="">Choose an approved architecture</option>{sources.map(row=><option key={row.artifact_version_id} value={row.artifact_version_id}>{row.title} · v{row.version_number}</option>)}</select></label>
   {sourcePage.offset>0 && <button type="button" className="workspace-button" onClick={()=>findSources(Math.max(0,sourcePage.offset-25))}>Previous architecture results</button>}{sourcePage.has_more && <button type="button" className="workspace-button" onClick={()=>findSources(sourcePage.offset+25)}>Next architecture results</button>}
  </fieldset>
  {busy && <p role="status" className="text-xs text-[var(--anka-muted)]">Checking exact current project records…</p>}
  {seo && <_WebsitePageSeoObservationsPanel key={seo.row.page_id+':'+seo.versionId} organizationId={organizationId} projectId={engagement.project_id} engagementId={engagement.id} pageId={seo.row.page_id} architectureVersionId={seo.versionId} pageTitle={seo.row.source.title} actorId={actorId} signal={signal} onNavigationBusyChange={value=>{if(allowed()&&latest.current.seo===seo){latest.current.seoBlocked=value;setSeoBlocked(value)}}} onClose={()=>{if(allowed()&&!latest.current.seoBlocked&&latest.current.seo===seo){latest.current.seo=null;setSeo(null)}}}/> }
  {editor && <_WebsitePageEditor key={editor.page.id} context={editor} disabled={busy || Boolean(pending)} isActive={editorActive} onLookup={lookupEditor} onConfirm={confirmEditor} onClose={()=>{if(editorActive(editor))setEditor(null)}} />}
  {data && <>
   <details className="text-xs text-[var(--anka-muted)]"><summary>{source?.title || 'Selected architecture'} · approved v{data.reference.version_number}</summary><p className="mt-1 break-all">Exact version {data.reference.artifact_version_id} · approval {data.reference.approval_id}</p></details>
   <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">{[['Pages',count.total],['Published',count.published],['In progress',count.in_progress],['SEO links',count.linked_seo]].map(([name,value])=><div key={name} className="rounded-lg bg-[var(--anka-surface-raised)] p-3"><dt className="text-xs text-[var(--anka-muted)]">{name}</dt><dd className="text-lg font-semibold">{value}</dd></div>)}</dl>
   <p className="text-xs text-[var(--anka-muted)]">{count.registered} registered · {count.assigned} assigned · {count.has_deadline} with deadline. Assignment and SEO counts may overlap publication states.</p>
   <fieldset disabled={isLocked} className="grid gap-3 sm:grid-cols-3">
    <label className="text-xs">Find page<input aria-label="Website page search" className={INPUT} maxLength={240} value={search} onChange={event=>changeFilter('search',event.target.value)} /></label>
    <label className="text-xs">Publication state<select aria-label="Website publication filter" className={INPUT} value={stateFilter} onChange={event=>changeFilter('stateFilter',event.target.value)}><option value="">All states</option>{['planned','in_progress','review','ready','published','retired'].map(value=><option key={value} value={value}>{title(value)}</option>)}</select></label>
    <label className="text-xs">Children of page key<input aria-label="Website parent filter" className={INPUT} maxLength={1208} value={parentFilter} onChange={event=>changeFilter('parentFilter',event.target.value)} /></label>
   </fieldset>
   <div className="flex flex-wrap items-center gap-2"><button type="button" className="workspace-button" disabled={isLocked || !selected.length} onClick={()=>preview(false)}>Review selected pages ({selected.length})</button><button type="button" className="workspace-button" disabled={isLocked || count.total>150} onClick={()=>preview(true)}>Review all {count.total} pages</button><span className="text-xs text-[var(--anka-muted)]">Up to 150 identities per reviewed batch.</span></div>
   <ol aria-label="Approved Website page list" className="space-y-2">{data.pages.map(row=><li key={row.source.page_key} className="rounded-lg border border-[var(--anka-line)] p-3"><div className="flex items-start gap-3"><input type="checkbox" aria-label={'Select '+row.source.title} disabled={isLocked} checked={selected.includes(row.source.page_key)} onChange={()=>toggle(row.source.page_key)} /><div className="min-w-0 flex-1"><p className="text-sm font-medium">{row.source.title}</p><p className="break-all text-xs text-[var(--anka-muted)]">/{row.source.path} · {row.source.page_type} · {title(row.operations?.publication_state)}</p><p className="mt-1 break-all text-xs text-[var(--anka-muted)]">{row.source.parent_page_key ? 'Child of '+row.source.parent_page_key : 'Root page'} · {row.page_id ? 'Registered' : 'Ready to register'} · {row.work_state==='current' ? 'Canonical work linked' : row.work_state==='unavailable' ? 'Linked work unavailable' : 'Work unlinked'}{row.due_date ? ' · Due '+row.due_date : ''}</p>{row.operations?.recorded_live_url && <p className="break-all text-xs">Recorded live URL: {row.operations.recorded_live_url}</p>}</div>{row.page_id && <div className="flex shrink-0 flex-col gap-2"><button type="button" disabled={isLocked} className="workspace-button text-xs" onClick={()=>openEditor(row)}>Edit page</button><button type="button" disabled={isLocked} className="workspace-button text-xs" onClick={()=>openSeo(row)}>SEO observations</button><button type="button" disabled={isLocked} className="workspace-button text-xs" onClick={()=>inspect(row)}>History</button></div>}</div></li>)}</ol>
   {!data.pages.length && <p className="text-sm text-[var(--anka-muted)]">No pages match these filters.</p>}
   <div className="flex flex-wrap items-center justify-between gap-2"><p className="text-xs text-[var(--anka-muted)]">{count.filtered_total ? offset+1 : 0}–{Math.min(offset+data.pages.length,count.filtered_total)} of {count.filtered_total} matching pages</p><div className="flex gap-2"><button type="button" className="workspace-button" disabled={isLocked || offset===0} onClick={()=>{if(locked())return;const next=Math.max(0,offset-25);setOffset(next);void load({offset:next})}}>Previous pages</button><button type="button" className="workspace-button" disabled={isLocked || offset+25>=count.filtered_total} onClick={()=>{if(locked())return;const next=offset+25;setOffset(next);void load({offset:next})}}>Next pages</button></div></div>
  </>}
  {review && <section aria-label="Review Website page registration" className="space-y-3 rounded-lg border border-[var(--anka-violet)] bg-[var(--anka-surface-raised)] p-3"><h4 className="font-semibold">Review {review.pageKeys.length} exact page identities</h4><p className="break-all text-xs">Approved source: {review.architectureVersionId} · approval {review.preview.reference.approval_id}</p><p className="text-xs">This registers page identities. It creates no Work Items, assignments, publication or provider request. Current permission, source version and page identities are rechecked together at confirmation.</p><ul className="max-h-64 space-y-1 overflow-y-auto text-xs">{review.preview.pages.map(row=><li key={row.page_key} className="break-all">{row.title} · /{row.path} · {row.registered_page_id ? 'Existing identity preserved' : 'New identity'}</li>)}</ul><button type="button" className="workspace-button workspace-button-primary" disabled={isLocked} onClick={confirmRegistration}>Confirm page identities</button></section>}
  {history && <section aria-label="Website page history" className="space-y-2 rounded-lg border border-[var(--anka-line)] p-3 text-xs"><div className="flex justify-between gap-3"><h4 className="font-semibold">Page history · {history.page.page_key}</h4><button type="button" className="workspace-button" onClick={()=>{if(!locked())setHistory(null)}}>Close history</button></div><p className="break-all">Original path: /{history.page.initial_path}</p>{history.revisions.map(row=><p key={row.id} className="break-all">Revision {row.revision_number} · /{row.planned_path} · {title(row.publication_state)} · {row.recorded_live_url || 'Live URL unrecorded'}{row.redirect_url ? ' → '+row.redirect_url : ''} · exact source {row.architecture_version_id}</p>)}{!history.revisions.length && <p>No operational revisions recorded.</p>}<p>{history.seo_links.length} immutable SEO link events shown.</p></section>}
 </section>
}
