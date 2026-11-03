import {useCallback,useEffect,useRef,useState} from 'react'
import {useAuth} from '../context/AuthContext.jsx'
import {projectPipelineConfigurations} from '../data/projectPipelineConfigurations.js'
import _WorkBatchReview from './ProjectWorkBatchReview.jsx'

export default function WorkBatchEntry(props) {
  const {user}=useAuth()
  if(!user?.id || !props.workspace.engagement?.id)return null
  const key=[user.id, props.workspace.project.organization_id, props.workspace.project.id, props.workspace.engagement.id].join(':')
  return <_ScopedWorkBatchEntry key={key} {...props} actorId={user.id}/>
}

const _ScopedWorkBatchEntry = ScopedWorkBatchEntry

function ScopedWorkBatchEntry({workspace, signal, onBusy, onChanged, actorId, onOpenPlan}) {
  const [records,setRecords]=useState(null)
  const [partitionId,setPartitionId]=useState('')
  const [batchBusy,setBatchBusy]=useState(false)
  const [error,setError]=useState('')
  const active=useRef(false)
  useEffect(()=>{active.current=true;return()=>{active.current=false}},[])
  const lock=useCallback(value=>{setBatchBusy(value);onBusy?.(value)},[onBusy])
  const scope={organizationId:workspace.project.organization_id,projectId:workspace.project.id,engagementId:workspace.engagement.id,actorId}
  async function open(){
    try {
      const data=await projectPipelineConfigurations.list(scope.organizationId,scope.engagementId,{signal})
      if(active.current&&!signal?.aborted)setRecords(data)
    }catch(e){if(active.current&&!signal?.aborted)setError(e.message)}
  }
  const cards=workspace.engagementWorkItems
  const cycles=[...new Map(cards.filter(row=>row.recurring_occurrence_id).map(row=>[row.recurring_occurrence_id,row])).values()]
  const cycle=cycles.find(row=>row.recurring_occurrence_id===partitionId)
  const eligible=(records?.configurations||[]).filter(config=>cycle||!config.pipeline_group_id||records.groups.some(group=>group.id===config.pipeline_group_id&&group.kind==='branding'))
  return <details onToggle={e=>{if(e.currentTarget.open&&!records)void open()}}><summary>Review planned work cards</summary>
    {error&&<p role="alert">{error}</p>}
    {records&&<><p>For a Website page or campaign asset, open its registered record in the pipeline plan.</p>{onOpenPlan&&<button type="button" className="workspace-button" disabled={batchBusy} onClick={onOpenPlan}>Open pipeline plan</button>}
      <label>Work scope<select disabled={batchBusy} value={partitionId} onChange={e=>setPartitionId(e.target.value)}><option value="">Project engagement</option>{cycles.map(row=><option key={row.recurring_occurrence_id} value={row.recurring_occurrence_id}>Existing occurrence · {row.title}</option>)}</select></label>
      <_WorkBatchReview key={partitionId||scope.engagementId} scope={scope} partition={cycle?{kind:'recurring_occurrence',id:partitionId}:{kind:'engagement',id:scope.engagementId}} pageName={cycle?cycle.title:workspace.project.name} configurations={eligible} workRecords={cycle?cards.filter(row=>row.recurring_occurrence_id===partitionId):cards} signal={signal} onBusy={lock} onChanged={onChanged}/>
    </>}
  </details>
}
