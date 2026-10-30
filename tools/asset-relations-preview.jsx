import React,{useState} from 'react'
import {createRoot} from 'react-dom/client'
import {MemoryRouter} from 'react-router-dom'
import ProjectAssetWorkspace from '../src/components/ProjectAssetWorkspace.jsx'
import ProjectAssetConversation from '../src/components/ProjectAssetConversation.jsx'
import {createAssetRelationsFixture} from './asset-relations-fixture.js'
import '../src/index.css'
import '../src/components/osDeliveryPresentation.css'
const fixture=createAssetRelationsFixture();globalThis.__assetRelationsPreview=fixture
function Preview(){const [area,setArea]=useState('website'),[locked,setLocked]=useState(false),[open,setOpen]=useState(true);document.documentElement.dataset.theme=new URLSearchParams(location.search).get('theme')||'light';const asset=area==='marketing'?fixture.marketing:fixture.asset
 return <MemoryRouter><main className="workspace-page"><div className="workspace-container" style={{maxWidth:1280}}><header><p className="asset-note">LOCAL SYNTHETIC REHEARSAL · No live records, model or provider requests</p><h1 className="text-3xl font-semibold">Assets, work & conversations</h1><p>One set of canonical identities. Explicit links, original histories and planned keyword targets.</p></header><nav className="asset-actions" aria-label="Preview work areas">{[['website','Website asset'],['marketing','Marketing asset'],['conversation','Project conversation']].map(([id,label])=><button type="button" className="workspace-button" disabled={locked} key={id} onClick={()=>{setArea(id);setOpen(true)}}>{label}</button>)}</nav>{open?(area==='conversation'?<ProjectAssetConversation key={area} workspace={fixture.workspace} organizationId={fixture.organizationId} projectId={fixture.projectId} actorId={fixture.actorId} conversationId={fixture.conversationId} owner onLockChange={setLocked} onClose={()=>setOpen(false)}/>:<ProjectAssetWorkspace key={area} asset={asset} workspace={fixture.workspace} actorId={fixture.actorId} onRelationsLockChange={setLocked} onClose={()=>setOpen(false)}/>):<button type="button" className="workspace-button" onClick={()=>setOpen(true)}>Reopen selected workspace</button>}<footer className="asset-note">This preview exercises actual components against isolated memory fixtures. Saves here are rehearsals, never production acceptance or approval. Private chats remain private. Targeting is not ranking evidence.</footer></div></main></MemoryRouter>
}
createRoot(document.getElementById('root')).render(<Preview/> )
