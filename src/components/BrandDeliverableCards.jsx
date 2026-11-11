import './brandCards.css'
import {useEffect,useRef,useState} from 'react'
import BrandingLibrary from './BrandingLibrary.jsx'
import {brandKinds,brandingServiceSlugs} from '../data/manualBranding.js'
import BrandVersionReview from './BrandVersionReview.jsx'
import {Link} from 'react-router-dom'
import {supabase} from '../lib/supabase.js'
import {delivery} from '../data/delivery.js'

const stages={brief:'Brief',in_progress:'In progress',in_review:'In review',handoff:'Handoff',done:'Done'}

function figma(value){
 try{const url=new URL(value);return url.protocol==='https:'&&!url.username&&!url.password&&!url.port&&['figma.com','www.figma.com'].includes(url.hostname)&&/^\/(design|file|proto)\/[\w-]+/.test(url.pathname)?url.href:''}catch{return ''}
}
function newForm(){return {brandKind:'',stage:'brief',next:'',brief:'',owner:'',evidence:'',title:'',workstream:'',version:'',sourceVersion:'',sourceFile:''}}
export default function BrandDeliverableCards({workspace,actorId,onRefresh}){
 const {project,engagement}=workspace
 const members=workspace.teamMembers.map(member=>({
  ...member,
  name:member.name && member.name!=='Unassigned' ? member.name : 'Team member · '+member.id.slice(0,8)
 }))
 const services=workspace.services.filter(s=>['planned','active'].includes(s.status)&&brandingServiceSlugs.has(s.service_catalog?.slug))
 const [cards,setCards]=useState(null),[identity,setIdentity]=useState(''),[service,setService]=useState(''),[form,setForm]=useState(newForm)
 const [error,setError]=useState(''),[busy,setBusy]=useState(false),[revision,setRevision]=useState(null)
 const [source,setSource]=useState(''),[file,setFile]=useState(null),[change,setChange]=useState('')
 const [download,setDownload]=useState(null),[refresh,setRefresh]=useState(0)
 const [supplied,setSupplied]=useState([])
 useEffect(()=>{
  let current=true
  supabase.from('brand_supplied_assets').select('file_id,owner_statement,files!inner(file_name,archived_at,storage_path)')
   .eq('project_id',project.id).eq('organization_id',project.organization_id).is('files.archived_at',null)
   .then(({data,error:e})=>{if(current){if(e)setError(e.message);else setSupplied(data)}})
  return()=>{current=false}
 },[project.id,project.organization_id,refresh])
 const uploadInput=useRef(null)
 const freshId=useRef(crypto.randomUUID()),flight=useRef(false)
 const card=cards?.find(c=>c.deliverable_id===identity),item=workspace.deliverables.find(d=>d.id===identity)
 useEffect(()=>{let current=true;setCards(null)
  supabase.from('brand_deliverable_cards').select('*').eq('project_id',project.id).eq('organization_id',project.organization_id).then(({data,error:e})=>{
    if(current){if(e)setError(e.message);else setCards(data)}
  });return()=>{current=false}
 },[project.id,project.organization_id,refresh])
 const department=services.find(s=>s.id===service)?.service_catalog.department_id
 function open(id,kind){
  const d=workspace.deliverables.find(row=>row.id===id),c=cards?.find(row=>row.deliverable_id===id),w=workspace.engagementWorkItems.find(row=>row.id===c?.work_item_id)
  const existingDept=workspace.workstreams.find(stream=>stream.id===d?.workstream_id)?.department_id
  const preferredDept=kind&&['brand_statement','messaging_guide','tone_of_voice'].includes(kind.key)?'content':'design'
  setIdentity(id);setRevision(w?.row_version??null);setService(c?.engagement_service_id||services.find(s=>s.service_catalog.department_id===(existingDept||preferredDept))?.id||services[0]?.id||'')
  setForm({...newForm(),brandKind:c?.brand_kind||kind?.key||'',title:d?.title||kind?.example||kind?.label||'',brief:d?.description||'',workstream:d?.workstream_id||'',stage:c?.stage||'brief',next:c?.next_action||'',evidence:c?.intake_evidence||'',owner:w?.assignee_id||d?.owner_id||'',version:c?.final_version_id||'',sourceVersion:c?.source_version_id||'',sourceFile:c?.supplied_file_id||''})
  if(uploadInput.current)uploadInput.current.value=''
  freshId.current=crypto.randomUUID();setSource('');setFile(null);setChange('');setDownload('');setError('')
 }
 function field(key,value){setForm(old=>({...old,[key]:value}));setDownload('')}
 async function run(fn){if(flight.current)return;flight.current=true;setBusy(true);setError('')
  try{await fn()}catch(e){setError(e.message)}finally{flight.current=false;setBusy(false)}}
 async function save(){
  const id=identity==='new'?freshId.current:identity
  const {error:e}=await supabase.functions.invoke('work-items',{body:{action:'save_brand_deliverable_card',organizationId:project.organization_id,projectId:project.id,serviceId:service,deliverableId:id,expectedRevision:revision,plan:{...form,owner:form.owner||null,version:form.version||null}}})
  if(e)throw e
  await onRefresh();setRefresh(x=>x+1);setIdentity('')
 }
 async function addVersion(){
  if(!item||(!file&&!figma(source))||(file&&source))throw Error('Choose one project file upload or a Figma link.')
  await delivery.createDeliverableVersion({organizationId:project.organization_id,projectId:project.id,deliverableId:item.id,title:item.title,changeSummary:change,file,previewUrl:figma(source),clientApprovalRequired:false},actorId)
  if(uploadInput.current)uploadInput.current.value=''
  setSource('');setFile(null);setChange('');await onRefresh()
 }
 const pinned=item?.versions.find(v=>v.id===card?.final_version_id)
 const sources=workspace.deliverables.filter(d=>d.id!==identity).flatMap(d=>d.versions.filter(v=>
   !v.withdrawn_at && (v.file_id||figma(v.preview_metadata?.preview_url)) &&
   (['client_approved','delivered_published'].includes(v.review_status)||(!v.client_approval_required&&['ready_for_client_review','client_reviewing'].includes(v.review_status))) &&
   v.approvals.some(a=>a.decision==='approved'&&a.approval_type===(v.client_approval_required?'client_approval':'internal_quality'))
 ).map(v=>({deliverable:d,version:v})))
 const selectedSource=sources.find(s=>s.version.id===card?.source_version_id)
 async function getFile(version,deliverableId){
  const {data,error:e}=await supabase.from('files').select('storage_path,storage_bucket').eq('id',version.file_id).eq('organization_id',project.organization_id).eq('project_id',project.id).is('archived_at',null).single()
  if(e)throw e
  if(data.storage_bucket!=='sphere-deliverables'||!data.storage_path.startsWith(project.id+'/'+deliverableId+'/'))throw Error('Project file unavailable.')
  const signed=await supabase.storage.from(data.storage_bucket).createSignedUrl(data.storage_path, sixtySeconds)
  if(signed.error)throw signed.error
  setDownload({id:version.id,url:signed.data.signedUrl})
 }
 const library=<BrandingLibrary workspace={workspace} refresh={refresh} onOpen={open} onCreate={engagement&&services.length?kind=>open('new',kind):null}/>
 if(!engagement||!services.length)return <>{library}<p>Select a Branding service in Scope &amp; Services to create work.</p></>
 return <>{library}<section className="workspace-card brand-card p-4" aria-label="Branding and Design cards"><h2>Branding work cards</h2>
 {error&&<p role="alert">{error}</p>}
 {cards&&<fieldset disabled={busy}><label>Deliverable card<select aria-label="Deliverable card" value={identity} onChange={e=>open(e.target.value)}><option value="">Choose a card</option><option value="new">Create a deliverable</option>{workspace.deliverables.filter(d=>workspace.workstreams.some(w=>w.id===d.workstream_id&&['design','content'].includes(w.department_id))).map(d=><option key={d.id} value={d.id}>{d.title}{cards.some(c=>c.deliverable_id===d.id)?'':' · existing deliverable'}</option>)}</select></label>
 {identity&&<><label>Service<select aria-label="Service" value={service} disabled={!!card} onChange={e=>{setService(e.target.value);field('workstream','')}}>{services.map(s=><option key={s.id} value={s.id}>{s.service_catalog.name}</option>)}</select></label>
 <label>Branding asset type<select value={form.brandKind} onChange={e=>field('brandKind',e.target.value)}><option value="">Unclassified</option>{brandKinds.map(k=><option key={k.key} value={k.key}>{k.label}</option>)}</select></label>
 {!item&&<><label>Deliverable name<input maxLength={200} value={form.title} onChange={e=>field('title',e.target.value)}/></label><label>Workstream<select aria-label="Workstream" value={form.workstream} onChange={e=>field('workstream',e.target.value)}><option value="">Choose workstream</option>{workspace.workstreams.filter(w=>w.department_id===department).map(w=><option key={w.id} value={w.id}>{w.name}</option>)}</select></label></>}
 <label>Brief<textarea readOnly={!!item} maxLength={4000} value={form.brief} onChange={e=>field('brief',e.target.value)}/></label>
 <label>Owner<select aria-label="Owner" value={form.owner} onChange={e=>field('owner',e.target.value)}><option value="">Unassigned</option>{members.map(m=><option key={m.id} value={m.id}>{m.name}</option>)}</select></label>
 <label>Stage<select aria-label="Stage" value={form.stage} onChange={e=>field('stage',e.target.value)}>{Object.entries(stages).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select></label>
 {(!card&&form.stage!=='brief'||form.evidence)&&<label>Evidence for starting stage<textarea readOnly={!!card} maxLength={4000} value={form.evidence} onChange={e=>field('evidence',e.target.value)}/></label>}
 <label>Next action<input maxLength={1000} value={form.next} onChange={e=>field('next',e.target.value)}/></label>
 {['handoff','done'].includes(form.stage)&&<label>Approved final version<select aria-label="Approved final version" value={form.version} onChange={e=>field('version',e.target.value)}><option value="">Choose approved version</option>{item?.versions.filter(v=>v.file_id||figma(v.preview_metadata?.preview_url)).filter(v=>['client_approved','delivered_published'].includes(v.review_status)||!v.client_approval_required&&v.review_status==='ready_for_client_review').map(v=><option key={v.id} value={v.id}>v{v.version_number} · {v.title}</option>)}</select></label>}
 <label>Project asset source<select aria-label="Project asset source" value={form.sourceFile?'file:'+form.sourceFile:form.sourceVersion} onChange={e=>{
   const id=e.target.value
   setForm(old=>({...old,sourceFile:id.startsWith('file:')?id.slice(5):'',sourceVersion:id.startsWith('file:')?'':id}))
   setDownload(null)
 }}>
 <option value="">Choose a source if needed</option>{supplied.map(s=><option key={s.file_id} value={'file:'+s.file_id}>{s.files.file_name} · owner-reported history</option>)}{sources.map(s=><option key={s.version.id} value={s.version.id}>{s.deliverable.title} · v{s.version.version_number}</option>)}</select></label>
 {card?.supplied_file_id&&supplied.filter(s=>s.file_id===card.supplied_file_id).map(s=><section key={s.file_id}><p>{s.files.file_name} · Owner-reported history: {s.owner_statement}</p>
 <button onClick={()=>run(async()=>{const result=await supabase.storage.from('sphere-deliverables').createSignedUrl(s.files.storage_path,60);if(result.error)throw result.error;setDownload({id:s.file_id,url:result.data.signedUrl})})}>Retrieve supplied source</button>
 {download?.id===s.file_id&&<a href={download.url}>Open supplied source</a>}</section>)}
 {selectedSource&&<p>Saved source: {selectedSource.deliverable.title} · v{selectedSource.version.version_number} {selectedSource.version.file_id
 ? <button onClick={()=>run(()=>getFile(selectedSource.version,selectedSource.deliverable.id))}>Retrieve source file</button>
 : <a href={figma(selectedSource.version.preview_metadata?.preview_url)} target="_blank" rel="noreferrer">Open source in Figma</a>}
 {download?.id===selectedSource.version.id&&<a href={download.url}>Open source file</a>}</p>}
 <button className="workspace-button" onClick={()=>run(save)}>Save card</button>
 {card&&item&&<><h3>Versions and feedback</h3>{item.versions.map(v=><div key={v.id}><Link to={'?tab=reviews#deliverable-version-'+v.id}>v{v.version_number} · {v.review_status.replaceAll('_',' ')}</Link><p>{v.change_summary}</p>{v.approvals.map(a=><p key={a.id}>{a.decision} · {a.rationale}</p>)}<BrandVersionReview organizationId={project.organization_id} version={v} members={members} run={run} refresh={onRefresh}/></div>)}<Link to="/sphere/my-work?tab=review">Open governed review queue</Link>
 <label>Figma source<input type="url" value={source} onChange={e=>setSource(e.target.value)}/></label><label>Or attach file<input type="file" ref={uploadInput} onChange={e=>setFile(e.target.files[0]||null)}/></label>
 <label>Version notes<textarea value={change} onChange={e=>setChange(e.target.value)}/></label>
 <button className="workspace-button" disabled={!file&&!figma(source)} onClick={()=>run(addVersion)}>Save new version</button>
 {pinned&&<p>Final asset · v{pinned.version_number} {figma(pinned.preview_metadata?.preview_url)?<a href={figma(pinned.preview_metadata.preview_url)} target="_blank" rel="noreferrer">Open Figma source</a>:pinned.file_id&&<button onClick={()=>run(()=>getFile(pinned,item.id))}>Retrieve approved file</button>}{download?.id===pinned.id&&<a href={download.url} rel="noreferrer">Open file</a>}</p>}</>}
 </>}</fieldset>}
 </section></>
}
const sixtySeconds=60
