import {useState} from 'react'
import {createRoot} from 'react-dom/client'
import {createMemoryRouter,RouterProvider} from 'react-router-dom'
import Layout from '../src/components/Layout.jsx'
import {ThemeProvider} from '../src/hooks/useTheme.jsx'
import DevelopmentTrackingPanel from '../src/components/DevelopmentTrackingPanel.jsx'
import {browserStorage,writeThemePreference} from '../src/data/themePreference.js'
import {actor,organizationId,projectId,engagementId,createBlockFixture} from './website-block-fixture.js'
import {createStagingFixture} from './website-staging-fixture.js'
import {attachProjectLinkFixture} from './website-project-link-fixture.js'
import '../src/index.css'
const fixture=await createBlockFixture(),membership={organizationId,organization:{id:organizationId,name:'Anka preview'},role:'operations_admin',departmentId:'development',department_id:'development'},organization={activeOrganizationId:organizationId,memberships:[membership],activeMembership:membership,loading:false,selectionRequired:false,scopeRevision:1,requestSignal:new AbortController().signal}
writeThemePreference(browserStorage(),actor,new URLSearchParams(location.search).get('theme')||'light')
const workspace={engagement:{id:engagementId,organization_id:organizationId,project_id:projectId,name:'Synthetic Website project'},stages:[],developmentArtifacts:[],developmentArtifactVersions:[],artifacts:[],versions:[],approvals:[]}
fixture.staging=createStagingFixture(new URLSearchParams(location.search).get('connected')!=='0')
if(new URLSearchParams(location.search).get('projectLink')==='1')globalThis.__projectLink=attachProjectLinkFixture(fixture.staging,actor)
globalThis.__blockPreview={fixture,organization}
function Preview(){const[active,setActive]=useState(true),[busy,setBusy]=useState(false);return <div className="workspace-page"><h1 className="workspace-title">Development</h1><p>Synthetic staging acceptance · Auth, WordPress transport, sources and saves mocked · no production/provider calls</p><button disabled={busy} onClick={()=>setActive(false)}>Switch preview context</button>{active&&<DevelopmentTrackingPanel workspace={workspace} organizationId={organizationId} actorId={actor} membership={membership} signal={organization.requestSignal} onNavigationBusyChange={setBusy} onRefresh={async()=>{}}/>}</div>}
const router=createMemoryRouter([{element:<Layout/>,children:[{path:'*',element:<Preview/>}]}],{initialEntries:['/sphere/engagements']})
createRoot(document.getElementById('root')).render(<ThemeProvider><RouterProvider router={router}/></ThemeProvider>)
