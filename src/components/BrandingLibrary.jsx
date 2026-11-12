import {useEffect,useState} from 'react'
import VisualIdentityCard from './VisualIdentityCard.jsx'
import {Link} from 'react-router-dom'
import {supabase} from '../lib/supabase.js'
import {brandingGroups,approvedBrandVersion} from '../data/manualBranding.js'

export default function BrandingLibrary({workspace,onCreate,onOpen,refresh=0,visualIdentityService,actorId,onIdentityChange}) {
  const {project,deliverables}=workspace
  const [inventory,setInventory]=useState(null),[error,setError]=useState('')
  const [selection,setSelection]=useState(''),[file,setFile]=useState(''),[busy,setBusy]=useState(false)
  const [revision,setRevision]=useState(0),[download,setDownload]=useState(null)
  useEffect(()=>{
    let current=true
    const query=(table,fields)=>supabase.from(table).select(fields).eq('organization_id',project.organization_id).eq('project_id',project.id)
    Promise.all([
      query('brand_deliverable_cards','deliverable_id,brand_kind,final_version_id,stage'),
      query('brand_supplied_assets','file_id,owner_statement,files!inner(file_name,storage_bucket,storage_path,archived_at)').is('files.archived_at',null),
      query('brand_asset_uses','brand_kind,file_id'),
    ]).then(results=>{
      if(!current)return
      const failed=results.find(r=>r.error)
      if(failed){setError(failed.error.message);setInventory(null);return}
      const [cards,assets,uses]=results.map(r=>r.data)
      setInventory({cards,assets,uses})
    }).catch(()=>{if(current)setError('Branding assets could not be loaded.')})
    return ()=>{current=false}
  },[project.id,project.organization_id,revision,refresh])
  async function attach(){
    if(!selection||!file||busy)return
    setBusy(true);setError('')
    try{
      const {error:e}=await supabase.rpc('link_project_brand_asset',{p_organization:project.organization_id,p_project:project.id,p_kind:selection,p_file:file})
      if(e)throw e
      setSelection('');setFile('');setRevision(n=>n+1)
    }catch(e){setError(e.message)}finally{setBusy(false)}
  }
  async function retrieve(id,prefix){
    setError('');setDownload(null)
    try{
      const {data,error:e}=await supabase.from('files').select('storage_bucket,storage_path').eq('id',id).eq('organization_id',project.organization_id).eq('project_id',project.id).is('archived_at',null).single()
      if(e)throw e
      if(data.storage_bucket!=='sphere-deliverables'||!data.storage_path.startsWith(project.id+'/'+prefix+'/'))throw Error('Project file unavailable.')
      const signed=await supabase.storage.from(data.storage_bucket).createSignedUrl(data.storage_path,60)
      if(signed.error)throw signed.error
      setDownload({id,url:signed.data.signedUrl})
    }catch(e){setError(e.message)}
  }
  const fileAction=(id,prefix)=>download?.id===id?<a href={download.url} rel="noreferrer">Open file</a>:<button type="button" onClick={()=>retrieve(id,prefix)}>Retrieve file</button>
  return <section className="workspace-card brand-library p-4" aria-label="Project branding assets"><h2>Branding</h2>
    {error&&<p role="alert">{error}</p>}
    <div className="brand-library-groups">{brandingGroups.map(group=><section key={group.title}><h3>{group.title}</h3>
      {group.items.map(kind=>{
        const assets=(inventory?.uses||[]).filter(u=>u.brand_kind===kind.key).map(u=>inventory.assets.find(a=>a.file_id===u.file_id)).filter(Boolean)
        const quickCard=inventory && visualIdentityService && group.title==='Visual identity'
        const matchingCards=inventory?.cards.filter(c=>c.brand_kind===kind.key)||[]
        const designCard=deliverable=><VisualIdentityCard key={deliverable?.id||kind.key} kind={kind} workspace={workspace} service={visualIdentityService} deliverable={deliverable} actorId={actorId} onRefresh={onIdentityChange}/>
        return <article key={kind.key}><h4>{kind.label}</h4>{kind.example&&<p>{kind.example} and logo variants</p>}
          {assets.map(a=><div key={a.file_id}><strong>{a.files.file_name}</strong><p>Owner-reported history · {a.owner_statement}</p>{fileAction(a.file_id,'supplied-brand')}</div>)}
          {matchingCards.map(c=>{
            const d=deliverables.find(row=>row.id===c.deliverable_id)
            if(!d)return null
            const v=approvedBrandVersion(d,c.final_version_id)
            if(!onOpen&&!v)return null
            const url=v?.preview_metadata?.preview_url
            return <div key={d.id}>{onOpen?<button type="button" onClick={()=>onOpen(d.id)}>{d.title}</button>:<strong>{d.title}</strong>}
              {quickCard&&designCard(d)}
              {v&&<p>Approved v{v.version_number} {v.file_id?fileAction(v.file_id,d.id):/^https:\/\/(www\.)?figma\.com\/(design|file|proto)\//.test(url)&&<a href={url} target="_blank" rel="noreferrer">Open source</a>}</p>}
            </div>
          })}
          {quickCard&&!matchingCards.length&&designCard(null)}
          {onOpen&&inventory&&<div className="brand-library-actions"><button type="button" onClick={()=>{setSelection(kind.key);setFile('')}}>Use existing asset</button>
          {onCreate&&!quickCard&&<button type="button" onClick={()=>onCreate(kind)}>Create work</button>}</div>}
          {selection===kind.key&&<div><label>Existing project asset<select value={file} onChange={e=>setFile(e.target.value)}><option value="">Choose a file</option>
            {inventory.assets.map(a=><option key={a.file_id} value={a.file_id}>{a.files.file_name}</option>)}</select></label>
            <button type="button" disabled={!file||busy} onClick={attach}>Link asset</button> <Link to="?tab=outputs">Open Project Assets</Link> <button type="button" onClick={()=>setSelection('')}>Cancel</button></div>}
        </article>
      })}
    </section>)}</div></section>
}
