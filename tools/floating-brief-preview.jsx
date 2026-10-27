import {useState} from 'react'
import {createRoot} from 'react-dom/client'
import {createMemoryRouter,RouterProvider} from 'react-router-dom'
import Layout from '../src/components/Layout.jsx'
import {ThemeProvider} from '../src/hooks/useTheme.jsx'
import DesignUnifiedWorkspace from '../src/components/DesignUnifiedWorkspace.jsx'
import ContextConversationPanel from '../src/components/ContextConversationPanel.jsx'
import {actor,organizationId,projectId,createDirectChatFixture} from './direct-chat-fixture.js'
import {emptyCreativeBrief,validateCreativeBrief} from '../src/data/designCreativeBriefs.js'
import {browserStorage,writeThemePreference} from '../src/data/themePreference.js'
import '../src/index.css'

const params=new URLSearchParams(location.search),project=params.has('project')
writeThemePreference(browserStorage(),actor,params.get('theme')||'light')
const fixture=createDirectChatFixture({surface:'design',state:'populated'})
const engagement={id:'preview-engagement',organization_id:organizationId,project_id:projectId,brand_id:'preview-brand'}
if(project)Object.assign(fixture.data.rows[0],{context_kind:'department_project',project_id:projectId,engagement_id:engagement.id})
Object.assign(fixture.chat,{listDesignPrivateAttachments:async()=>[],listDesignVideoReferences:async()=>[],listProjectAttachments:async()=>[]})
const membership={organizationId,organization:{id:organizationId,name:'Anka preview'},role:'operations_admin',departmentId:'design',departmentIds:['design']}
const organization={activeOrganizationId:organizationId,memberships:[membership],activeMembership:membership,selectionRequired:false,loading:false,scopeRevision:1,requestSignal:new AbortController().signal}
let brief={id:'preview-brief',organization_id:organizationId,created_by:actor,visibility:project?'official':'private',engagement_id:project?engagement.id:null,engagement_service_id:project?'preview-service':null,revision:1,frozen_version_id:'preview-v1'}
const content={...emptyCreativeBrief(),title:'A calmer launch',purpose:'A welcoming, confident introduction',audience:'Small business owners',objective:'Make the next step clear',placement_destination:'Website hero',requested_outputs:['Hero image'],instructions:'Use generous space, warm light and a clear focal point.'}
let versions=[{id:'preview-v1',creative_brief_id:brief.id,version_number:1,content,validation_snapshot:validateCreativeBrief(content),created_at:'2026-10-27T12:00:00Z'}]
const counters={save:0,freeze:0},record=()=>({briefs:[brief],versions,sources:[],sourceVersions:[],jobs:[]})
const workspace=()=>({engagement,creativeBriefs:[brief],creativeBriefVersions:versions,creativeBriefSources:[],identitySystemVersions:[],versions:[],designServices:[{id:'preview-service',status:'active',service_catalog:{department_id:'design',name:'Website visual design'}}]})
Object.assign(fixture.designWorkshop,{loadPrivateBriefs:async()=>record(),load:async()=>workspace(),listMediaConversationResults:async()=>({items:[],next:null}),saveCreativeBrief:async input=>{counters.save++;if(globalThis.__floatingBrief.failSave)throw Error('Fixture save failed; retry the same draft.');brief={...brief,revision:brief.revision+1};const version={...versions[0],id:'preview-v'+(versions.length+1),version_number:versions.length+1,content:structuredClone(input.content),validation_snapshot:validateCreativeBrief(input.content)};versions=[...versions,version];return {brief,version}},freezeCreativeBrief:async input=>{counters.freeze++;brief={...brief,frozen_version_id:input.creative_brief_version_id};return {brief}},createManualDirection:async input=>({version:{id:'preview-direction',creative_brief_version_id:input.creative_brief_version_id}})})
globalThis.__directChatPreview={fixture,organization}
globalThis.__floatingBrief={counters,failSave:false,abort:()=>organization.requestSignal.dispatchEvent(new Event('abort'))}
function Preview(){const[scope,setScope]=useState(0);return <div className="workspace-page design-workshop"><h1 className="workspace-title">Design</h1><p className="workspace-description">Local preview · synthetic {project?'project':'private'} chat and saves · no provider requests</p><button onClick={()=>{organization.scopeRevision++;setScope(x=>x+1)}}>Switch preview context</button><DesignUnifiedWorkspace key={scope} engagement={project?engagement:null}>{bridge=><ContextConversationPanel directSend contextKind={project?'department_project':'department_private'} departmentId="design" projectId={project?projectId:''} label="Design conversation" initialConversation={fixture.data.rows[0]} designWorkspace={bridge} conversationLayout/>}</DesignUnifiedWorkspace></div>}
const router=createMemoryRouter([{element:<Layout/>,children:[{path:'*',element:<Preview/>}]}],{initialEntries:['/sphere/workspace']})
createRoot(document.getElementById('root')).render(<ThemeProvider><RouterProvider router={router}/></ThemeProvider>)
