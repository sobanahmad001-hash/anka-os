import {useEffect,useRef,useState} from 'react'
import {Link as _Link,useLocation} from 'react-router-dom'
import './projectReviewEvidence.css'
const label=value=>value?.replaceAll('_',' ')||'Not recorded'
const when=value=>value?new Date(value).toLocaleString():'Not recorded'
const epoch=value=>{const parsed=Date.parse(value);return Number.isFinite(parsed)?parsed:-Infinity}
const newest=(rows=[],field,predicate=()=>true)=>rows.filter(predicate).slice().sort((a,b)=>epoch(b[field])-epoch(a[field])||String(b.id||'').localeCompare(String(a.id||'')))[0]
export default function ProjectReviewEvidencePanel({deliverables,busy=false,stale=false}){
 const location=useLocation(),panel=useRef(null),[anchor,setAnchor]=useState(''),[pendingAnchor,setPendingAnchor]=useState('')
 useEffect(()=>{const read=()=>{let id='';try{id=decodeURIComponent((location.hash||globalThis.location?.hash||'').slice(1))}catch{}setAnchor(id.startsWith('deliverable-version-')?id:'')};read();globalThis.addEventListener?.('hashchange',read);return()=>globalThis.removeEventListener?.('hashchange',read)},[location.hash])
 const [query,setQuery]=useState(''),[status,setStatus]=useState('all'),[releaseFilter,setReleaseFilter]=useState('all')
 const versions=deliverables.flatMap(deliverable=>deliverable.versions.map(version=>({...version,deliverableTitle:deliverable.title})))
 useEffect(()=>{if(!anchor)return;setQuery('');setStatus('all');setReleaseFilter('all');setPendingAnchor(anchor)},[anchor,deliverables])
 useEffect(()=>{if(!pendingAnchor)return;const node=globalThis.document?.getElementById(pendingAnchor);if(!node||!panel.current?.contains(node))return;const details=node.querySelector('details');if(details)details.open=true;node.querySelector('summary')?.focus();node.scrollIntoView?.({block:'start'});setPendingAnchor('')},[pendingAnchor,deliverables,query,status,releaseFilter])
 const statuses=[...new Set(versions.map(version=>version.review_status).filter(Boolean))].sort()
 const hasRelease=version=>version.lifecycleEvents?.some(event=>event.event_type==='released')||false
 const filtered=versions.filter(version=>(status==='all'||version.review_status===status)&&(releaseFilter==='all'||hasRelease(version)===(releaseFilter==='recorded'))&&[version.deliverableTitle,version.change_summary,version.id,`v${version.version_number}`].some(value=>String(value||'').toLowerCase().includes(query.trim().toLowerCase())))
 return <section ref={panel} aria-label="Exact-version review and release evidence" className="workspace-card studio-review-evidence">
  <header><div><h2>Exact-version review and release</h2><p>Review decisions, project-manager confirmation and client release are separate recorded facts. A release event does not establish publication or delivery to an external destination.</p></div>{busy||stale?<button type="button" className="workspace-button" disabled>Open review queue</button>:<_Link to="/sphere/my-work?tab=review" className="workspace-button">Open review queue</_Link>}</header>
  {anchor&&!versions.some(version=>'deliverable-version-'+version.id===anchor)&&<p role="status">The requested exact version is not loaded in this project view. No other version is substituted.</p>}
  {stale&&<p role="status">Last loaded evidence. Refresh the project before continuing to the review queue.</p>}
  <div className="studio-review-filters"><label>Search version evidence<input type="search" maxLength={160} value={query} onChange={e=>setQuery(e.target.value)} placeholder="Deliverable, version or change summary"/></label><label>Recorded review status<select value={status} onChange={e=>setStatus(e.target.value)}><option value="all">All statuses</option>{statuses.map(value=><option key={value} value={value}>{label(value)}</option>)}</select></label><label>Client release evidence<select value={releaseFilter} onChange={e=>setReleaseFilter(e.target.value)}><option value="all">All loaded versions</option><option value="recorded">Release event recorded</option><option value="missing">No release event recorded</option></select></label></div>
  <p role="status">{filtered.length} of {versions.length} loaded versions</p>
  {!filtered.length&&<p>{versions.length?'No versions match these filters.':'No deliverable versions recorded.'}</p>}
  <div className="studio-review-versions">{filtered.map(version=>{
   const quality=newest(version.approvals,'decided_at',item=>item.approval_type==='internal_quality'),pm=newest(version.pmConfirmations,'confirmed_at'),release=newest(version.lifecycleEvents,'occurred_at',item=>item.event_type==='released'),client=newest(version.approvals,'decided_at',item=>item.approval_type==='client_approval')
   return <article key={version.id} id={`deliverable-version-${version.id}`}>
    <details><summary><span>{version.deliverableTitle} · v{version.version_number}</span><span className="studio-review-status">{label(version.review_status)}</span><span>{release?'Release event recorded':'No release event recorded'}</span></summary>
     {version.change_summary&&<p>{version.change_summary}</p>}
     <dl className="studio-review-facts">
      <div><dt>Specialist review (latest recorded)</dt><dd>{quality?`${label(quality.decision)} · ${when(quality.decided_at)}`:'No decision recorded'}</dd></div>
      <div><dt>Project-manager confirmation (latest recorded)</dt><dd>{pm?`Recorded · ${when(pm.confirmed_at)}`:'No confirmation recorded'}</dd></div>
      <div><dt>Client release (latest recorded event)</dt><dd>{release?`Released · ${when(release.occurred_at)}`:'No release event recorded'}</dd></div>
      <div><dt>Client decision (latest recorded)</dt><dd>{client?`${label(client.decision)} · ${when(client.decided_at)}`:'No decision recorded'}</dd></div>
     </dl>
     <details className="studio-review-provenance"><summary>Exact version & recorded history</summary><p>Exact version: {version.id}</p><h3>Review decisions</h3>{version.approvals?.length?<ul>{version.approvals.map((event,i)=><li key={event.id||i}>{label(event.approval_type)} · {label(event.decision)} · {when(event.decided_at)}</li>)}</ul>:<p>No decisions loaded for this version.</p>}<h3>Project-manager confirmations</h3>{version.pmConfirmations?.length?<ul>{version.pmConfirmations.map((event,i)=><li key={event.id||i}>{when(event.confirmed_at)}</li>)}</ul>:<p>No confirmations loaded for this version.</p>}<h3>Lifecycle events</h3>{version.lifecycleEvents?.length?<ul>{version.lifecycleEvents.map((event,i)=><li key={event.id||i}>{label(event.event_type)} · {when(event.occurred_at)}</li>)}</ul>:<p>No lifecycle events loaded for this version.</p>}<p>These are recorded lifecycle events, not provider delivery attempts.</p></details>
    </details>
   </article>
  })}</div>
 </section>
}
