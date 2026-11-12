import {useRef,useState} from 'react'
import {supabase} from '../lib/supabase.js'
import {delivery} from '../data/delivery.js'
import {figmaSourceUrl} from '../data/manualBranding.js'

export default function VisualIdentityCard({kind,workspace,service,deliverable,actorId,onRefresh}) {
  const {project}=workspace
  const streams=workspace.workstreams.filter(stream=>stream.department_id===service.service_catalog.department_id)
  const [stream,setStream]=useState('')
  const [link,setLink]=useState('')
  const [error,setError]=useState('')
  const [busy,setBusy]=useState(false)
  const lock=useRef(false)
  const workstream=streams.length===1?streams[0].id:stream
  const latest=deliverable?.versions.filter(version=>!version.withdrawn_at && figmaSourceUrl(version.preview_metadata?.preview_url))
    .sort((a,b)=>b.version_number-a.version_number)[0]
  async function submit(event){
    event.preventDefault()
    if(lock.current)return
    lock.current=true
    setBusy(true)
    setError('')
    try{
      if(deliverable){
        const previewUrl=figmaSourceUrl(link)
        if(!previewUrl)throw Error('Enter a Figma design, file or prototype link.')
        await delivery.createDeliverableVersion({organizationId:project.organization_id,projectId:project.id,
          deliverableId:deliverable.id,title:deliverable.title,previewUrl,changeSummary:'Updated Figma source',clientApprovalRequired:false},actorId)
        setLink('')
      }else{
        const {error:failure}=await supabase.functions.invoke('work-items',{body:{
          action:'save_brand_deliverable_card',organizationId:project.organization_id,projectId:project.id,
          serviceId:service.id,deliverableId:crypto.randomUUID(),expectedRevision:null,
          plan:{brandKind:kind.key,title:kind.label,workstream,stage:'brief',brief:'Prepare the project '+kind.label.toLowerCase()+'.',next:'Add the design source.'}
        }})
        if(failure)throw failure
      }
      await onRefresh()
    }catch(reason){setError(reason.message)}finally{lock.current=false;setBusy(false)}
  }
  return <form className="visual-identity-card" aria-label={kind.label+' design source'} onSubmit={submit}>
    {deliverable?<>{latest&&<a href={figmaSourceUrl(latest.preview_metadata.preview_url)} target="_blank" rel="noreferrer">Open Figma source · v{latest.version_number}</a>}
      <label>Figma link<input type="url" required placeholder="Paste a Figma file or frame link" value={link} onChange={event=>setLink(event.target.value)}/></label>
    </>:streams.length!==1&&<label>Design workstream<select required value={stream} onChange={event=>setStream(event.target.value)}>
      <option value="">Choose workstream</option>{streams.map(row=><option key={row.id} value={row.id}>{row.name}</option>)}</select></label>}
    {!deliverable&&!streams.length&&<p>Add a Design workstream to this project to use this card.</p>}
    <button className="workspace-button" disabled={busy||(deliverable?!figmaSourceUrl(link):!workstream)}>{deliverable?'Save Figma link':'Add '+kind.label+' card'}</button>
    {error&&<p role="alert">{error}</p>}
  </form>
}
