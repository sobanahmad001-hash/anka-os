import {useState} from 'react'
import {createRoot} from 'react-dom/client'
import ProjectStagePlanPanel from '../src/components/ProjectStagePlanPanel.jsx'
import fixture from './project-stage-native-fixture.json'
import '../src/index.css'
const params=new URLSearchParams(location.search);document.documentElement.dataset.theme=params.get('theme')||'dark'
const header=structuredClone(fixture.header);header.can_manage=params.get('owner')!=='false'
const scope={organizationId:header.organization_id,projectId:header.project_id,engagementId:header.engagement_id}
const calls={read:0,list:0,partition:0,review:0,apply:0,recover:0};let saved=null
const repo={
 async read(){calls.read++;return structuredClone(header)},
 async listPartitions(_s,{offset=0,limit=25,kind}){calls.list++;return {offset,limit,kind,total:70,has_more:offset+limit<70,items:Array.from({length:Math.min(limit,70-offset)},(_,i)=>({title:offset+i===0?'Homepage':`Page ${offset+i+1}`,partition:offset+i===0?fixture.unit.partition:{...fixture.unit.partition,id:'dd000000-0000-4000-8000-'+String(offset+i+1).padStart(12,'0')}}))}},
 async readPartition(_s,{partition}){calls.partition++;if(partition.id!==fixture.unit.partition.id)throw Error('Select Homepage for the native evidence scenario');return structuredClone(fixture.unit)},
 async reviewBindings(_s,{bindings}){calls.review++;return {...scope,parent_version_id:header.plan_id,review_sha256:'a'.repeat(64),bindings:structuredClone(bindings),changed:true}},
 async applyBindings(_s,{requestId,review,confirmed}){calls.apply++;if(!confirmed)throw Error('Confirmation missing');saved={requestId,bindings:review.bindings};if(params.get('outcome')==='unknown')throw Error('Simulated response lost');if(params.get('outcome')==='timeout')return new Promise(resolve=>{globalThis.__resolveMapping=resolve});header.bindings=structuredClone(saved.bindings);return {request_id:requestId}},
 async recoverBindings(_s,{requestId}){calls.recover++;if(requestId!==saved?.requestId)return {status:'not_found'};header.bindings=structuredClone(saved.bindings);return {status:'applied'}},
}
globalThis.__stageFixture={calls,header,get saved(){return saved}}
function Preview(){const [selection,setSelection]=useState(null),[activity,setActivity]=useState({});return <main style={{maxWidth:1120,margin:'24px auto',padding:20}}><p>Local synthetic repository fixture · no live requests</p><ProjectStagePlanPanel scope={scope} actorId="cc000000-0000-4000-8000-000000000001" repository={repo} onStateChange={setActivity} onContinue={setSelection} mutationTimeoutMs={100}/><p aria-label="Navigation state">{JSON.stringify(activity)}</p>{selection&&<p role="status">Selected {selection.stage.title}; no send</p>}</main>}
createRoot(document.getElementById('root')).render(<Preview/> )
