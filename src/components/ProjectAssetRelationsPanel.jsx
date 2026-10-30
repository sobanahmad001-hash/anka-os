import {useEffect,useRef,useState} from 'react'
import {projectAssetRelations} from '../data/projectAssetRelations.js'
import {assetReferences} from '../data/projectAssetRelationsRepository.js'
const refKey=a=>a.kind+':'+a.id

export default function ProjectAssetRelationsPanel(props){
 const key=[props.organizationId,props.projectId,props.actorId,props.subjectKind,props.subjectId].join(':')
 return <ScopedRelations key={key} {...props}/>
}
function ScopedRelations({organizationId,projectId,actorId,subjectKind,subjectId,subjectLabel,onClose,onLockChange,onChanged,repository=projectAssetRelations,signal,externallyBusy=false}){
 const scope={organizationId,projectId,subjectKind,subjectId},recoveryKey=`anka:asset-relations:${actorId}:${organizationId}:${projectId}:${subjectKind}:${subjectId}`
 const [pending,setPending]=useState(()=>{try{return JSON.parse(sessionStorage.getItem(recoveryKey)||'null')}catch{return {requestId:null}}})
 const [data,setData]=useState(null),[assets,setAssets]=useState([]),[options,setOptions]=useState({options:[],offset:0,has_more:false}),[search,setSearch]=useState(''),[review,setReview]=useState(null),[confirmed,setConfirmed]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState(''),[labels,setLabels]=useState({})
 const current=useRef(null),alive=useRef(true),flight=useRef(false),root=useRef(null),callbacks=useRef(null)
 callbacks.current={onLockChange}
 const dirty=Boolean(data)&&JSON.stringify(assetReferences(assets))!==JSON.stringify(assetReferences(data.assets))
 current.current={assets,review,confirmed,pending,data,signal,dirty,externallyBusy}
 const active=()=>alive.current&&!current.current.signal?.aborted
 const changeAllowed=()=>active()&&!flight.current&&!current.current.pending&&!current.current.externallyBusy
 useEffect(()=>{alive.current=true;root.current?.focus();return()=>{alive.current=false}},[])
 useEffect(()=>{callbacks.current.onLockChange?.(busy||dirty||Boolean(pending));return()=>callbacks.current.onLockChange?.(false)},[busy,dirty,pending])
 function remember(rows){setLabels(prior=>({...prior,...Object.fromEntries((rows||[]).map(a=>[refKey(a),a.label]))}))}
 async function read(){const next=await repository.read(scope,{signal});if(active()){setData(next);remember(next.asset_labels);setAssets(next.assets);setReview(null);setConfirmed(false)}}
 async function run(fn){if(!active()||flight.current)return;flight.current=true;setBusy(true);setError('');try{await fn()}catch(e){if(active())setError(e.message)}finally{flight.current=false;if(active())setBusy(false)}}
 useEffect(()=>{void run(async()=>{await read();if(active()){const result=await repository.options({...scope,search:'',offset:0},{signal});if(active()){setOptions(result);remember(result.options)}}})},[]) // eslint-disable-line react-hooks/exhaustive-deps -- keyed exact actor and subject scope
 const input=()=>({...scope,expectedRevision:current.current.data.revision,expectedRowVersion:current.current.data.subject.row_version,assets:assetReferences(current.current.assets)})
 function toggle(a){if(!changeAllowed())return;const key=refKey(a);setAssets(old=>old.some(x=>refKey(x)===key)?old.filter(x=>refKey(x)!==key):[...old,{kind:a.kind,id:a.id}]);setReview(null);setConfirmed(false)}
 function clearPending(){sessionStorage.removeItem(recoveryKey);setPending(null);current.current.pending=null}
 async function save(){
  if(!changeAllowed()||!current.current.review||!current.current.confirmed)return
  const original={requestId:crypto.randomUUID(),input:input(),reviewSha256:current.current.review.review_sha256}
  // Persist before dispatch. Unknown responses retain the original UUID and never resend.
  try{sessionStorage.setItem(recoveryKey,JSON.stringify(original))}catch{setError('Original request cannot be retained in this tab. Keep the review; no save was sent.');return}
  setPending(original);current.current.pending=original
  await run(async()=>{const saved=await repository.save({...original.input,requestId:original.requestId,reviewSha256:original.reviewSha256,confirmed:true},{signal}).catch(e=>{if(active()&&['40001','42501','22023','55000','22P02'].includes(e.code)){clearPending();setReview(null);setConfirmed(false);e.message+=' This save rolled back. Your edits are retained; reload the current revision and review again.'}throw e});if(!active())return;clearPending();await read();if(active()){setNotice(`Relationship revision ${saved.revision} saved. Original work, asset and conversation states are unchanged.`);onChanged?.()}})
 }
 const disabled=busy||Boolean(pending)||signal?.aborted||externallyBusy
 const available=[...options.options,...assets.filter(a=>!options.options.some(o=>refKey(o)===refKey(a))).map(a=>({...a,label:labels[refKey(a)]||'Retained linked asset '+a.id.slice(-8)}))]
 return <section className="asset-relations-editor" aria-label="Explicit asset links" tabIndex={-1} ref={root}>
  <h4>Asset links · {subjectLabel||subjectKind.replaceAll('_',' ')}</h4>
  <p>Choose existing assets for this original record. These additional links can be empty. Existing implementation and placement links remain in their original workflows. Linking does not assign work, change its status, approve outputs or publish assets.</p>
  {subjectKind==='conversation'&&<p>Only this authorized project conversation is linked. Private conversation history is neither copied nor promoted.</p>}
  {error&&<p role="alert">{error}</p>}{notice&&<p role="status">{notice}</p>}
  {pending?<><p role="status">An original save may be pending. Recover its outcome without sending another save.</p><button type="button" disabled={busy||!pending.requestId} onClick={()=>void run(async()=>{const outcome=await repository.recover({...scope,requestId:pending.requestId},{signal});if(!active())return;if(outcome.status==='applied'){clearPending();await read();if(active()){setNotice('Original request recovered. Current relationships are shown; historical links were not restored.');onChanged?.()}}else setNotice('No original receipt is visible. Keep this request pending; no replacement save was sent.')})}>Recover original relationship request</button></>:<>
  <form onSubmit={e=>{e.preventDefault();if(!changeAllowed())return;void run(async()=>{const next=await repository.options({...scope,search,offset:0},{signal});if(active()){setOptions(next);remember(next.options)}})}}><label>Find existing assets<input aria-label="Find existing assets" value={search} maxLength={120} disabled={disabled} onChange={e=>setSearch(e.target.value)}/></label><button type="submit" disabled={disabled}>Search assets</button></form>
  <fieldset disabled={disabled||!data}><legend>Explicit asset selection ({assets.length}/50)</legend>{available.map(a=><label className="asset-relation-option" key={refKey(a)}><input type="checkbox" checked={assets.some(x=>refKey(x)===refKey(a))} disabled={disabled||assets.length>=50&&!assets.some(x=>refKey(x)===refKey(a))} onChange={()=>toggle(a)}/>{a.kind==='website_page'?'Website page':'Marketing asset'} · {a.label}</label>)}</fieldset>
  <div className="asset-actions"><button disabled={disabled||!options.offset} onClick={()=>void run(async()=>{const next=await repository.options({...scope,search,offset:Math.max(0,options.offset-50)},{signal});if(active()){setOptions(next);remember(next.options)}})}>Previous assets</button><button disabled={disabled||!options.has_more} onClick={()=>void run(async()=>{const next=await repository.options({...scope,search,offset:options.offset+50},{signal});if(active()){setOptions(next);remember(next.options)}})}>More assets</button></div>
  {data&&<button type="button" disabled={disabled} onClick={()=>{if(changeAllowed())void run(async()=>{const next=await repository.read(scope,{signal});if(active()){setData(next);remember(next.asset_labels);setReview(null);setConfirmed(false);setNotice('Current revision reloaded. Your selected assets are retained; review the before and after links before saving.')}})}}>Reload current revision, keep selected assets</button>}
  <button type="button" disabled={disabled||!dirty||!data} onClick={()=>{if(changeAllowed())void run(async()=>{const next=await repository.review(input(),{signal});if(active()){setReview(next);setConfirmed(false)}})}}>Review asset links</button>
  {review&&<section aria-label="Review exact asset links"><p>Replace relationship revision {data.revision} with {assets.length} explicitly selected asset(s). Other canonical links and all original histories remain.</p><h5>Current additional links</h5>{review.draft.before_assets?.length?<ul>{review.draft.before_assets.map(a=><li key={refKey(a)}>{labels[refKey(a)]||available.find(o=>refKey(o)===refKey(a))?.label||(a.kind==='website_page'?'Website page':'Marketing asset')} · <span className="asset-id">{a.id}</span></li>)}</ul>:<p>No current additional links.</p>}<h5>Reviewed replacement links</h5><ul>{review.draft.assets.map(a=><li key={refKey(a)}>{labels[refKey(a)]||available.find(o=>refKey(o)===refKey(a))?.label||(a.kind==='website_page'?'Website page':'Marketing asset')} · <span className="asset-id">{a.id}</span></li>)}</ul><label><input type="checkbox" checked={confirmed} disabled={disabled} onChange={e=>{if(changeAllowed())setConfirmed(e.target.checked)}}/>I reviewed these exact asset links.</label><button type="button" disabled={disabled||!confirmed} onClick={()=>void save()}>Save reviewed asset links</button></section>}
  {dirty&&<button type="button" disabled={disabled} onClick={()=>{if(changeAllowed()){setAssets(data.assets);setReview(null);setConfirmed(false)}}}>Discard unsaved link edits</button>}
  </>}
  {data&&<details><summary>Original relationship history ({data.history.length} loaded)</summary>{data.history.map(r=><p key={r.revision}>Revision {r.revision} · {r.created_at} · {r.assets.length} asset(s)</p>)}<p>Latest {data.history_limit} revisions shown. Asset and work histories remain in their original workflows.</p></details>}
  {onClose&&<button type="button" disabled={busy||dirty||Boolean(pending)} onClick={()=>{if(changeAllowed()&&!current.current.dirty)onClose()}}>Close asset links</button>}
 </section>
}
