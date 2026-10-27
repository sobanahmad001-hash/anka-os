import {useAuth} from '../context/AuthContext.jsx'
import ProjectSetupPanel from './ProjectSetupPanel.jsx'
import { useCallback, useRef, useState } from 'react'
import ProjectServiceScopePanel from '../apps/ProjectServiceScopePanel.jsx'
import ProjectPipelineConfigurationPanel from './ProjectPipelineConfigurationPanel.jsx'

export default function ProjectDeliverySetup(props) {
  return <DeliverySetup key={[props.organizationId, props.workspace.project.id, props.scopeRevision].join(':')} {...props} />
}

function DeliverySetup({ workspace, organizationId, membership, scopeRevision, requestSignal, onChanged, onAccessError, onOpen, onNavigationBusyChange }) {
  const {user}=useAuth()
  const [intent, setIntent] = useState('')
  const [step, setStep] = useState('services')
  const [busy, setBusy] = useState(false)
  const [pipelineOpened, setPipelineOpened] = useState(false)
  const busySlots = useRef({ services: false, pipelines: false, setup:false })
  const reportBusy = useCallback((slot, value) => { busySlots.current[slot] = Boolean(value); const blocked = Object.values(busySlots.current).some(Boolean); setBusy(blocked); onNavigationBusyChange?.(blocked) }, [onNavigationBusyChange])
  const setupBusy=useCallback(value=>reportBusy('setup',value),[reportBusy])
  const serviceBusy = useCallback(value => reportBusy('services', value), [reportBusy])
  const pipelineBusy = useCallback(value => reportBusy('pipelines', value), [reportBusy])
  const changeStep = id => { if (Object.values(busySlots.current).some(Boolean)) return; if (id==='pipelines') setPipelineOpened(true); setStep(id) }

  const groups = (workspace.pipelineGroups || []).filter(group => group.organization_id === organizationId && group.project_id === workspace.project.id && group.engagement_id === workspace.engagement?.id && ['website', 'marketing'].includes(group.kind))
  return <section aria-label="Project delivery setup" className="space-y-5">
    <div className="workspace-card p-4">
      <h2 className="font-semibold">Set up project delivery</h2>
      <p className="mt-1 text-sm text-[var(--anka-muted)]">Select services and review the assembled pipeline plan together below. Optional stage configuration and starting work keep their existing reviews.</p>
      <details><summary>Advanced visual pipeline focus</summary>
      <fieldset disabled={busy} className="mt-4 flex flex-wrap gap-3"><legend className="mb-2 text-sm font-medium">Delivery focus</legend>{[['website','Website'],['marketing','Marketing'],['both','Website & Marketing']].map(([id,label]) => <label key={id} className="flex items-center gap-2 rounded-lg border border-[var(--anka-line)] px-3 py-2 text-sm"><input type="radio" name="project-delivery-focus" value={id} checked={intent===id} onChange={()=>{if(!Object.values(busySlots.current).some(Boolean))setIntent(id)}} />{label}</label>)}</fieldset>
      {intent==='both' && <p className="mt-3 text-sm text-[var(--anka-muted)]">Create or choose a Website pipeline and a Marketing pipeline separately. Each retains its own stages, revisions, activation and history.</p>}
      </details>
      <nav aria-label="Delivery setup steps" className="mt-4 flex flex-wrap gap-2">{[['services','1. Select services'],['pipelines','2. Review pipelines & stages'],['work','3. Open work']].map(([id,label])=><button type="button" key={id} disabled={busy} aria-current={step===id?'step':undefined} className={step===id?'workspace-button workspace-button-primary':'workspace-button'} onClick={()=>changeStep(id)}>{label}</button>)}</nav>
      <p className="mt-3 text-xs text-[var(--anka-muted)]">Saved proposals, service activation, draft pipeline revisions, activation impact and manual run review remain separate actions. An independent reviewer is still required for manual run requests.</p>
    </div>
    <div hidden={step!=='services'}><ProjectSetupPanel key={[organizationId,workspace.project.id,scopeRevision].join(':')} organizationId={organizationId} projectId={workspace.project.id} actorId={user?.id} signal={requestSignal} onChanged={onChanged} onAccessError={onAccessError} onNavigationBusyChange={setupBusy}/><details className="mt-4"><summary>Existing service activation and legacy scope</summary><ProjectServiceScopePanel project={workspace.project} organizationId={organizationId} membership={membership} scopeRevision={scopeRevision} requestSignal={requestSignal} onChanged={onChanged} onAccessError={onAccessError} onNavigationBusyChange={serviceBusy} /></details></div>
    {pipelineOpened && <div hidden={step!=='pipelines'}>
      <div className="workspace-card p-4"><h3 className="font-semibold">Choose a saved pipeline or start a plan</h3><p className="mt-2 text-sm text-[var(--anka-muted)]">Choose Website or Marketing, select a published plan, review stages and save a draft. Optional omissions, exact approved inputs, dependencies and activation retain their own reviews. A plan does not change selected services.</p><p className="mt-2 text-sm">{groups.length} Website / Marketing pipeline(s) currently recorded. Legacy remains available under History.</p></div>
      {workspace.engagement?.id ? <ProjectPipelineConfigurationPanel organizationId={organizationId} engagement={workspace.engagement} services={workspace.services} membership={membership} signal={requestSignal} initialKind={intent==='marketing'?'marketing':'website'} onReviewServices={()=>changeStep('services')} onNavigationBusyChange={pipelineBusy} /> : <p role="status" className="workspace-card p-4">This project has no engagement extension. Pipeline setup requires an existing engagement; Project Tasks remain available in Work.</p>}
    </div>}
    {step==='work' && <div className="workspace-card space-y-3 p-4"><h3 className="font-semibold">Continue with recorded work</h3><p className="text-sm text-[var(--anka-muted)]">Saving or activating a configuration does not create assignments or run a provider. Open current work to inspect owners and dates; use the existing pipeline review to request and independently review a manual run.</p><div className="flex flex-wrap gap-2"><button type="button" className="workspace-button" onClick={()=>onOpen('work')}>Open all work</button>{['website','marketing'].filter(kind=>groups.some(group=>group.kind===kind)).map(kind=><button type="button" key={kind} className="workspace-button" onClick={()=>onOpen(kind+'-work')}>Open {kind==='website'?'Website':'Marketing'} work</button>)}<button type="button" className="workspace-button" onClick={()=>onOpen('reviews')}>Open review queue</button></div></div>}
  </section>
}
