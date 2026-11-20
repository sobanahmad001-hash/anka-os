import {useEffect,useState} from 'react'
import {readSharedWork} from '../data/sharedProjectWork.js'
import {WebsiteTrackingOverview} from './WebsiteTracking.jsx'
export default function ProjectOverview({workspace,onNavigate}){
 return <Overview key={workspace.project.organization_id+':'+workspace.project.id} workspace={workspace} onNavigate={onNavigate}/>
}
function Overview({workspace,onNavigate}){
 const [rows,setRows]=useState(null),[error,setError]=useState('')
 useEffect(()=>{const c=new AbortController();setRows(null);setError('');readSharedWork(workspace,c.signal,{includePageAssets:false}).then(r=>{if(!c.signal.aborted)setRows(r)}).catch(e=>{if(!c.signal.aborted)setError(e.message)});return()=>c.abort()},[workspace])
 const open=(rows||[]).filter(r=>!['done','cancelled','completed','declined','withdrawn','archived','delivered_published'].includes(r.workStatus))
 const today=new Date().toLocaleDateString('en-CA')
 return <section aria-label="Project overview" className="space-y-4"><h2>Project overview</h2><p>Current project Work across all services. Website pages remain in the page inventory.</p>{error?<p role="alert">{error}</p>:!rows?<p role="status">Loading project summary…</p>:<div className="grid gap-3 sm:grid-cols-3">{[['Open work',open.length],['Blocked',open.filter(r=>r.workStatus==='blocked').length],['Overdue',open.filter(r=>r.dueDate&&r.dueDate.slice(0,10)<today).length]].map(([label,count])=><article key={label} className="workspace-card p-4"><h3>{label}</h3><strong>{count}</strong></article>)}</div>}<div className="flex flex-wrap gap-2"><button className="workspace-button" onClick={()=>onNavigate('work')}>Open Work</button><button className="workspace-button" onClick={()=>onNavigate('website-work')}>Website pages and SEO status</button><button className="workspace-button" onClick={()=>onNavigate('branding-work')}>Branding & Design</button><button className="workspace-button" onClick={()=>onNavigate('marketing-work')}>Marketing</button></div><WebsiteTrackingOverview project={workspace.project}/></section>
}
