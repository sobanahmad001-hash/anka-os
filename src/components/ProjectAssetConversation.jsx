import {useEffect,useRef,useState} from 'react'
import {projectAssetRelations} from '../data/projectAssetRelations.js'
import {projectDeliveryContext} from '../data/projectDeliveryContext.js'
import ProjectAssetRelationsPanel from './ProjectAssetRelationsPanel.jsx'
import ProjectWorkBoard from './ProjectWorkBoard.jsx'

export default function ProjectAssetConversation({workspace,organizationId,projectId,actorId,conversationId,owner,signal,onLockChange,onClose,externallyBusy,repository=projectAssetRelations}){
 const [data,setData]=useState(null),[selected,setSelected]=useState(''),[links,setLinks]=useState([]),[busy,setBusy]=useState(false),[locked,setLocked]=useState(false),[editing,setEditing]=useState(false),[error,setError]=useState('')
 const current=useRef(null),alive=useRef(true),seq=useRef(0),callbacks=useRef(null);callbacks.current={onLockChange}
 current.current={selected,signal,externallyBusy,locked}
 const scope={organizationId,projectId,subjectKind:'conversation',subjectId:conversationId},context=projectDeliveryContext(workspace)
 const active=()=>alive.current&&!current.current.signal?.aborted
 async function load(){if(!active())return;const n=++seq.current;setBusy(true);setError('');try{const result=await repository.read(scope,{signal});if(active()&&n===seq.current){setData(result);setSelected('');setLinks([])}}catch(e){if(active()&&n===seq.current)setError(e.message)}finally{if(active()&&n===seq.current)setBusy(false)}}
 useEffect(()=>{alive.current=true;void load();return()=>{alive.current=false;seq.current++}},[]) // eslint-disable-line react-hooks/exhaustive-deps -- parent keys current actor/conversation
 useEffect(()=>{callbacks.current.onLockChange?.(busy||locked);return()=>callbacks.current.onLockChange?.(false)},[busy,locked])
 if(context.organizationId!==organizationId||context.projectId!==projectId)return <p role="alert">Conversation asset context belongs to another project.</p>
 async function choose(key){if(!active()||current.current.externallyBusy||current.current.locked||busy)return;current.current.selected=key;setSelected(key);setLinks([]);if(!key)return;const asset=data.assets.find(a=>a.kind+':'+a.id===key);if(!asset)return;const n=++seq.current;setBusy(true);setError('');try{const result=await repository.forAsset({...scope,assetKind:asset.kind,assetId:asset.id},{signal});if(active()&&n===seq.current&&current.current.selected===key)setLinks(result.links)}catch(e){if(active()&&n===seq.current)setError(e.message)}finally{if(active()&&n===seq.current)setBusy(false)}}
 const records=context.records.filter(r=>links.some(l=>l.subject.kind===r.kind&&l.subject.id===r.id))
 return <section className="asset-relations-editor" aria-label="Conversation asset context"><h3>Conversation asset context</h3><p>These are explicit relationships for this original project conversation. Work cards open the same canonical records in Workshops; no build, staging or AI action runs here.</p>{error&&<p role="alert">{error}</p>}
 {data&&<><label>Linked asset<select aria-label="Linked conversation asset" disabled={busy||locked||externallyBusy} value={selected} onChange={e=>void choose(e.target.value)}><option value="">Choose a linked asset</option>{data.assets.map(a=><option key={a.kind+':'+a.id} value={a.kind+':'+a.id}>{data.asset_labels?.find(l=>l.kind===a.kind&&l.id===a.id)?.label||(a.kind==='website_page'?'Website page':'Marketing asset')} · {a.id.slice(-8)}</option>)}</select></label>{!data.assets.length&&<p>This conversation has no explicit asset links.</p>}</>}
 {selected&&<p>Up to 500 authorized work links are shown. {links.filter(l=>!context.records.some(r=>r.kind===l.subject.kind&&r.id===l.subject.id)).length} linked record(s) are unavailable in this workspace; no replacement is inferred.</p>}{selected&&<ProjectWorkBoard records={records} busy={busy||locked||externallyBusy} label="Conversation contextual work"/>}
 {owner&&!editing&&<button type="button" disabled={busy||externallyBusy} onClick={()=>setEditing(true)}>Review conversation asset links</button>}
 {owner&&editing&&<ProjectAssetRelationsPanel {...scope} actorId={actorId} signal={signal} externallyBusy={externallyBusy} repository={repository} subjectLabel="This project conversation" onLockChange={setLocked} onChanged={()=>void load()} onClose={()=>setEditing(false)}/>}
 {!owner&&<p>Only the current conversation owner can change its links. Existing explicit sharing controls access.</p>}
 <button type="button" disabled={busy||locked||externallyBusy} onClick={()=>{if(active()&&!busy&&!current.current.locked&&!current.current.externallyBusy)onClose?.()}}>Close conversation asset context</button></section>
}
