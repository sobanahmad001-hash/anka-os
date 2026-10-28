import {useEffect,useRef,useState} from 'react'
import './projectWorkActions.css'
import {supabase} from '../lib/supabase.js'
import {createProjectWorkCommandRepository} from '../data/projectWorkCommandRepository.js'
const defaultRepository=createProjectWorkCommandRepository(supabase)
export default function ProjectWorkActions({context,busy=false,onChanged,onApplied,proposal=null,repository=defaultRepository}){
 const key=[context.organizationId,context.projectId,context.engagementId].join(':')
 return <Actions key={key} {...{context,busy,onChanged,onApplied,proposal,repository}}/>
}
function Actions({context,busy,onChanged,onApplied,proposal,repository}){
 const [open,setOpen]=useState(false),[actor,setActor]=useState(''),[service,setService]=useState(''),[title,setTitle]=useState(''),[description,setDescription]=useState(''),[work,setWork]=useState(''),[version,setVersion]=useState(''),[review,setReview]=useState(null),[pending,setPending]=useState(null),[working,setWorking]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('')
 const alive=useRef(false),flight=useRef(false),latest=useRef(null)
 useEffect(()=>{if(proposal&&!flight.current&&!pending){setTitle(proposal.title);setDescription(proposal.description);setReview(null);setService('')}},[proposal,pending])
 const scope={organizationId:context.organizationId,projectId:context.projectId,engagementId:context.engagementId,activeServiceId:service,actorId:actor}
 const storageKey=actor?`anka:project-work:${scope.organizationId}:${scope.projectId}:${actor}`:''
 latest.current={review,busy,pending,service,work,version}
 useEffect(()=>{alive.current=true;return()=>{alive.current=false}},[])
 useEffect(()=>{if(!open||actor)return;let active=true;repository.actor().then(id=>{if(active)setActor(id)}).catch(e=>{if(active)setError(e.message)});return()=>{active=false}},[open,actor,repository])
 useEffect(()=>{if(!storageKey)return;try{const id=sessionStorage.getItem(storageKey);if(id)setPending(id)}catch{setError('Recovery storage is unavailable. Saving is disabled.');setPending('storage-unavailable')}},[storageKey])
 const edit=fn=>{if(flight.current||pending)return;setReview(null);setNotice('');fn()}
 const selected=context.services?.find(s=>s.id===service)
 const items=context.records.filter(r=>r.kind==='engagement_work_item'&&r.department==='content'&&!r.closed)
 const versions=context.outputs.filter(a=>a.artifact_type==='content').flatMap(a=>a.versions.map(v=>({id:v.id,label:`${a.title} · v${v.version_number}`,artifactId:a.id})))
 function prepare(action){
  setError('');if(!actor||!selected) return setError('Choose an exact active service first.')
  let command
  if(action==='create') {if(!title.trim()||title.trim().length>240||description.length>20000)return setError('Use a title of 1–240 characters and a brief of at most 20,000 characters.');command={action,title:title.trim(),description}}
  else {const item=items.find(r=>r.id===work),output=versions.find(v=>v.id===version);if(selected.department!=='content'||!item||!output)return setError('Choose current Content work and an exact saved Content version.');command={action,work_item_id:item.id,row_version:item.rowVersion,artifact_version_id:output.id}}
  setReview({scope:{...scope},command,label:action==='create'?title.trim():versions.find(v=>v.id===version).label})
 }
 async function run(fn){if(flight.current||busy)return;flight.current=true;setWorking(true);setError('');try{await fn()}catch(e){if(alive.current)setError(e.message)}finally{flight.current=false;if(alive.current)setWorking(false)}}
 async function apply(){const current=latest.current;if(!review||current.review!==review||current.busy||current.pending)return;const id=crypto.randomUUID();sessionStorage.setItem(storageKey,id);setPending(id);const result=await repository.apply(review.scope,id,review.command);sessionStorage.removeItem(storageKey);if(!alive.current)return;setPending(null);setReview(null);setNotice('Reviewed work action saved. Ownership and approvals retain their existing review controls.');await onChanged?.();onApplied?.(result)}
 async function recover(){const result=await repository.recover(scope,pending);if(!result)throw Error('Original outcome remains unknown');sessionStorage.removeItem(storageKey);if(!alive.current)return;setPending(null);setReview(null);setNotice(result.status==='not_applied'?'Original command was not applied. Review a fresh action before saving.':'Original work action recovered without another write.');await onChanged?.()}
 const disabled=busy||working||Boolean(pending)||!actor
 return <details className="project-work-actions" onToggle={e=>setOpen(e.currentTarget.open)}><summary>Create work or connect a Content result</summary>{open&&<div className="mt-3 space-y-3">
 <p>Review one project request before saving. It starts unassigned and not started. Conversation text and private exploration are never copied automatically.</p>
 <label>Exact active service<select className="workspace-input" value={service} disabled={disabled} onChange={e=>edit(()=>setService(e.target.value))}><option value="">Choose a service</option>{context.services?.map(s=><option key={s.id} value={s.id}>{s.department}: {s.name}</option>)}</select></label>
 <label>Work title<input className="workspace-input" value={title} maxLength={240} disabled={disabled} onChange={e=>edit(()=>setTitle(e.target.value))}/></label><label>Reviewed project brief<textarea className="workspace-input" value={description} maxLength={20000} disabled={disabled} rows={3} onChange={e=>edit(()=>setDescription(e.target.value))}/></label><button type="button" className="workspace-button" disabled={disabled} onClick={()=>prepare('create')}>Review new work request</button>
 {selected?.department==='content'&&<section className="space-y-2"><p>After saving text in Content Writer, choose its exact version here. Linking does not approve it or finish work. Review and explicit Design handoff remain in Content Library.</p><label>Original Content work<select className="workspace-input" value={work} disabled={disabled} onChange={e=>edit(()=>setWork(e.target.value))}><option value="">Choose original work</option>{items.map(r=><option key={r.id} value={r.id}>{r.title}</option>)}</select></label><label>Exact saved Content version<select className="workspace-input" value={version} disabled={disabled} onChange={e=>edit(()=>setVersion(e.target.value))}><option value="">Choose a saved version</option>{versions.map(v=><option key={v.id} value={v.id}>{v.label}</option>)}</select></label><button type="button" className="workspace-button" disabled={disabled} onClick={()=>prepare('link_content_version')}>Review result link</button></section>}
 {review&&<section aria-label="Reviewed work action" className="rounded-lg border p-3"><p>{review.command.action==='create'?'Create one unassigned request':'Link an exact version to original work'}: {review.label}</p>{review.command.action==='create'&&<p className="whitespace-pre-wrap">{review.command.description}</p>}<p>No activation, assignment, completion, approval, AI run or publication.</p><button type="button" className="workspace-button" disabled={disabled} onClick={()=>run(apply)}>Apply reviewed work action</button></section>}
 {pending&&<p role="alert">Recover the original request before another save. <button type="button" className="workspace-button" disabled={busy||working||pending==='storage-unavailable'} onClick={()=>run(recover)}>Recover original work action</button></p>}{error&&<p role="alert">{error}</p>}{notice&&<p role="status">{notice}</p>}
 </div>}</details>
}
