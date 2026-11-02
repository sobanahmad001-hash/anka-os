import {useMemo,useState} from 'react'
import {Link} from 'react-router-dom'
import {projectDeliveryContext} from '../data/projectDeliveryContext.js'
import WorkspaceDialog from './WorkspaceDialog.jsx'
import './projectOutputLibrary.css'
const label=value=>String(value||'Unknown').replaceAll('_',' ')
export default function ProjectOutputLibrary(props){
 const project=props.workspace.project
 return <OutputLibrary key={[project.organization_id,project.id,props.workspace.engagement?.id].join(':')} {...props}/>
}
function OutputLibrary({workspace,busy=false,stale=false}){
 const context=useMemo(()=>projectDeliveryContext(workspace),[workspace])
 const [query,setQuery]=useState(''),[kind,setKind]=useState('all'),[selected,setSelected]=useState(null),[versionId,setVersionId]=useState('')
 const kinds=[...new Set(context.outputs.map(output=>output.artifact_type))].filter(Boolean).sort()
 const linked=id=>context.records.filter(record=>record.artifact?.id===id)
 const rows=context.outputs.filter(output=>(kind==='all'||output.artifact_type===kind)&&[output.title,output.artifact_type,...linked(output.id).map(record=>record.title)].some(value=>String(value||'').toLowerCase().includes(query.trim().toLowerCase())))
 const output=selected?.project===context.projectId&&selected?.organization===context.organizationId?context.outputs.find(row=>row.id===selected.id):null
 const version=output?.versions.find(row=>row.id===versionId),blocked=busy||stale
 const open=row=>{setSelected({id:row.id,project:context.projectId,organization:context.organizationId});setVersionId('')}
 return <section className="workspace-card studio-output-library" aria-label="Project output library">
  <header><h2>Saved Workshop outputs</h2><p>Search the loaded project outputs and their linked work. Website pages and campaign assets keep their original workspaces above.</p></header>
  {stale&&<p role="status">This is the last loaded snapshot. Refresh the project before following an output or work link.</p>}
  <div className="studio-output-filters"><label>Search outputs<input type="search" maxLength={160} value={query} onChange={e=>setQuery(e.target.value)} placeholder="Output or linked work title"/></label><label>Output type<select value={kind} onChange={e=>setKind(e.target.value)}><option value="all">All types</option>{kinds.map(type=><option key={type} value={type}>{label(type)}</option>)}</select></label></div>
  <p role="status">{rows.length} of {context.outputs.length} loaded outputs</p>
  {!rows.length&&<p>{context.outputs.length?'No outputs match these filters.':'No saved Workshop outputs are available in this project view.'}</p>}
  <ul className="studio-output-list">{rows.map(row=><li key={row.id}><div><h3>{row.title||'Untitled output'}</h3><p>{label(row.artifact_type)} · {row.versions.length} loaded version(s) · {linked(row.id).length} linked work record(s)</p></div><button type="button" className="workspace-button" onClick={()=>open(row)}>Inspect output<span className="sr-only">: {row.title||'Untitled output'}</span></button></li>)}</ul>
  {output&&<WorkspaceDialog title={output.title||'Saved output'} onClose={()=>{setSelected(null);setVersionId('')}} wide>
   <div className="studio-output-detail">
    <p>Saved versions, work status and publication are separate records. No approval or publication is inferred here.</p>
    <label>Saved version<select value={version?.id||''} onChange={e=>setVersionId(e.target.value)}><option value="">Choose an exact saved version</option>{output.versions.map(row=><option key={row.id} value={row.id}>Version {row.version_number??'not numbered'}</option>)}</select></label>
    {!output.versions.length&&<p role="status">No accessible version is loaded for this output.</p>}
    {version&&<section aria-label="Selected exact version"><h3>Version {version.version_number??'not numbered'}</h3>{version.path?blocked?<button type="button" className="workspace-button workspace-button-primary" disabled>Open exact version</button>:<Link className="workspace-button workspace-button-primary" to={version.path}>Open exact version</Link>:<p>No exact-version route is available here for this output type. Inspect it in its owning workflow.</p>}<details><summary>Version provenance</summary><p>Output: {output.id}</p><p>Version: {version.id}</p></details></section>}
    <section aria-label="Work linked to this output"><h3>Linked work</h3>{linked(output.id).length?<ul>{linked(output.id).map(record=><li key={record.kind+':'+record.id}>{blocked?<button type="button" className="workspace-button" disabled>{record.title}</button>:<Link className="workspace-button" to={record.recordPath}>{record.title}</Link>}<p>{label(record.status)} · {record.kind==='project_task'?'Project task':'Engagement work item'}</p><p>{record.linkedVersionId?output.versions.some(row=>row.id===record.linkedVersionId)?`Recorded version link: ${record.linkedVersionId}`:'The recorded version link is unavailable in this snapshot.':'Linked to this output; no exact version link is recorded.'}</p></li>)}</ul>:<p>No explicit work link is present in this snapshot. Nothing is matched by title.</p>}</section>
   </div>
  </WorkspaceDialog>}
 </section>
}
