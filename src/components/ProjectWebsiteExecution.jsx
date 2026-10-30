import {useCallback,useEffect,useMemo,useRef,useState} from 'react'
import {useOrganization} from '../context/OrganizationContext.jsx'
import {supabase} from '../lib/supabase.js'
import {websiteBlocks} from '../data/websiteBlocks.js'
import {websiteStaging} from '../data/websiteStagingClient.js'
import {guardWebsiteExecutionRepositories,websiteExecutionAccess,websiteExecutionProgress} from '../data/websiteExecutionController.js'
import WebsiteBlockBuildPanel from './WebsiteBlockBuildPanel.jsx'
import WebsiteStagingPanel from './WebsiteStagingPanel.jsx'
import './projectWebsiteExecution.css'
const actor=async()=>{const {data,error}=await supabase.auth.getUser();if(error)throw error;return data.user?.id}
export default function ProjectWebsiteExecution(props){const organization=useOrganization();return <Execution key={[props.actorId,props.workspace?.project?.id,props.workspace?.engagement?.id,props.conversationId].join(':')} {...props} membership={organization.activeMembership} signal={organization.requestSignal}/>}
export function Execution({workspace,conversationId,actorId,owner,busy=false,membership,signal,onStateChange,onChanged,buildRepository=websiteBlocks,stagingRepository=websiteStaging,readActor=actor}){
 const project=workspace.project,engagement=workspace.engagement,scope={organizationId:project.organization_id,projectId:project.id,engagementId:engagement?.id,actorId}
 const storageKey=['anka:website-journey',actorId,scope.organizationId,scope.projectId,scope.engagementId,conversationId].join(':')
 const [selection,setSelection]=useState(()=>{try{return JSON.parse(sessionStorage.getItem(storageKey)||'null')}catch{return null}})
 const [phase,setPhase]=useState('build'),[build,setBuild]=useState(null),[staging,setStaging]=useState(null),[built,setBuilt]=useState(null),[buildBusy,setBuildBusy]=useState(false),[stageBusy,setStageBusy]=useState(false),[dirty,setDirty]=useState(false),[storageError,setStorageError]=useState(''),[stageRevision,setStageRevision]=useState(0)
 const current=useRef(null),alive=useRef(true),access=websiteExecutionAccess(workspace,membership,owner)
 useEffect(()=>{alive.current=true;return()=>{alive.current=false}},[])
 current.current={...scope,...access,actorId,owner,signal,disabled:busy,draftDirty:dirty}
 const repos=useMemo(()=>guardWebsiteExecutionRepositories({build:buildRepository,staging:stagingRepository,getState:()=>({...current.current,disabled:current.current.disabled||!alive.current}),actor:readActor}),[buildRepository,stagingRepository,readActor])
 const buildChanged=useCallback(v=>setBuild(v),[]),stageChanged=useCallback(v=>setStaging(v),[]),buildLock=useCallback(v=>setBuildBusy(v),[]),stageLock=useCallback(v=>setStageBusy(v),[]),draftChanged=useCallback(v=>setDirty(v),[])
 const resolved=useCallback(job=>{setBuilt(job);setStageRevision(v=>v+1)},[])
 useEffect(()=>{onStateChange?.({busy:buildBusy||stageBusy,dirty});return()=>onStateChange?.({busy:false,dirty:false})},[buildBusy,stageBusy,dirty,onStateChange])
 const progress=websiteExecutionProgress(build,staging,selection?.jobId),locked=busy||buildBusy||stageBusy
 function choose(jobId){if(locked||dirty||!build?.jobs.some(j=>j.id===jobId))return;try{const value={jobId};sessionStorage.setItem(storageKey,JSON.stringify(value));setSelection(value);setStorageError('');setPhase('staging')}catch{setStorageError('Selection recovery is unavailable. Keep this page open; no action was sent.')}}
 if(!engagement?.id||engagement.project_id!==project.id||engagement.organization_id!==project.organization_id)return <p>Website execution requires this project’s canonical engagement.</p>
 return <details className="project-website-execution"><summary>Website execution: package to staging</summary>
 <p>Continue this project one reviewed action at a time. Progress comes from the original build and staging records; no automatic approval or client publication.</p>
 {!access.service&&<p role="status">Review an active Website implementation service in Services & pipeline plan before executing website work.</p>}
 <ol aria-label="Website execution progress"><li>Exact saved Website design → reviewed private package.</li><li>{progress.job?`Selected package: ${progress.job.status}${progress.job.stale_sources?.length?' — source review needed':''}`:selection?.jobId?'Selected package is not in loaded history. Load its history page; no newer package was substituted.':'Choose an exact completed package; none is selected.'}</li><li>{progress.currentTargets.length?'A current staging target is recorded. Review its exact identity before deployment.':'An isolated WordPress staging target still needs setup and explicit binding.'}</li><li>{progress.pending.length?'Recover the original staging request before another deployment.':progress.previews.length?'An exact package preview is recorded for a current target. Review its retained evidence below.':'No verified current-target preview for this exact package is loaded.'}</li></ol>
 {storageError&&<p role="alert">{storageError}</p>}
 <nav aria-label="Website execution steps"><button className="workspace-button" disabled={busy} onClick={()=>setPhase('build')}>1. Review and build</button><button className="workspace-button" disabled={busy} onClick={()=>setPhase('staging')}>2. Stage and review</button></nav>
 {built&&<p>Original package request settled: {built.status}. {built.status==='complete'&&<button className="workspace-button" disabled={locked||dirty} onClick={()=>choose(built.id)}>Use this exact built package</button>}</p>}
 <label>Package tracked in this conversation<select className="workspace-input" value={selection?.jobId||''} disabled={locked||dirty} onChange={e=>choose(e.target.value)}><option value="">Choose an exact saved package</option>{selection?.jobId&&!build?.jobs.some(j=>j.id===selection.jobId)&&<option value={selection.jobId}>Retained selection — load original history</option>}{(build?.jobs||[]).map(j=><option key={j.id} value={j.id}>{j.requested_at} · {j.status} · {j.page_key||j.page_id}</option>)}</select></label>
 <div hidden={phase!=='build'}><WebsiteBlockBuildPanel {...scope} actorId={actorId} signal={signal} repository={repos.build} canBuild={access.canExecute} externalBusy={busy||stageBusy||dirty} onNavigationBusyChange={buildLock} onWorkspaceChange={buildChanged} onResolvedJob={resolved}/></div>
 <div hidden={phase!=='staging'}><WebsiteStagingPanel {...scope} actorId={actorId} signal={signal} repository={repos.staging} canStage={access.canExecute} canBind={access.canBind} externalBusy={busy||buildBusy} onNavigationBusyChange={stageLock} onDraftDirtyChange={draftChanged} onWorkspaceChange={stageChanged} onQaSaved={onChanged} refreshRevision={stageRevision} suggestedJobId={progress.packageReady?selection?.jobId:null}/></div>
 <p>Before package building: review project scope and registered pages, prepare and approve exact Content versions, explicitly hand off to Design, then save the exact Website layout and site-system version in Design Workshop. This controller continues from that saved design. Functional forms, search, integrations and client publication need their own validated actions.</p>
 </details>
}
