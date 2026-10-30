import {Link} from 'react-router-dom'
import {groupWorkByStatus} from '../data/projectAssetWork.js'
import './projectAssetWork.css'

export default function ProjectWorkBoard({records,busy=false,label='Recorded work board'}){
 const link=(path,text)=>path?<Link to={path} onClick={e=>{if(busy)e.preventDefault()}} aria-disabled={busy} className="workspace-button">{text}</Link>:null
 return <section aria-label={label} className="asset-work-board">{groupWorkByStatus(records).map(column=><section key={column.status} className="asset-board-column"><h4>{column.status.replaceAll('_',' ')} <span>({column.records.length})</span></h4><ul>{column.records.map(r=><li key={r.kind+':'+r.id}><h5>{r.title}</h5><p>{r.kind==='project_task'?'Project Task':'Engagement Work Item'} · {r.owner?.name||'Unassigned'}</p>{r.dependencies.length>0&&<p>{r.dependencies.length} recorded dependencies</p>}{r.unavailable>0&&<p>Some dependencies are unavailable.</p>}<div className="asset-actions">{link(r.recordPath,'Open original work')}{link(r.workshop,'Edit same work in Workshop')}</div></li>)}</ul></section>)}{!records.length&&<p>No recorded work matches this view.</p>}</section>
}
