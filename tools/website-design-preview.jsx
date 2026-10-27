import {useState} from 'react'
import {createRoot} from 'react-dom/client'
import {createMemoryRouter,RouterProvider} from 'react-router-dom'
import Layout from '../src/components/Layout.jsx'
import {ThemeProvider} from '../src/hooks/useTheme.jsx'
import DesignUnifiedWorkspace from '../src/components/DesignUnifiedWorkspace.jsx'
import ContextConversationPanel from '../src/components/ContextConversationPanel.jsx'
import DepartmentChat from '../src/components/DepartmentChat.jsx'
import {actor,organizationId,projectId,createDirectChatFixture} from './direct-chat-fixture.js'
import {createWebsiteDesignFixture} from './website-design-fixture.js'
import {browserStorage,writeThemePreference} from '../src/data/themePreference.js'
import '../src/index.css'
const params=new URLSearchParams(location.search),project=!params.has('private'),fixture=createDirectChatFixture({surface:'design',state:'populated'}),native=createWebsiteDesignFixture({organizationId,projectId,actor})
writeThemePreference(browserStorage(),actor,params.get('theme')||'light')
if(project)Object.assign(fixture.data.rows[0],{context_kind:'department_project',project_id:projectId,engagement_id:native.engagement.id})
fixture.data.messages.find(m=>m.role==='assistant').body='```json\n'+JSON.stringify({schema_version:1,binding_key:native.reviewHash(),template:'service',sections:[{source_key:'copy',component:'feature_grid',motion:'reveal',heading:'A clear next step'}]})+'\n```'
fixture.engagements[0]=native.engagement
Object.assign(fixture.engagementConversations[0],{department_id:'design',engagement_id:native.engagement.id})
fixture.engagementMessages=fixture.data.messages.map(m=>({...m,conversation_id:fixture.engagementConversations[0].id}))
Object.assign(fixture.chat,{listDesignPrivateAttachments:async()=>[],listDesignVideoReferences:async()=>[],listProjectAttachments:async()=>[]})
Object.assign(fixture.designWorkshop,{load:async()=>structuredClone(native.workspace),loadPrivateBriefs:async()=>({briefs:[],versions:[],sources:[],sourceVersions:[],jobs:[]}),listMediaConversationResults:async()=>({items:[],next:null})})
const membership={organizationId,organization:{id:organizationId,name:'Anka preview'},role:'operations_admin',departmentId:'design',departmentIds:['design']},organization={activeOrganizationId:organizationId,memberships:[membership],activeMembership:membership,selectionRequired:false,loading:false,scopeRevision:1,requestSignal:new AbortController().signal}
globalThis.__directChatPreview={fixture,organization,native}
function Preview(){const[revision,setRevision]=useState(0);return <div className="workspace-page design-workshop"><h1 className="workspace-title">Design</h1><p className="workspace-description">Provider-free preview · synthetic sources, Chat, saves and Auth · no production changes</p><button onClick={()=>{organization.scopeRevision++;setRevision(r=>r+1)}}>Switch preview context</button><DesignUnifiedWorkspace key={revision} engagement={project?native.engagement:null}>{bridge=>project?<DepartmentChat departmentId="design" engagement={native.engagement} allowArtifactDraft={false} presentation="workbench" initialConversation={fixture.engagementConversations[0]} designWorkspace={bridge}/>:<ContextConversationPanel directSend contextKind={project?'department_project':'department_private'} departmentId="design" projectId={project?projectId:''} label="Design conversation" initialConversation={fixture.data.rows[0]} designWorkspace={bridge} conversationLayout/>}</DesignUnifiedWorkspace></div>}
const router=createMemoryRouter([{element:<Layout/>,children:[{path:'*',element:<Preview/>}]}],{initialEntries:['/sphere/workspace']})
createRoot(document.getElementById('root')).render(<ThemeProvider><RouterProvider router={router}/></ThemeProvider>)
