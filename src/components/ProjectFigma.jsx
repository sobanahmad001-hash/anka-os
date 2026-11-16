import {useEffect,useRef,useState} from 'react'
import {supabase} from '../lib/supabase.js'

export default function ProjectFigma({project,cardKey,onAttached}) {
  const [open,setOpen]=useState(false)
  return <section><button type="button" className="workspace-button" aria-expanded={open} onClick={()=>setOpen(!open)}>
    {cardKey?'Choose from Figma':'Figma design file'}</button>
    {open&&<Picker key={[project.id,cardKey].join(':')} {...{project,cardKey,onAttached}}/>}</section>
}


function Picker({project,cardKey,onAttached}) {
  const [settings,setSettings]=useState(null),[design,setDesign]=useState(null),[search,setSearch]=useState('')
  const [error,setError]=useState(''),[busy,setBusy]=useState(false),[notice,setNotice]=useState('')
  const pending=useRef(false),active=useRef(false)
  const scope={p_org:project.organization_id,p_project:project.id}
  async function invoke(action,params){
    const result=await supabase.functions.invoke('project-figma',{body:{org:project.organization_id,project:project.id,action,...params}})
    if(result.error){
      const message=await result.error.context?.json?.().catch(()=>null)
      throw Error(message?.error||result.error.message)
    }
    return result.data
  }
  useEffect(()=>{
    let current=true
    active.current=true
    async function load(){
      const {data,error}=await supabase.rpc('work_figma_settings',scope)
      if(error)throw error
      if(!current)return
      setSettings(data)
      if(cardKey&&data.file){
        const frames=await invoke('frames',{revision:data.revision})
        if(current)setDesign(frames)
      }
    }
    load().catch(e=>{if(current)setError(e.message)})
    return ()=>{current=false;active.current=false}
  },[project.id,project.organization_id,cardKey])
  async function select(file,node){
    if(pending.current)return
    pending.current=true;setBusy(true);setError('');setNotice('')
    try{
      if(cardKey){
        const [cardKind,cardId]=cardKey.split(':')
        await invoke('attach',{cardKind,cardId,node,version:design.version,revision:settings.revision})
        if(active.current){setNotice('Frame attached.');onAttached?.()}
      }else{
        const {data,error}=await supabase.rpc('set_work_figma_file',{...scope,p_revision:settings.revision,p_connection:file?.id??null,p_file:file?.file_key??null})
        if(error)throw error
        if(active.current){setSettings(data);setNotice(file?'Design file saved.':'Design file disconnected.')}
      }
    }catch(e){if(active.current)setError(e.message)}
    finally{pending.current=false;if(active.current)setBusy(false)}
  }
  const matches=design?.frames.filter(frame=>(frame.page+' '+frame.name).toLowerCase().includes(search.toLowerCase()))
  return <fieldset disabled={busy} className="workspace-card min-w-0 space-y-2 p-3">
    {error&&<p role="alert">{error}</p>}{notice&&<p role="status">{notice}</p>}
    {settings&&<p>{settings.file?'Design file · '+settings.file.name:settings.unavailable?'The selected Figma connection is unavailable.':'No Figma file connected.'}</p>}
    {!cardKey&&settings?.manage&&<>
      {!settings.choices.length&&<p>Verify a Figma connection for the design file in Integrations to select it here.</p>}
      {settings.choices.map(file=><button type="button" key={file.id} onClick={()=>select(file)}>{file.name} · {file.file_key}</button>)}
      {(settings.file||settings.unavailable)&&<button type="button" onClick={()=>select(null)}>Disconnect design file</button>}
    </>}
    {design&&<><label>Search frames <input value={search} onChange={e=>setSearch(e.target.value)}/></label>
      <ul>{matches.map(frame=><li key={frame.id}><button type="button" onClick={()=>select(null,frame.id)}>{frame.page} / {frame.name} · {frame.id}</button></li>)}</ul>
      {!matches.length&&<p>No matching frames.</p>}</>}
  </fieldset>
}
