import {useState} from 'react'
import {createRoot} from 'react-dom/client'
import {createMemoryRouter,RouterProvider} from 'react-router-dom'
import Layout from '../src/components/Layout.jsx'
import {ThemeProvider} from '../src/hooks/useTheme.jsx'
import ProjectSetupPanel from '../src/components/ProjectSetupPanel.jsx'
import ProjectPipelineConfigurationPanel from '../src/components/ProjectPipelineConfigurationPanel.jsx'
import {createServicePlanningFixture,actor,organizationId,projectId,engagementId} from './service-planning-fixture.js'
import {browserStorage,writeThemePreference} from '../src/data/themePreference.js'
import '../src/index.css'
const params=new URLSearchParams(location.search),fixture=createServicePlanningFixture(),membership={organizationId,organization:{id:organizationId,name:'Anka preview'},role:'operations_admin'},signal=new AbortController().signal
writeThemePreference(browserStorage(),actor,params.get('theme')||'light')
globalThis.__servicePlanPreview={fixture,organization:{activeOrganizationId:organizationId,activeMembership:membership,memberships:[membership],loading:false,scopeRevision:1,requestSignal:signal}}
function Preview(){const[revision,setRevision]=useState(0),[active,setActive]=useState(true);return <div className="workspace-page space-y-4"><h1 className="workspace-title">Project services and delivery plan</h1><p>Synthetic Auth, Chat suggestions and writes · no production data or provider calls</p><button onClick={()=>setActive(false)}>Switch preview context</button>{active?<><ProjectSetupPanel organizationId={organizationId} projectId={projectId} actorId={actor} signal={signal} repository={fixture.setup} initialMode={params.get('mode')||'manual'} onAssist={fixture.assist} onChanged={()=>setRevision(r=>r+1)}/><ProjectPipelineConfigurationPanel key={revision} organizationId={organizationId} engagement={{id:engagementId,project_id:projectId,status:'active'}} actorId={actor} membership={membership} signal={signal} services={fixture.scopes.map(s=>({service_id:s.service_id,status:s.status}))}/></>:<p>Project context changed</p>}</div>}
const router=createMemoryRouter([{element:<Layout/>,children:[{path:'*',element:<Preview/>}]}],{initialEntries:['/sphere/workspace']});createRoot(document.getElementById('root')).render(<ThemeProvider><RouterProvider router={router}/></ThemeProvider>)
