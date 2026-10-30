import {lazy,Suspense,useEffect,useRef,useState} from 'react'
import {projectAssetRelations} from '../data/projectAssetRelations.js'
const ContextConversationPanel=lazy(()=>import('./ContextConversationPanel.jsx'))

export default function ProjectAssetConversations({asset,workspace,signal,onLockChange,onClose,repository=projectAssetRelations}){
 const [data,setData]=useState({conversations:[],offset:0,has_more:false}),[selected,setSelected]=useState(null),[busy,setBusy]=useState(false),[chatBusy,setChatBusy]=useState(false),[dirty,setDirty]=useState(false),[error,setError]=useState('')
 const alive=useRef(true),current=useRef(null),callbacks=useRef(null);current.current={signal,chatBusy,dirty};callbacks.current={onLockChange}
 const active=()=>alive.current&&!current.current.signal?.aborted
 async function load(offset){if(!active()||current.current.chatBusy||current.current.dirty||busy)return;setBusy(true);setError('');try{const r=await repository.conversations({...asset,assetKind:asset.kind,assetId:asset.id,offset},{signal});if(active())setData(r)}catch(e){if(active())setError(e.message)}finally{if(active())setBusy(false)}}
 useEffect(()=>{alive.current=true;void load(0);return()=>{alive.current=false}},[]) // eslint-disable-line react-hooks/exhaustive-deps -- exact asset keyed by parent
 useEffect(()=>{callbacks.current.onLockChange?.(busy||chatBusy||dirty);return()=>callbacks.current.onLockChange?.(false)},[busy,chatBusy,dirty])
 return <section className="asset-relations-editor" aria-label="Linked asset conversations"><h4>Linked asset conversations</h4><p>Only conversations you currently own or were explicitly shared are listed. Open an original project conversation and use Asset links to link it. Private histories are not promoted, copied or exposed by this list.</p>{error&&<p role="alert">{error}</p>}
 <label>Original linked conversation<select aria-label="Original linked conversation" value={selected?.id||''} disabled={busy||chatBusy||dirty} onChange={e=>{if(active()&&!current.current.chatBusy&&!current.current.dirty)setSelected(data.conversations.find(c=>c.id===e.target.value)||null)}}><option value="">Choose an authorized linked conversation</option>{data.conversations.map(c=><option key={c.id} value={c.id}>{c.title||'Project conversation'} · {c.id}</option>)}</select></label>
 {!data.conversations.length&&<p>No accessible linked conversation is present on this page. A project member cannot infer another member’s private or unshared conversations.</p>}
 <div className="asset-actions"><button type="button" disabled={busy||chatBusy||dirty||data.offset===0} onClick={()=>void load(Math.max(0,data.offset-50))}>Previous conversations</button><button type="button" disabled={busy||chatBusy||dirty||!data.has_more} onClick={()=>void load(data.offset+50)}>More conversations</button></div>
 {selected&&<Suspense fallback={<p role="status">Opening original conversation…</p>}><ContextConversationPanel key={selected.id} directSend contextKind="project_team" projectId={asset.projectId} label={asset.title+' · Project conversation'} initialConversation={selected} projectJourney={workspace} onNavigationBusyChange={setChatBusy} onDraftDirtyChange={setDirty}/></Suspense>}
 <button type="button" disabled={busy||chatBusy||dirty} onClick={()=>{if(active()&&!current.current.chatBusy&&!current.current.dirty)onClose?.()}}>Close linked conversations</button></section>
}
