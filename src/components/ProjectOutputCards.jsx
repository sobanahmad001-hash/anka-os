import {Link} from 'react-router-dom'

// Presentation of already-authorized exact versions. No latest-version substitution.
export default function ProjectOutputCards({outputs=[],busy=false,onOpenFiles}){
 return <section className="project-output-cards" aria-label="Saved project outputs"><div className="ux-section-heading"><h2>Recent outputs</h2>{onOpenFiles&&<button type="button" className="workspace-button" disabled={busy} onClick={()=>{if(!busy)onOpenFiles()}}>Files & downloads</button>}</div>
 {!outputs.length&&<p className="ux-secondary">No saved project output is recorded in this view.</p>}
 {outputs.slice(0,3).map(a=><article key={a.id} className="ux-output-card"><div className="ux-section-heading"><h3>{a.title||'Saved output'}</h3><span className="ux-saved-label">Saved versions</span></div>{a.versions.slice(0,3).map(v=><div key={v.id} className="ux-version-row"><div><strong>{v.version_number?`Version ${v.version_number}`:'Saved version'}</strong><p className="ux-secondary">{String(a.artifact_type||'Output').replaceAll('_',' ')} · Project source</p></div>{v.path?<Link className="workspace-button workspace-button-primary" aria-disabled={busy} to={v.path} onClick={e=>{if(busy)e.preventDefault()}}>Review {v.version_number?`v${v.version_number}`:'exact version'}</Link>:<span className="ux-secondary">Open its owning Workshop to inspect this version.</span>}<details className="ux-version-provenance"><summary>Source & version</summary><p>Artifact {a.id} · Version {v.id}</p><p>Review and approval remain attached to the exact saved version.</p></details></div>)}{!a.versions.length&&<p className="ux-secondary">No accessible version is loaded for this output.</p>}</article>)}
 </section>
}
