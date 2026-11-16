import {useEffect,useRef,useState} from 'react'
import {supabase} from '../lib/supabase.js'

const scope='https://www.googleapis.com/auth/drive.metadata.readonly'
let googleScript
function loadGoogle(){
 if(window.google?.accounts?.oauth2)return Promise.resolve()
 if(!googleScript)googleScript=new Promise((resolve,reject)=>{
  const script=document.createElement('script')
  script.src='https://accounts.google.com/gsi/client';script.async=true
  script.onload=()=>resolve()
  script.onerror=()=>{googleScript=null;script.remove();reject(Error('Google sign-in could not load.'))}
  document.head.appendChild(script)
 })
 return googleScript
}
function consent(clientId){
 return new Promise((resolve,reject)=>{
  window.google.accounts.oauth2.initTokenClient({client_id:clientId,scope,include_granted_scopes:false,
   callback:r=>r.access_token&&!r.error&&window.google.accounts.oauth2.hasGrantedAllScopes(r,scope)?
    resolve(r.access_token):reject(Error('Google Drive metadata permission was not granted.')),
   error_callback:()=>reject(Error('Google sign-in was closed or blocked.'))}).requestAccessToken({prompt:'select_account'})
 })
}
export function driveFileId(value){
 try{
  const u=new URL(value)
  if(u.protocol!=='https:'||!['drive.google.com','docs.google.com'].includes(u.hostname))return null
  const id=u.pathname==='/open'?u.searchParams.get('id'):u.pathname.match(/^\/(?:file|document|spreadsheets|presentation|forms|drawings)\/d\/([\w-]+)(?:\/|$)/)?.[1]
  return id&&/^[\w-]{1,200}$/.test(id)?id:null
 }catch{return null}
}
async function request(project,action,params={}){
 const {data,error}=await supabase.functions.invoke('project-drive',{body:{org:project.organization_id,project:project.id,action,...params}})
 if(error){const body=await error.context?.json?.().catch(()=>null);throw Object.assign(Error(body?.error||error.message),{code:body?.code})}
 return data
}

export default function ProjectDrive({project,cardKey,fileId,onAttached}){
 const [opened,setOpened]=useState(false)
 const title=fileId?'Check Drive availability':cardKey?'Choose from Drive':'Google Drive folder'
 return <section><button type="button" className="workspace-button" aria-expanded={opened} onClick={()=>setOpened(!opened)}>{title}</button>
 {opened&&<DriveSession key={[project.organization_id,project.id,cardKey,fileId].join(':')} {...{project,cardKey,fileId,onAttached}}/>}</section>
}

function DriveSession({project,cardKey,fileId,onAttached}){
 const [settings,setSettings]=useState(null),[ready,setReady]=useState(false),[token,setToken]=useState('')
 const [search,setSearch]=useState(''),[items,setItems]=useState(null),[error,setError]=useState(''),[notice,setNotice]=useState('')
 const [busy,setBusy]=useState(false),flight=useRef(false),active=useRef(true)
 const [cardKind,cardId]=cardKey?.split(':')||[]
 const managing=!cardKey&&!fileId
 useEffect(()=>{
  active.current=true;let current=true
  request(project,'settings').then(async data=>{
   if(!current)return
   setSettings(data)
   if(!data.clientId){setError('Google OAuth client is not configured.');return}
   await loadGoogle()
   if(current)setReady(true)
  }).catch(e=>{if(current)setError(e.message)})
  return ()=>{current=false;active.current=false}
 },[project])
 async function run(fn){
  if(flight.current)return
  flight.current=true;setBusy(true);setError('');setNotice('')
  try{await fn()}catch(e){if(active.current){setError(e.message);if(e.code==='consent'){setToken('');setItems(null)}}}
  finally{flight.current=false;if(active.current)setBusy(false)}
 }
 async function browse(access,page=''){
  const result=await request(project,managing?'folders':'files',{token:access,revision:settings.revision,search,page})
  if(active.current)setItems(result)
 }
 async function check(access){
  const result=await request(project,'status',{token:access,revision:settings.revision,file:fileId})
  if(active.current)setNotice(({available:'Available in the connected folder.',moved:'Moved outside the connected folder.',trashed:'File is in Trash.',unsupported:'Unsupported Drive item.'})[result.state])
 }
 async function connect(){
  const access=await consent(settings.clientId)
  if(!active.current)return
  setToken(access)
  if(fileId)await check(access);else await browse(access)
 }
 async function choose(item){
  const result=await request(project,managing?'bind':'attach',{token,revision:settings.revision,file:item.id,cardKind,cardId})
  if(!active.current)return
  if(managing){setSettings({...settings,...result});setItems(null);setNotice('Project folder saved.')}
  else{setNotice('Drive file attached.');onAttached?.()}
 }
 async function disconnect(){
  const result=await request(project,'disconnect',{revision:settings.revision})
  if(active.current){setSettings({...settings,...result});setItems(null);setToken('');setNotice('Project folder disconnected.')}
 }
 return <fieldset disabled={busy} className="workspace-card min-w-0 space-y-2 p-3">
 {settings&&<p>{settings.folder?'Connected folder · '+settings.name:'No Drive folder connected.'}</p>}
 {error&&<p role="alert">{error}</p>}{notice&&<p role="status">{notice}</p>}
 {settings&&(managing?settings.manage:settings.folder)&&<>
 <button type="button" disabled={!ready} onClick={()=>run(connect)}>{token?'Switch Google account':'Connect Google account'}</button>
 {token&&!fileId&&<><label>Search {managing?'folders':'files'} <input value={search} maxLength={160} onChange={e=>{setSearch(e.target.value);setItems(null)}}/></label>
 <button type="button" onClick={()=>run(()=>browse(token))}>Search Drive</button></>}
 {token&&fileId&&<button type="button" onClick={()=>run(()=>check(token))}>Refresh status</button>}
 {items&&<><ul>{items.files.map(item=><li key={item.id}><button type="button" onClick={()=>run(()=>choose(item))}>{item.name}</button></li>)}</ul>
 {!items.files.length&&<p>No matching items.</p>}{items.incompleteSearch&&<p>Google returned partial results.</p>}
 {items.nextPageToken&&<button type="button" onClick={()=>run(()=>browse(token,items.nextPageToken))}>Next results</button>}</>}
 {managing&&settings.folder&&<button type="button" onClick={()=>run(disconnect)}>Disconnect project folder</button>}
 </>}</fieldset>
}
