import ProjectFigma from './ProjectFigma.jsx'
import ProjectDrive, {driveFileId} from './ProjectDrive.jsx'
import {useEffect,useRef,useState} from 'react'
import {uploadIdentity,duplicateUpload} from '../data/workCardAssetUpload.js'
import {Link} from 'react-router-dom'
import {supabase} from '../lib/supabase.js'

async function checked(query){
 const {data,error}=await query
 if(error)throw error
 return data
}

export default function WorkCardAssets({project,cardKey}){
 const [open,setOpen]=useState(false)
 return <section><button type="button" className="workspace-button" aria-expanded={open} onClick={()=>setOpen(!open)}>{cardKey?'Card assets':'Project asset library'}</button>
 {open&&<AssetPicker key={[project.organization_id,project.id,cardKey].join(':')} project={project} cardKey={cardKey}/>}</section>
}

function AssetPicker({project,cardKey}){
 const [cardKind,cardId]=cardKey?.split(':')||[]
 const [search,setSearch]=useState(''),[offset,setOffset]=useState(0),[revision,refresh]=useState(0)
 const [data,setData]=useState(null),[error,setError]=useState(''),[busy,setBusy]=useState(false)
 const [mode,setMode]=useState(cardKey?'attached':'choose'),[url,setUrl]=useState(''),[usage,setUsage]=useState(null)
 const [file,setFile]=useState(null),flight=useRef(false)
 const scope={p_org:project.organization_id,p_project:project.id}
 useEffect(()=>{
  const abort=new AbortController()
  setData(null);setError('')
  checked(supabase.rpc('list_work_card_assets',{p_org:project.organization_id,p_project:project.id,p_card_kind:cardKind||null,p_card_id:cardId||null,p_search:search,p_offset:offset}).abortSignal(abort.signal))
   .then(items=>{if(!abort.signal.aborted)setData(items)}).catch(e=>{if(!abort.signal.aborted)setError(e.message)})
  return ()=>abort.abort()
 },[project.organization_id,project.id,cardKind,cardId,offset,search,revision])
 async function act(fn){
  if(flight.current)return
  flight.current=true;setBusy(true);setError('')
  try{await fn()}catch(e){setError(e.message)}finally{flight.current=false;setBusy(false)}
 }
 async function attach(params){
  await checked(supabase.rpc('attach_work_card_asset',{...scope,p_card_kind:cardKind,p_card_id:cardId,...params}))
  setMode('attached');refresh(n=>n+1);setUrl('');setFile(null)
 }
 async function uploadFile(){
  const {data,error:authError}=await supabase.auth.getUser()
  if(authError)throw authError
  const id=await uploadIdentity(file)
  const path=project.id+'/'+data.user.id+'/'+id
  const result=await supabase.storage.from('work-card-files').upload(path,file,{upsert:false})
  if(result.error && !duplicateUpload(result.error))throw result.error
  await attach({p_kind:'file',p_upload:id,p_filename:file.name})
 }
 async function showUsage(asset,start){
  const rows=await checked(supabase.rpc('work_card_asset_usage',{...scope,p_kind:asset.kind,p_id:asset.id,p_offset:start}))
  setUsage({asset,start,rows})
 }
 function row(asset,choose){
  return <li key={asset.kind+asset.id} className="flex min-w-0 flex-wrap items-center gap-2 [overflow-wrap:anywhere]"><span className="min-w-0 max-w-full">{asset.label}</span>
   {asset.url&&<a href={asset.url} target="_blank" rel="noreferrer">Open link</a>}
   {driveFileId(asset.url)&&<ProjectDrive project={project} fileId={driveFileId(asset.url)}/>}
   {asset.bucket&&asset.path&&<button type="button" onClick={()=>act(async()=>{
    const value=await checked(supabase.storage.from(asset.bucket).createSignedUrl(asset.path,60))
    setUsage({asset,start:0,rows:[],download:value.signedUrl})
   })}>Get file</button>}
   {choose&&cardKey&&<button type="button" onClick={()=>act(()=>attach({p_kind:asset.kind,p_id:asset.id}))}>Attach</button>}
   <button type="button" onClick={()=>act(()=>showUsage(asset,0))}>Used on cards</button>
  </li>
 }
 return <fieldset disabled={busy} className="workspace-card min-w-0 max-w-full space-y-3 p-3 [&_input]:max-w-full [&_button]:whitespace-normal">
 {cardKey&&<nav aria-label="Card asset actions" className="flex flex-wrap gap-1">{[['attached','Attached assets'],['choose','Choose project asset'],['upload','Upload file'],['link','Paste link']].map(([v,label])=><button className="workspace-button" type="button" key={v} aria-pressed={v===mode} onClick={()=>{setMode(v);setUsage(null)}}>{label}</button>)}</nav>}
 {cardKey&&<ProjectFigma project={project} cardKey={cardKey} onAttached={()=>{setMode('attached');refresh(n=>n+1)}}/>}
 {cardKey&&<ProjectDrive project={project} cardKey={cardKey} onAttached={()=>{setMode('attached');refresh(n=>n+1)}}/>}
 {error&&<p role="alert">{error}</p>}
 {mode==='attached'&&data&&<ul>{data.attached.length?data.attached.map(a=>row(a,false)):<li>No assets attached.</li>}</ul>}
 {mode==='choose'&&<><label>Search assets <input maxLength={200} value={search} onChange={e=>{setSearch(e.target.value);setOffset(0)}}/></label>
 {data&&<><ul>{data.options.slice(0,50).map(a=>row(a,true))}</ul>
 <button type="button" disabled={!offset} onClick={()=>setOffset(offset-50)}>Previous assets</button>
 <button type="button" disabled={data.options.length<=50} onClick={()=>setOffset(offset+50)}>Next assets</button></>}</>}
 {mode==='link'&&<><label>Figma, Drive or other HTTPS link <input type="url" value={url} maxLength={2000} onChange={e=>setUrl(e.target.value)}/></label>
 <button type="button" disabled={!url.trim()} onClick={()=>act(()=>attach({p_kind:'link',p_url:url.trim()}))}>Attach link</button></>}
 {mode==='upload'&&<><label>File <input type="file" onChange={e=>{setFile(e.target.files[0])}}/></label><button type="button" disabled={!file} onClick={()=>act(uploadFile)}>Upload and attach</button></>}
 {usage&&(usage.download?<a href={usage.download} target="_blank" rel="noreferrer">Open file</a>:<section><h4>Cards using {usage.asset.label}</h4>
 <ul>{usage.rows.slice(0,50).map(c=><li key={c.card_kind+c.card_id}><Link to={c.card_kind==='page'?'/sphere/workspace/projects/'+project.id+'?tab=website-work&page='+c.card_id:'/sphere/workspace/items/'+c.card_kind+'/'+c.card_id}>{c.title}</Link></li>)}</ul>
 {!usage.rows.length&&<p>No current cards.</p>}
 {usage.start>0&&<button type="button" onClick={()=>act(()=>showUsage(usage.asset,usage.start-50))}>Previous cards</button>}
 {usage.rows.length>50&&<button type="button" onClick={()=>act(()=>showUsage(usage.asset,usage.start+50))}>Next cards</button>}</section>)}
 </fieldset>
}
