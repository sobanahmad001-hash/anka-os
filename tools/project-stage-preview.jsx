import {useState} from 'react'
import {createRoot} from 'react-dom/client'
import ProjectStagePlan from '../src/components/ProjectStagePlan.jsx'
import fixture from './project-stage-preview-fixture.json'
import '../src/index.css'
const params=new URLSearchParams(location.search)
document.documentElement.dataset.theme=params.get('theme')==='light'?'light':'dark'
function Preview(){const [context,setContext]=useState(null);return <main style={{maxWidth:1120,margin:'24px auto',padding:16}}><p style={{fontSize:12,color:'var(--anka-muted)',marginBottom:14}}>{params.get('state')==='recorded'?fixture.source:'Local presentation preview · no project data loaded'}</p><div className="workspace-card" style={{padding:24}}><h2 style={{fontSize:18,marginBottom:22}}>Project plan</h2><ProjectStagePlan plan={params.get('state')==='recorded'?fixture.plan:null} onOpenOutput={output=>setContext({output})} onContinue={setContext} onManualSetup={()=>setContext({manual:true})}/></div>{context&&<div role="status">{context.output?`Exact output selected: ${context.output.versionId}`:context.manual?'Manual setup selected':`Selected stage: ${context.track.title} / ${context.stage.title}. No message sent.`}</div>}</main>}
createRoot(document.getElementById('root')).render(<Preview/> )
