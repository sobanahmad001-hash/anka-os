import {useCallback,useEffect,useRef,useState} from 'react'
import _ProjectWebsitePagesPanel from './ProjectWebsitePagesPanel.jsx'
import _ProjectCampaignPlanningPanel from './ProjectCampaignPlanningPanel.jsx'
import _ProjectReportingBindingsPanel from './ProjectReportingBindingsPanel.jsx'
export default function ProjectScopedPipelineView({workspace,organizationId,membership,signal,kind,resources=false,initialGroupId='',onOpenResources,onNavigationBusyChange}){
 const [groupId,setGroupId]=useState(initialGroupId),[blocked,setBlocked]=useState(false),selected=useRef(groupId);selected.current=groupId
 const groups=(workspace.pipelineGroups || []).filter(row=>row.organization_id===organizationId&&row.project_id===workspace.project.id&&row.engagement_id===workspace.engagement?.id&&(!kind||row.kind===kind)&&['website','marketing'].includes(row.kind))
 const alive=useRef(true),latest=useRef(null);latest.current={blocked,groupId,groups,signal}
 useEffect(()=>{alive.current=true;return ()=>{alive.current=false}},[])
 const group=groups.find(row=>row.id===groupId),title=resources?'Resources & Connections':kind==='website'?'Website work':'Marketing work'
 const owner=useRef(groupId);owner.current=groupId
 const reportBusy=useCallback(value=>{if(alive.current&&!latest.current.signal?.aborted&&owner.current===groupId){latest.current.blocked=Boolean(value);setBlocked(Boolean(value));onNavigationBusyChange?.(Boolean(value))}},[groupId,onNavigationBusyChange])
 if(signal?.aborted)return <p role="status">Current project access is being rechecked.</p>
 if(!workspace.engagement)return <p role="status">{title} unavailable: this project has no engagement extension. Existing Project Tasks remain in All work.</p>
 if(['unavailable','limited'].includes(workspace.pipelineGroupsState))return <p role="alert">{title} unavailable: current pipeline identities {workspace.pipelineGroupsState==='limited'?'exceed this bounded view':'could not be loaded'}. Refresh the project; existing work and history remain.</p>
 return <section aria-label={title} className="space-y-4">
  <h2 className="text-lg font-semibold">{title}</h2>
  <p className="text-sm text-[var(--anka-muted)]">Choose an existing exact pipeline. Service scope, permissions, assignments and approvals remain in their existing workflows.</p>
  <label className="block text-xs">Project pipeline<select aria-label={title+' pipeline'} className="mt-2 w-full rounded-lg border border-[var(--anka-line)] bg-[var(--anka-surface)] px-3 py-2 text-sm" value={group?.id||''} disabled={blocked} onChange={event=>{if(!alive.current||latest.current.blocked||latest.current.signal?.aborted||(event.target.value!==''&&!latest.current.groups.some(row=>row.id===event.target.value)))return;selected.current=event.target.value;setGroupId(event.target.value)}}><option value="">Choose an exact existing pipeline</option>{groups.map(row=><option key={row.id} value={row.id}>{row.name} · {row.kind==='website'?'Website':'Marketing'}</option>)}</select></label>
  {!groups.length&&<p role="status" className="text-sm text-[var(--anka-muted)]">No existing {kind||'Website or Marketing'} pipeline is available. Use Services & Pipelines to review scope; Legacy work remains in All work.</p>}
  {initialGroupId&&!group&&<p role="status" className="text-sm text-[var(--anka-muted)]">The requested pipeline is unavailable in this project. Choose a current exact pipeline.</p>}
  {blocked&&<p role="status" className="text-xs text-[var(--anka-muted)]">Finish or discard the current draft, or reconcile its original operation, before changing the Project view.</p>}
  {group&&!resources&&<button type="button" className="workspace-button" disabled={blocked} onClick={()=>{if(alive.current&&!latest.current.blocked&&!latest.current.signal?.aborted&&selected.current===group.id&&latest.current.groups.some(row=>row.id===group.id))onOpenResources?.(group.id)}}>Resources & Connections</button>}
  {group&&resources&&<_ProjectReportingBindingsPanel key={'resources:'+group.id} organizationId={organizationId} engagement={workspace.engagement} group={group} membership={membership} signal={signal} onNavigationBusyChange={reportBusy}/>}
  {group&&!resources&&group.kind==='website'&&<_ProjectWebsitePagesPanel key={'website:'+group.id} organizationId={organizationId} engagement={workspace.engagement} group={group} membership={membership} signal={signal} onNavigationBusyChange={reportBusy}/>}
  {group&&!resources&&group.kind==='marketing'&&<_ProjectCampaignPlanningPanel key={'marketing:'+group.id} organizationId={organizationId} engagement={workspace.engagement} group={group} membership={membership} signal={signal} onNavigationBusyChange={reportBusy}/>}
 </section>
}
