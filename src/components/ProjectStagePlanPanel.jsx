import {useEffect,useMemo,useRef,useState} from 'react'
import {supabase} from '../lib/supabase.js'
import {createProjectStagePlanRepository} from '../data/projectStagePlanRepository.js'
import {projectStagePlan,PROJECT_STAGE_PHASES} from '../data/projectStagePlan.js'
import _FoundationCheckpointPanel from './FoundationCheckpointPanel.jsx'
import ProjectStagePlan from './ProjectStagePlan.jsx'
const kinds={branding:['engagement'],website:['website_page'],marketing:['campaign_asset','recurring_occurrence']}
const kindLabel={engagement:'Shared foundation',website_page:'Website pages',campaign_asset:'Campaign assets',recurring_occurrence:'Recurring cycles'}
const bindingSignature=rows=>JSON.stringify([...rows].sort((a,b)=>(a.group_id+':'+a.step_key).localeCompare(b.group_id+':'+b.step_key)))
const identity=p=>[p.kind,p.id,p.architecture_version_id||''].join(':')
export default function ProjectStagePlanPanel(props){
 const {scope}=props
 const openSetup=props.onBootstrapSetup||props.onManualSetup
 if(!scope?.engagementId)return <section aria-label="Project stage plan"><p>No saved project plan is connected yet.</p>{props.onOpenBrief&&<ProjectStagePlan onOpenBrief={props.onOpenBrief} busy={props.busy}/>}{openSetup&&<button type="button" className="workspace-button" disabled={props.busy} onClick={openSetup}>Open project setup</button>}</section>
 return <StagePlanSession key={[props.actorId,scope.organizationId,scope.projectId,scope.engagementId].join(':')} {...props}/>
}
function StagePlanSession({scope,actorId,signal,repository:providedRepository,busy:externalBusy=false,onContinue,onContinueFoundationPositioning,foundationRepository,onOpenBrief,onBootstrapSetup,onManualSetup,onOpenWork,onOpenOutput,onStateChange,onAccessError,mutationTimeoutMs=15000}){
 const repository=useMemo(()=>providedRepository||createProjectStagePlanRepository(supabase),[providedRepository])
 const scopeKey=[actorId,scope.organizationId,scope.projectId,scope.engagementId].join(':')
 const storageKey='anka-stage-binding:'+scopeKey
 const [header,setHeader]=useState(null),[units,setUnits]=useState([]),[groupId,setGroupId]=useState(''),[kind,setKind]=useState(''),[page,setPage]=useState(null)
 const [loading,setLoading]=useState(false),[applying,setApplying]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState(''),[bindings,setBindings]=useState([]),[review,setReview]=useState(null)
 const [pending,setPending]=useState(()=>{try{const row=JSON.parse(sessionStorage.getItem(storageKey));return row?.requestId?row:null}catch{return null}})
 const pipelineSelect=useRef(null),mappingSection=useRef(null)
 const [mappingOpen,setMappingOpen]=useState(false)
 const life=useRef(null),generation=useRef(0),lock=useRef(false),callbacks=useRef({onStateChange,onAccessError});callbacks.current={onStateChange,onAccessError}
 const live=useRef({});live.current={review,pending,header,bindings}
 const dirty=Boolean(header)&&bindingSignature(bindings)!==bindingSignature(header.bindings||[])
 useEffect(()=>{callbacks.current.onStateChange?.({busy:applying,dirty:dirty&&!pending});return()=>callbacks.current.onStateChange?.({busy:false,dirty:false})},[applying,dirty,pending])
 const active=token=>life.current&&!life.current.signal.aborted&&!signal?.aborted&&token===generation.current
 const options=()=>({signal:life.current?.signal})
 const report=cause=>{setError(cause.message||'Project plan is unavailable.');callbacks.current.onAccessError?.(cause)}
 async function refreshHeader(){const next=await repository.read(scope,options());return next}
 function acceptHeader(next){setHeader(next);setBindings(next.bindings||[]);setReview(null);setUnits([]);setPage(null);setGroupId('');setKind('')}
 useEffect(()=>{
  const controller=new AbortController();life.current=controller;const token=++generation.current;const abort=()=>controller.abort();signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)controller.abort()
  setHeader(null);setUnits([]);setReview(null);setLoading(true);lock.current=true
  repository.read(scope,{signal:controller.signal}).then(next=>{if(active(token)){acceptHeader(next);setError('')}}).catch(cause=>{if(active(token))report(cause)}).finally(()=>{if(active(token)){setLoading(false);lock.current=false}})
  return()=>{controller.abort();generation.current++;lock.current=false;signal?.removeEventListener('abort',abort)}
 // Exact session is keyed by scope; a new access signal invalidates every response.
 // eslint-disable-next-line react-hooks/exhaustive-deps
 },[repository,signal,scopeKey])
 async function readAction(action){if(lock.current||externalBusy)return;lock.current=true;setLoading(true);setError('');const token=generation.current;try{await action(token)}catch(cause){if(active(token))report(cause)}finally{if(active(token)){lock.current=false;setLoading(false)}}}
 const group=header?.groups.find(g=>g.id===groupId)
 const blocked=externalBusy||loading||applying||Boolean(pending)
 async function chooseGroup(id){const next=header.groups.find(g=>g.id===id);setGroupId(id);setKind(next?kinds[next.kind]?.[0]||'':'');setPage(null)}
 async function list(offset=0){await readAction(async token=>{const result=await repository.listPartitions(scope,{planId:header.plan_id,groupId,kind,offset,limit:25,...options()});if(active(token))setPage(result)})}
 async function loadPartition(partition){await readAction(async token=>{const result=await repository.readPartition(scope,{planId:header.plan_id,groupId,partition,...options()});if(!active(token))return;setUnits(old=>[...old.filter(u=>u.group_id!==groupId||identity(u.partition)!==identity(partition)),result])})}
 function editBinding(g,step,phase){if(lock.current||externalBusy||live.current.pending||g.configuration_current!==true)return;live.current.review=null;setReview(null);setBindings(old=>{const rest=old.filter(b=>b.group_id!==g.id||b.step_key!==step.key);return phase?[...rest,{group_id:g.id,publication_id:g.publication_id,step_key:step.key,phase}]:rest})}
 async function reviewMapping(){if(live.current.pending)return;await readAction(async token=>{const result=await repository.reviewBindings(scope,{planId:header.plan_id,bindings,...options()});if(active(token)){setReview(result);setNotice(result.changed?'Review the mapping below, then apply it.':'No mapping changes to apply.')}})}
 async function applyMapping(){
  if(lock.current||externalBusy||live.current.pending||review!==live.current.review||!review?.changed)return
  const requestId=crypto.randomUUID(),record={requestId,planId:header.plan_id};try{sessionStorage.setItem(storageKey,JSON.stringify(record))}catch{setError('Mapping recovery could not be saved in this tab. No change was sent.');return}
  lock.current=true;live.current.pending=record;setApplying(true);setPending(record);setError('');setNotice('');const token=generation.current;let timer
  try{
   const request=repository.applyBindings(scope,{requestId,review,confirmed:true,...options()})
   const result=await Promise.race([request,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Mapping outcome is unknown. Check the original save; it will not be sent again.')),mutationTimeoutMs)})])
   if(!active(token))return
   if(result.request_id!==requestId)throw Error('Mapping receipt differs. Check the original save.')
   sessionStorage.removeItem(storageKey);live.current.pending=null;live.current.review=null;setReview(null);setPending(null);const next=await refreshHeader();if(active(token)){acceptHeader(next);setNotice('Stage mapping saved. Existing work and history are retained.')}
  }catch(cause){if(active(token)){if(cause.knownRollback){sessionStorage.removeItem(storageKey);live.current.pending=null;live.current.review=null;setReview(null);setPending(null);setReview(null)}report(cause)}}finally{clearTimeout(timer);if(active(token)){lock.current=false;setApplying(false)}}
 }
 async function recover(){if(!pending)return;await readAction(async token=>{const result=await repository.recoverBindings(scope,{requestId:pending.requestId,...options()});if(!active(token))return;if(result.status!=='applied'){setNotice('The original save is not recorded yet. No request was repeated.');return}sessionStorage.removeItem(storageKey);live.current.pending=null;live.current.review=null;setReview(null);setPending(null);const next=await refreshHeader();if(active(token)){acceptHeader(next);setNotice('Original stage mapping recovered. No save was repeated.')}})}
 function getStageAction(track,stage){
  if(!header)return null
  if(stage.configured)return {label:'Choose a saved pipeline item',open:()=>pipelineSelect.current?.focus()}
  const canMap=header.can_manage&&header.groups.some(group=>group.kind===track.id&&group.configuration_current===true&&group.steps?.length)
  if(canMap&&!stage.configurationUnavailable)return {label:'Map saved pipeline steps',open:()=>{setMappingOpen(true);globalThis.requestAnimationFrame?.(()=>mappingSection.current?.focus())}}
  const open=onBootstrapSetup||onManualSetup
  return open?{label:'Open project setup',open}:null
 }
 const plan=useMemo(()=>header?projectStagePlan(header,units):{state:'unavailable'},[header,units])
 return <section className="stage-plan-container" aria-label="Saved project stage plan">
  {error&&<p role="alert" className="stage-plan-notice">{error}</p>}{notice&&<p role="status" className="stage-plan-notice">{notice}</p>}
  {pending&&<div className="stage-plan-notice"><p>A stage-mapping save needs its original receipt checked.</p><button type="button" className="workspace-button" disabled={externalBusy||loading||applying} onClick={recover}>Check original mapping save</button></div>}
  <div className="stage-plan-controls"><button type="button" className="workspace-button" disabled={blocked||dirty} onClick={()=>readAction(async token=>{const next=await refreshHeader();if(active(token))acceptHeader(next)})}>Refresh plan</button>{loading&&<span role="status">Reading saved plan…</span>}{header?.can_manage&&<button type="button" className="workspace-button" disabled={externalBusy||applying||(!mappingOpen&&!header.groups.some(g=>g.configuration_current===true&&g.steps?.length))} aria-expanded={mappingOpen} onClick={()=>setMappingOpen(x=>!x)}>Map stages</button>}</div>
  {mappingOpen&&header?.can_manage&&<section ref={mappingSection} tabIndex={-1} className="stage-plan-mapping" aria-label="Stage mapping"><h3>Map saved pipeline steps to stages</h3><p>Choose where each saved step belongs. Quantities, work, outputs and history remain in their existing records.</p>{header.groups.map(g=><fieldset key={g.id} disabled={blocked||g.configuration_current!==true}><legend>{g.name||g.kind}</legend>{g.configuration_current!==true&&<p>Current configuration is unavailable. Review this pipeline in manual setup.</p>}{(g.steps||[]).map(step=><label key={step.key}>{step.label||step.key}{Number.isInteger(step.planned_quantity)&&<small> · {step.planned_quantity} planned</small>}<select aria-label={`Phase for ${g.id}:${step.key}`} value={bindings.find(b=>b.group_id===g.id&&b.step_key===step.key)?.phase||''} onChange={e=>editBinding(g,step,e.target.value)}><option value="">Not configured</option>{PROJECT_STAGE_PHASES.filter(p=>p.track===g.kind).map(p=><option key={p.key} value={p.key}>{p.label}</option>)}</select></label>)}</fieldset>)}<div className="stage-plan-controls"><button type="button" className="workspace-button" disabled={blocked||!dirty} onClick={reviewMapping}>Review stage mapping</button><button type="button" className="workspace-button" disabled={blocked||!dirty} onClick={()=>{live.current.review=null;setBindings(header.bindings||[]);setReview(null)}}>Discard mapping edits</button></div>{review&&<div aria-label="Reviewed stage mapping"><h4>Reviewed mapping</h4><ul>{review.bindings.map(b=><li key={b.group_id+':'+b.step_key}>{header.groups.find(g=>g.id===b.group_id)?.steps.find(s=>s.key===b.step_key)?.label||b.step_key} → {PROJECT_STAGE_PHASES.find(p=>p.key===b.phase)?.label}</li>)}</ul><button type="button" className="workspace-button" disabled={blocked||!review.changed} onClick={applyMapping}>Apply reviewed mapping</button></div>}</section>}
  {header?.groups.length>0&&<div className="stage-plan-partitions"><label>Saved pipeline<select ref={pipelineSelect} aria-label="Saved pipeline" value={groupId} disabled={blocked||dirty} onChange={e=>chooseGroup(e.target.value)}><option value="">Choose a pipeline</option>{header.groups.map(g=><option key={g.id} value={g.id}>{g.name||g.kind}</option>)}</select></label>{group&&<><label>Progress for<select aria-label="Progress for" value={kind} disabled={blocked||dirty} onChange={e=>{setKind(e.target.value);setPage(null)}}>{(kinds[group.kind]||[]).map(k=><option key={k} value={k}>{kindLabel[k]}</option>)}</select></label><button type="button" className="workspace-button" disabled={blocked||dirty||!kind||group.configuration_current!==true} onClick={()=>list(0)}>Browse saved items</button></>}{page&&<div><p>{page.items.length?page.offset+1:0}–{page.offset+page.items.length} of {page.total} registered items. Progress below covers only explicitly loaded items.</p><ul>{page.items.map(item=><li key={identity(item.partition)}><button type="button" className="workspace-button" disabled={blocked||dirty} onClick={()=>loadPartition(item.partition)}>Load progress: {item.title||item.partition.kind}</button></li>)}</ul><div className="stage-plan-controls"><button type="button" disabled={blocked||page.offset===0} onClick={()=>list(Math.max(0,page.offset-page.limit))}>Previous items</button><button type="button" disabled={blocked||!page.has_more} onClick={()=>list(page.offset+page.limit)}>Next items</button></div></div>}</div>}
  <ProjectStagePlan foundationAction={stage=>header&&stage.configured===false&&['branding.brief','branding.positioning'].includes(stage.id)?<_FoundationCheckpointPanel key={stage.id} scope={{...scope,actorId}} phase={stage.id} signal={signal} busy={blocked||dirty} canManage={header.can_manage===true} repository={foundationRepository} onContinue={onContinueFoundationPositioning}/>:null} onOpenBrief={onOpenBrief} getStageAction={getStageAction} plan={plan} busy={blocked||dirty} onContinue={onContinue} onManualSetup={onManualSetup} onOpenWork={onOpenWork} onOpenOutput={onOpenOutput}/>
 </section>
}
