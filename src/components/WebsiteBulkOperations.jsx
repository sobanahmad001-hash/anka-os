import {useEffect,useRef,useState} from 'react'
import {BULK_PAGE_STATES,websiteBulkPatch,prepareWebsiteBulkRow} from '../data/websiteBulkOperations.js'
const INPUT='w-full rounded-lg border border-[var(--anka-line)] bg-[var(--anka-surface)] px-3 py-2 text-sm text-[var(--anka-ink)]'
export default function WebsiteBulkOperations({selection,disabled,isActive,onLoad,onSave,onClose,onRecover}){
 const [template,setTemplate]=useState(''),[progress,setProgress]=useState(''),[review,setReview]=useState(null),[results,setResults]=useState([]),[busy,setBusy]=useState(false),[error,setError]=useState('')
 const alive=useRef(true),flight=useRef(false),latest=useRef(null);latest.current={selection,disabled,template,progress,review,results}
 useEffect(()=>()=>{alive.current=false},[])
 const active=()=>alive.current&&!latest.current.disabled&&isActive(selection)
 function change(set,value){if(!active()||flight.current||latest.current.results.some(row=>['saved','unchanged'].includes(row.state)))return;setReview(null);set(value);setError('')}
 async function preview(){
  if(!active()||flight.current)return;flight.current=true;setBusy(true);setError('');setReview(null)
  try{
   const v=latest.current,patch=websiteBulkPatch({...v.template?{template:v.template}:{},...v.progress?{publication_state:v.progress}:{}})
   const done=new Set(v.results.filter(row=>['saved','unchanged'].includes(row.state)).map(row=>row.page.page_id))
   const targets=selection.pages.filter(page=>!done.has(page.page_id)),rows=[]
   for(const page of targets){if(!active())return;try{const context=await onLoad(page);if(!active())return;rows.push({page,state:'reviewed',value:prepareWebsiteBulkRow({page,context,architectureVersionId:selection.versionId,patch})})}catch(cause){if(!active())return;rows.push({page,state:'unavailable',message:cause.message})}}
   if(active()){setResults(current=>[...current.filter(row=>done.has(row.page.page_id)),...rows]);setReview({rows,patch,template:v.template,progress:v.progress})}
  }catch(cause){if(active())setError(cause.message)}finally{flight.current=false;if(alive.current)setBusy(false)}
 }
 async function confirm(){
  const snapshot=latest.current.review
  if(!active()||flight.current||!snapshot||snapshot!==review||snapshot.template!==latest.current.template||snapshot.progress!==latest.current.progress)return
  flight.current=true;setBusy(true);setReview(null);setError('')
  const update=(page,state,message)=>setResults(current=>current.map(row=>row.page.page_id===page.page_id?{...row,state,message}:row))
  try{
   for(const row of snapshot.rows){
    if(row.state!=='reviewed')continue
    if(!active())break
    if(!row.value.changed){update(row.page,'unchanged','Already matches; no revision written.');continue}
    try{await onSave(row.value);if(alive.current)update(row.page,'saved','One implementation revision saved.')}
    catch(cause){if(alive.current)update(row.page,cause.knownRollback?'failed':'uncertain',cause.message);if(!cause.knownRollback){setResults(current=>current.map(item=>item.state==='reviewed'&&item.page.page_id!==row.page.page_id?{...item,state:'not_attempted',message:'Stopped before dispatch; reconcile the uncertain page first.'}:item));break}}
   }
  }finally{flight.current=false;if(alive.current)setBusy(false)}
 }
 const locked=disabled||busy,remaining=selection.pages.length-results.filter(row=>['saved','unchanged'].includes(row.state)).length
 return <section aria-label="Bulk Website page changes" className="space-y-3 rounded-xl border border-[var(--anka-violet)] p-4">
  <div className="flex flex-wrap items-center justify-between gap-2"><h4 className="font-semibold">Bulk changes · {selection.pages.length} selected pages</h4><button type="button" className="workspace-button" disabled={locked} onClick={()=>{if(active()&&!flight.current)onClose()}}>Close bulk changes</button></div>
  <p className="text-xs text-[var(--anka-muted)]">Review a shared template or internal progress change. Each page keeps its URLs, source, linked work, notes and QA evidence. Approval and publishing are separate.</p>
  {error&&<p role="alert" className="text-sm text-[var(--anka-danger)]">{error}</p>}
  <fieldset disabled={locked||results.some(row=>['saved','unchanged'].includes(row.state))} className="grid gap-3 sm:grid-cols-2"><label className="text-xs">Template (blank keeps existing)<input aria-label="Bulk page template" value={template} maxLength={160} className={INPUT} onChange={e=>change(setTemplate,e.target.value)}/></label><label className="text-xs">Internal progress<select aria-label="Bulk page progress" value={progress} className={INPUT} onChange={e=>change(setProgress,e.target.value)}><option value="">Keep existing</option>{BULK_PAGE_STATES.map(s=><option key={s} value={s}>{s.replaceAll('_',' ')}</option>)}</select></label></fieldset>
  <button type="button" className="workspace-button" disabled={locked||!remaining} onClick={preview}>{results.length?'Review remaining pages':'Preview bulk changes'}</button>
  {busy&&<p role="status" className="text-sm">Checking or saving each exact page…</p>}
  {results.length>0&&<ol aria-label="Bulk page outcomes" className="max-h-96 space-y-2 overflow-y-auto text-sm">{results.map(row=><li key={row.page.page_id} className="rounded-lg border border-[var(--anka-line)] p-3"><p className="font-medium">{row.page.source.title} · {row.state.replaceAll('_',' ')}</p>{row.state==='reviewed'&&row.value&&<><p className="text-xs">Exact revision {row.value.context.expected_revision} · /{row.page.source.path}</p>{row.value.fields.map(k=><p key={k} className="break-words text-xs">{k==='template'?'Template':'Internal progress'}: {row.value.before[k]||'Not set'} → {row.value.operations[k]}</p>)}{!row.value.changed&&<p className="text-xs">Already matches; no revision will be written.</p>}</>}{row.message&&<p className="text-xs">{row.message}</p>}</li>)}</ol>}
  {review&&<button type="button" className="workspace-button workspace-button-primary" disabled={locked||!review.rows.some(row=>row.state==='reviewed')} onClick={confirm}>Confirm reviewed page changes</button>}
  {results.some(row=>row.state==='uncertain')&&<button type="button" className="workspace-button" disabled={busy} onClick={()=>{if(alive.current&&!flight.current)onRecover()}}>Reconcile uncertain page</button>}
  {results.length>0&&<p className="text-xs text-[var(--anka-muted)]">{results.filter(row=>row.state==='saved').length} saved · {results.filter(row=>row.state==='unchanged').length} unchanged · {remaining} remaining. Known failures require a fresh preview. An uncertain result blocks all later writes until its original operation is reconciled.</p>}
 </section>
}
