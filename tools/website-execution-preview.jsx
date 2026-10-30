import './project-content-journey-preview.jsx'
import {createBlockFixture} from './website-block-fixture.js'
import {createStagingFixture} from './website-staging-fixture.js'
import {actor} from './direct-chat-fixture.js'
const preview=globalThis.__directChatPreview,w=preview.projectWorkspace,org=w.project.organization_id,project=w.project.id,eng=w.engagement.id
const block=await createBlockFixture(),stage=createStagingFixture(new URLSearchParams(location.search).get('connected')!=='0')
const map=value=>JSON.parse(JSON.stringify(value).replaceAll('c0000000-0000-4000-8000-000000000001',org).replaceAll('c0000000-0000-4000-8000-000000000002',project).replaceAll('c0000000-0000-4000-8000-000000000003',eng))
const wrap=repo=>new Proxy({},{get:(_,key)=>async(...args)=>map(await repo[key](...args))})
stage.repository.linkWorkspace=async()=>({connections:[]})
const originalWorkspace=stage.repository.workspace
stage.repository.workspace=async(...args)=>{stage.jobs.splice(0,stage.jobs.length,...block.jobs.filter(j=>j.status==='complete').map(j=>({...j,page_key:'home',title:'Exact native package'})));return originalWorkspace(...args)}
w.activeServices=w.activeServices.map(s=>s.service_catalog.department_id==='development'?{...s,service_catalog:{...s.service_catalog,slug:'staging_production_builds',is_active:true}}:s)
preview.organization.activeMembership={...preview.organization.activeMembership,organizationId:org,role:'operations_admin'}
globalThis.__websitePilot={block:wrap(block.repository),stage:wrap(stage.repository),build: block,staging:stage,actor,canonical:structuredClone(w.engagementWorkItems)}
