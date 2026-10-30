import {useEffect,useRef,useState} from 'react'
import {projectDeliveryContext} from '../data/projectDeliveryContext.js'
import {projectAssetRelations} from '../data/projectAssetRelations.js'
import ProjectAssetRelationsPanel from './ProjectAssetRelationsPanel.jsx'
import ProjectWorkBoard from './ProjectWorkBoard.jsx'

export default function ProjectAssetWorkLinks({asset,workspace,actorId,signal,onLockChange,onLoaded,onClose,repository=projectAssetRelations}){
 const [refs,setRefs]=useState([]),[selection,setSelection]=useState(''),[locked,setLocked]=useState(false),[error,setError]=useState(''),[busy,setBusy]=useState(false)
 const alive=useRef(true),callbacks=useRef(null);callbacks.current={onLockChange,onLoaded}
 const context=projectDeliveryContext(workspace),records=context.records,valid=asset.projectId===context.projectId&&asset.organizationId===context.organizationId
 async function load(){if(!valid||signal?.aborted)return;setBusy(true);setError('');try{const data=await repository.forAsset({...asset,assetKind:asset.kind,assetId:asset.id},{signal});if(alive.current&&!signal?.aborted){const next=data.links.map(r=>({kind:r.subject.kind,id:r.subject.id}));setRefs(next);callbacks.current.onLoaded?.(next)}}catch(e){if(alive.current&&!signal?.aborted)setError(e.message)}finally{if(alive.current)setBusy(false)}}
 useEffect(()=>{alive.current=true;void load();return()=>{alive.current=false}},[]) // eslint-disable-line react-hooks/exhaustive-deps -- parent keys exact asset/actor scope
 useEffect(()=>{callbacks.current.onLockChange?.(locked||busy);return()=>callbacks.current.onLockChange?.(false)},[locked,busy])
 if(!valid)return <p role="alert">Asset belongs to another workspace.</p>
 const selected=records.find(r=>r.kind+':'+r.id===selection),related=records.filter(r=>refs.some(x=>x.kind===r.kind&&x.id===r.id))
 return <section className="asset-relations-editor" aria-label="Manage explicit asset work"><h4>Explicit work links</h4>{error&&<p role="alert">{error}</p>}<ProjectWorkBoard records={related} busy={locked||busy} label="Explicit asset work"/>
 <p>Up to 500 currently authorized links are loaded. {refs.filter(x=>!records.some(r=>r.kind===x.kind&&r.id===x.id)).length} linked record(s) are not available in this workspace snapshot; no replacement is inferred.</p><p>Existing page implementation and campaign placement links remain in their own workflows. Select an original work record to review its complete additional asset selection.</p>
 <label>Original work record<select aria-label="Original work record" value={selection} disabled={locked||busy} onChange={e=>{if(!locked&&!busy)setSelection(e.target.value)}}><option value="">Choose project work</option>{records.map(r=><option key={r.kind+':'+r.id} value={r.kind+':'+r.id}>{r.kind==='project_task'?'Task':'Work item'} · {r.title}</option>)}</select></label>
 {selected&&<ProjectAssetRelationsPanel organizationId={asset.organizationId} projectId={asset.projectId} actorId={actorId} subjectKind={selected.kind} subjectId={selected.id} subjectLabel={selected.title} signal={signal} repository={repository} onLockChange={setLocked} onChanged={()=>void load()}/>}
 <button type="button" disabled={locked||busy} onClick={()=>{if(!locked&&!busy)onClose?.()}}>Close relationship manager</button></section>
}
